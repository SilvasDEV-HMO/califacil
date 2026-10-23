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

/**
 * Hoja RAFM (Matemáticas): el nombre y los apellidos van uno debajo del otro
 * (NOMBRE, luego APELLIDOS), no en dos cajas horizontales como Lenguaje.
 */
const MATE_NOMBRE_BAND = { x: 0.02, y: 0.0, w: 0.96, h: 0.11 } as const;
const MATE_APELLIDOS_BAND = { x: 0.02, y: 0.09, w: 0.96, h: 0.12 } as const;

export type PaperDetailsNameLayout = 'zipgrade' | 'matematicas';

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
  const compact = text.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n');
  const flat = compact.replace(/\s+/g, ' ');

  const pointsEarned = afterLabelNumber(
    flat,
    /Points\s*Earned\s*[:\s]+(\d+(?:[.,]\d+)?)/i
  );
  const possiblePoints = afterLabelNumber(
    flat,
    /Possible\s*Points\s*[:\s]+(\d+(?:[.,]\d+)?)/i
  );
  let percent = afterLabelNumber(
    flat,
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
  while ((m = rowRe.exec(flat)) !== null) {
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
    while ((m = altRe.exec(flat)) !== null) {
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

function jpegFromCanvas(source: HTMLCanvasElement, maxWidth: number): string | null {
  const scale = Math.min(1, maxWidth / Math.max(1, source.width));
  let out = source;
  if (scale < 0.999) {
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.round(source.width * scale));
    scaled.height = Math.max(1, Math.round(source.height * scale));
    const sctx = scaled.getContext('2d');
    if (!sctx) return null;
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, scaled.width, scaled.height);
    sctx.drawImage(source, 0, 0, scaled.width, scaled.height);
    out = scaled;
  }
  try {
    return out.toDataURL('image/jpeg', 0.92);
  } catch {
    return null;
  }
}

/** Foto de la hoja RAFM en Paper Details (izquierda, debajo del encabezado ZipGrade). */
function extractMathFormPhoto(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 120 || canvas.height < 160) return null;
  const w = canvas.width;
  const h = canvas.height;
  const y0 = Math.floor(h * 0.34);
  const y1 = Math.floor(h * 0.9);
  const x1 = Math.floor(w * 0.5);
  const regionH = y1 - y0;
  if (regionH < 40 || x1 < 40) return null;
  let id: ImageData;
  try {
    id = ctx.getImageData(0, y0, x1, regionH);
  } catch {
    return null;
  }
  const { data } = id;
  const step = Math.max(1, Math.floor(Math.min(x1, regionH) / 180));
  const rowInk = new Float32Array(regionH);
  for (let y = 0; y < regionH; y += step) {
    let n = 0;
    let ink = 0;
    for (let x = 0; x < x1; x += step) {
      const i = (y * x1 + x) * 4;
      const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
      n++;
      if (lum < 230) ink++;
    }
    const frac = n > 0 ? ink / n : 0;
    for (let k = 0; k < step && y + k < regionH; k++) rowInk[y + k] = frac;
  }
  let bestA = 0;
  let bestB = 0;
  let run = -1;
  for (let y = 0; y <= regionH; y++) {
    const on = y < regionH && rowInk[y]! > 0.08;
    if (on && run < 0) run = y;
    if (!on && run >= 0) {
      if (y - run > bestB - bestA) {
        bestA = run;
        bestB = y;
      }
      run = -1;
    }
  }
  if (bestB - bestA < 40) return null;
  const colInk = new Float32Array(x1);
  for (let y = bestA; y < bestB; y += step) {
    for (let x = 0; x < x1; x += step) {
      const i = (y * x1 + x) * 4;
      const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
      if (lum < 230) {
        for (let k = 0; k < step && x + k < x1; k++) colInk[x + k] += 1;
      }
    }
  }
  const colThresh = ((bestB - bestA) / step) * 0.04;
  let minX = 0;
  let maxX = x1 - 1;
  while (minX < x1 && colInk[minX]! < colThresh) minX++;
  while (maxX > minX && colInk[maxX]! < colThresh) maxX--;
  const pad = 4;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, y0 + bestA - pad);
  const sw = Math.min(w - sx, maxX - minX + pad * 2);
  const sh = Math.min(h - sy, bestB - bestA + pad * 2);
  if (sw < 40 || sh < 40) return null;
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

function stitchNameBoxes(
  left: HTMLCanvasElement,
  right: HTMLCanvasElement,
  maxWidth: number
): string | null {
  const gap = 8;
  const h = Math.max(left.height, right.height);
  const out = document.createElement('canvas');
  out.width = left.width + gap + right.width;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(left, 0, Math.floor((h - left.height) / 2));
  ctx.drawImage(right, left.width + gap, Math.floor((h - right.height) / 2));
  return jpegFromCanvas(out, maxWidth);
}

/**
 * Recorte Nombre + Apellido para el modal de lote (centrado, sin márgenes enormes).
 * Usa la foto de la hoja del Paper Details, no el logo.
 */
export function cropPaperDetailsNameApellidoDataUrl(
  reportOrSheet: HTMLCanvasElement,
  maxWidth = 640,
  layout: PaperDetailsNameLayout = 'zipgrade'
): string | null {
  if (typeof document === 'undefined' || reportOrSheet.width < 40) return null;

  let sheet = reportOrSheet;
  if (isZipGradePaperDetailsReport(reportOrSheet)) {
    sheet =
      extractEmbeddedZipGradeSheet(reportOrSheet) ??
      cropRect(reportOrSheet, PAPER_DETAILS_SHEET_FALLBACK) ??
      reportOrSheet;
  }

  if (layout === 'matematicas') {
    const form =
      (isZipGradePaperDetailsReport(reportOrSheet)
        ? extractMathFormPhoto(reportOrSheet)
        : null) ?? sheet;
    const nombre = cropRect(form, MATE_NOMBRE_BAND);
    const apellidos = cropRect(form, MATE_APELLIDOS_BAND);
    if (nombre && apellidos && !looksLikeGreenLogo(nombre) && !looksLikeGreenLogo(apellidos)) {
      const left = trimCanvasWhitespace(nombre, 4, 242);
      const right = trimCanvasWhitespace(apellidos, 4, 242);
      const stitched = stitchNameBoxes(left, right, maxWidth);
      if (stitched) return stitched;
    }
  }

  const band = cropRect(sheet, layout === 'matematicas'
    ? { x: 0.05, y: 0.01, w: 0.9, h: 0.27 }
    : NAME_BAND);
  if (!band || looksLikeGreenLogo(band)) return null;
  const trimmed = trimCanvasWhitespace(band, 8, 242);
  if (looksLikeGreenLogo(trimmed)) return null;
  return jpegFromCanvas(trimmed, maxWidth);
}

/** Nombre impreso o etiquetado en el PDF Paper Details (antes de OCR). */
export function extractStudentNameFromPaperDetailsText(rawText: string): string {
  const text = rawText.replace(/\u00a0/g, ' ').replace(/\r/g, '');
  const labeled = text.match(
    /(?:student\s*name|nombre(?:s)?(?:\s*y\s*apellidos?)?|alumno|name)\s*[:\-]\s*([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s,'\.-]{3,80})/i
  );
  if (labeled?.[1]) {
    return labeled[1].replace(/\s+/g, ' ').replace(/\b(key|percent|points|class)\b.*/i, '').trim();
  }
  return '';
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

const NAME_STOPWORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'da', 'do', 'dos']);

function nameTokens(value: string): string[] {
  return foldPersonName(value)
    .split(' ')
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** Palabra contra palabara del alumno, no un trozo dentro de otro nombre. */
function tokensClose(ocr: string, student: string): boolean {
  if (ocr === student) return true;
  const maxLen = Math.max(ocr.length, student.length);
  const minLen = Math.min(ocr.length, student.length);
  // Marian ≠ Marin: en nombres cortos solo vale coincidencia exacta.
  if (maxLen < 8) return false;
  if (minLen < 6 || maxLen - minLen > 2) return false;
  const d = editDistance(ocr, student);
  return d <= 2;
}

/**
 * Preselecciona solo si el OCR encaja de verdad con el grupo.
 * Un nombre que no está en la lista (p. ej. Dominic Zepeda) queda pendiente.
 */
export function matchStudentByLooseName<T extends { id: string; name: string }>(
  hint: string | null | undefined,
  students: T[]
): T | null {
  const ocrTokens = nameTokens(hint ?? '');
  if (ocrTokens.length === 0 || students.length === 0) return null;

  const scored = students
    .map((s) => {
      const stTokens = nameTokens(s.name);
      let hits = 0;
      for (const ot of ocrTokens) {
        if (stTokens.some((st) => tokensClose(ot, st))) hits += 1;
      }
      return { student: s, hits };
    })
    .filter((row) => row.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 0) return null;

  const best = scored[0]!;
  const runner = scored[1];
  if (runner && runner.hits === best.hits) return null;
  if (best.hits >= 2) return best.student;

  // Una palabra única del grupo (Marian, Anahi, Michel, Amparano) sí basta
  // si nadie más la tiene. José/Carlos empatan y quedan pendientes.
  const longHits = ocrTokens.filter((t) => t.length >= 5);
  const uniqueLong: T[] = [];
  for (const t of longHits) {
    const owners = students.filter((s) =>
      nameTokens(s.name).some((st) => st.length >= 5 && tokensClose(t, st))
    );
    if (owners.length === 1 && !uniqueLong.some((s) => s.id === owners[0]!.id)) {
      uniqueLong.push(owners[0]!);
    }
  }
  return uniqueLong.length === 1 ? uniqueLong[0]! : null;
}
