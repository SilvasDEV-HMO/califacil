/**
 * Importación de reportes ZipGrade «Paper Details»:
 * lee Percent / Points / tabla # Pri Stu Pt desde el texto del PDF
 * (sin re-escanear burbujas) y recorta Nombre|Apellido de la foto de la hoja.
 */

import { DESPEGUE_ADMIN_EMAIL } from '@/lib/omr/despegueSheet';
import {
  extractEmbeddedZipGradeSheet,
  isZipGradePaperDetailsReport,
} from '@/lib/omrZipGrade';

export type ZipGradePaperDetailsParse = {
  pointsEarned: number | null;
  possiblePoints: number | null;
  /** 0–100 */
  percent: number | null;
  /** Respuesta del alumno por reactivo (A–E), índice 0 = pregunta 1 */
  studentAnswers: (string | null)[];
  /** 1 = bien, 0 = mal (columna Pt del reporte) */
  pointsFlags: (0 | 1 | null)[];
  ok: boolean;
};

const PAPER_DETAILS_SHEET_FALLBACK = { x: 0.02, y: 0.36, w: 0.47, h: 0.58 } as const;

/** Banda Nombre|Apellido en la hoja ZipGrade enderezada / foto incrustada. */
const NAME_BAND = { x: 0.05, y: 0.028, w: 0.9, h: 0.13 } as const;

export function isAdminCalifacilEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === DESPEGUE_ADMIN_EMAIL;
}

/** Detecta Paper Details solo con texto (sin rasterizar). */
export function looksLikeZipGradePaperDetailsText(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes('points earned') && t.includes('possible points')) return true;
  if (t.includes('paper details') && (t.includes('percent') || t.includes('points earned'))) {
    return true;
  }
  return /\bpri\b/i.test(text) && /\bstu\b/i.test(text) && /\bpercent\b/i.test(text);
}

/** Admin + página Paper Details → importar datos del PDF, no OMR. */
export function shouldImportZipGradePaperDetails(
  email: string | null | undefined,
  pageCanvas: HTMLCanvasElement
): boolean {
  return isAdminCalifacilEmail(email) && isZipGradePaperDetailsReport(pageCanvas);
}

function afterLabelNumber(text: string, label: RegExp): number | null {
  const m = text.match(label);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parsea el texto plano de una página Paper Details (pdf.js getTextContent).
 */
export function parseZipGradePaperDetailsText(
  rawText: string,
  expectedQuestions: number
): ZipGradePaperDetailsParse {
  const text = rawText.replace(/\u00a0/g, ' ').replace(/\r/g, '');
  const compact = text.replace(/[ \t]+/g, ' ');

  const pointsEarned = afterLabelNumber(
    compact,
    /Points\s*Earned\s*[:\s]+(\d+(?:[.,]\d+)?)/i
  );
  const possiblePoints = afterLabelNumber(
    compact,
    /Possible\s*Points\s*[:\s]+(\d+(?:[.,]\d+)?)/i
  );
  let percent = afterLabelNumber(
    compact,
    /Percent\s*[:\s]+(\d+(?:[.,]\d+)?)\s*%?/i
  );
  if (percent != null && percent <= 1 && (pointsEarned == null || percent !== pointsEarned)) {
    // a veces viene como 0.633
    percent = Math.round(percent * 1000) / 10;
  }
  if (
    percent == null &&
    pointsEarned != null &&
    possiblePoints != null &&
    possiblePoints > 0
  ) {
    percent = Math.round((pointsEarned / possiblePoints) * 1000) / 10;
  }

  const nExpect = Math.max(1, Math.min(100, expectedQuestions || 50));
  const studentAnswers: (string | null)[] = [];
  const pointsFlags: (0 | 1 | null)[] = [];
  for (let i = 0; i < nExpect; i++) {
    studentAnswers.push(null);
    pointsFlags.push(null);
  }

  // Filas tipo: "1 A A 1 C 94" o "3 C B 0 X 47"
  const rowRe =
    /(?:^|\n|\s)(\d{1,3})\s+([A-Ea-e])\s+([A-Ea-e\-–])\s+([01])\s+([CXcх×x])\b/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const qNum = Number(m[1]);
    if (!Number.isFinite(qNum) || qNum < 1 || qNum > nExpect) continue;
    const stu = m[3]!.toUpperCase();
    const pt = m[4] === '1' ? 1 : 0;
    const idx = qNum - 1;
    if (/^[A-E]$/.test(stu)) studentAnswers[idx] = stu;
    else studentAnswers[idx] = null;
    pointsFlags[idx] = pt;
  }

  // Fallback: tras encabezado Stu, secuencias "N Letra Letra"
  const answeredSoFar = studentAnswers.reduce((n, a) => n + (a != null ? 1 : 0), 0);
  if (answeredSoFar === 0) {
    const altRe = /(?:^|\n|\s)(\d{1,3})\s+([A-Ea-e])\s+([A-Ea-e])\b/g;
    while ((m = altRe.exec(text)) !== null) {
      const qNum = Number(m[1]);
      if (!Number.isFinite(qNum) || qNum < 1 || qNum > nExpect) continue;
      const stu = m[3]!.toUpperCase();
      if (/^[A-E]$/.test(stu)) studentAnswers[qNum - 1] = stu;
    }
  }

  const answered = studentAnswers.filter((a) => a != null).length;
  const ok =
    answered >= Math.max(1, Math.ceil(nExpect * 0.5)) ||
    (percent != null && answered >= Math.max(1, Math.ceil(nExpect * 0.3)));

  return {
    pointsEarned,
    possiblePoints,
    percent: percent != null ? Math.max(0, Math.min(100, percent)) : null,
    studentAnswers,
    pointsFlags,
    ok,
  };
}

/** Draft MC desde respuestas Stu del reporte. */
export function mapPaperDetailsToMcDraft(
  questions: { id: string; type?: string | null; options?: string[] | null }[],
  parsed: ZipGradePaperDetailsParse
): Record<string, string> {
  const draft: Record<string, string> = {};
  let qi = 0;
  for (const q of questions) {
    if (q.type && q.type !== 'multiple_choice') {
      draft[q.id] = '';
      continue;
    }
    const letter = parsed.studentAnswers[qi] ?? null;
    qi += 1;
    if (!letter) {
      draft[q.id] = '';
      continue;
    }
    const opts = (q.options ?? []).map((o) => String(o).trim());
    const hit = opts.find((o) => o.toUpperCase() === letter);
    draft[q.id] = hit ?? letter;
  }
  return draft;
}

function cropRect(
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number }
): HTMLCanvasElement | null {
  const W = canvas.width;
  const H = canvas.height;
  const sx = Math.max(0, Math.floor(rect.x * W));
  const sy = Math.max(0, Math.floor(rect.y * H));
  const sw = Math.max(8, Math.min(W - sx, Math.round(rect.w * W)));
  const sh = Math.max(6, Math.min(H - sy, Math.round(rect.h * H)));
  if (sw < 8 || sh < 6) return null;
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Elimina márgenes blancos para que el manuscrito llene el recuadro. */
function trimCanvasWhitespace(
  canvas: HTMLCanvasElement,
  pad = 6,
  lumaMax = 245
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  let id: ImageData;
  try {
    id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return canvas;
  }
  const { data, width, height } = id;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
      if (lum >= lumaMax) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX || maxY <= minY) return canvas;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width - sx, maxX - minX + pad * 2);
  const sh = Math.min(height - sy, maxY - minY + pad * 2);
  if (sw < 12 || sh < 8) return canvas;
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const octx = out.getContext('2d');
  if (!octx) return canvas;
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, sw, sh);
  octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

function looksLikeGreenLogo(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  try {
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let green = 0;
    let n = 0;
    const step = Math.max(2, Math.floor(Math.min(canvas.width, canvas.height) / 40));
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const i = (y * canvas.width + x) * 4;
        const r = id.data[i]!;
        const g = id.data[i + 1]!;
        const b = id.data[i + 2]!;
        n++;
        if (g > 100 && g > r + 25 && g > b + 10) green++;
      }
    }
    return n > 0 && green / n > 0.03;
  } catch {
    return false;
  }
}

/**
 * Recorte Nombre + Apellido para el modal de lote (centrado, sin márgenes enormes).
 * Usa la foto de la hoja del Paper Details, no el logo.
 */
export function cropPaperDetailsNameApellidoDataUrl(
  reportOrSheet: HTMLCanvasElement,
  maxWidth = 640
): string | null {
  if (typeof document === 'undefined' || reportOrSheet.width < 40) return null;

  let sheet = reportOrSheet;
  if (isZipGradePaperDetailsReport(reportOrSheet)) {
    sheet =
      extractEmbeddedZipGradeSheet(reportOrSheet) ??
      cropRect(reportOrSheet, PAPER_DETAILS_SHEET_FALLBACK) ??
      reportOrSheet;
  }

  const band = cropRect(sheet, NAME_BAND);
  if (!band || looksLikeGreenLogo(band)) return null;
  const trimmed = trimCanvasWhitespace(band, 8, 242);
  if (looksLikeGreenLogo(trimmed)) return null;

  const scale = Math.min(1, maxWidth / trimmed.width);
  let out = trimmed;
  if (scale < 0.999) {
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.round(trimmed.width * scale));
    scaled.height = Math.max(1, Math.round(trimmed.height * scale));
    const sctx = scaled.getContext('2d');
    if (!sctx) return null;
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, scaled.width, scaled.height);
    sctx.drawImage(trimmed, 0, 0, scaled.width, scaled.height);
    out = scaled;
  }
  try {
    return out.toDataURL('image/jpeg', 0.92);
  } catch {
    return null;
  }
}

function foldPersonName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Busca alumno por nombre/apellido aproximado (para preseleccionar en el lote). */
export function matchStudentByLooseName<T extends { id: string; name: string }>(
  hint: string | null | undefined,
  students: T[]
): T | null {
  const raw = foldPersonName(hint ?? '');
  if (raw.length < 3 || students.length === 0) return null;
  const tokens = raw.split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;

  const scored = students
    .map((s) => {
      const name = foldPersonName(s.name);
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += t.length;
      }
      return { student: s, score, name };
    })
    .filter((row) => row.score >= 5)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const uniqueHits = tokens
      .filter((t) => t.length >= 5)
      .map((t) => students.filter((s) => foldPersonName(s.name).includes(t)))
      .filter((hits) => hits.length === 1);
    if (uniqueHits.length === 1) return uniqueHits[0]![0] ?? null;
    return null;
  }
  const best = scored[0]!;
  const tied = scored.filter((row) => row.score === best.score);
  if (tied.length > 1) return null;
  return best.student;
}
