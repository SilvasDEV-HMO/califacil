/**
 * Lector OMR de la hoja ZipGrade de 20 (dos columnas × 10, A–D).
 * Los 4 cuadros negros delimitan el bloque; tras enderezar, las burbujas
 * están en una plantilla fija.
 */
import {
  computeHomographySrcToDst,
  warpCanvasWithHomography,
  type HomographyPoint,
} from '@/lib/omr/homography';
import type { CalifacilOmrScanGeometry, OmrNormRect } from '@/lib/omrScan';

export const CUSTOM20_ADMIN_EMAIL = 'admin@califacil.com';
export const CUSTOM20_EXAM_TITLE = 'OMR hoja 20 (prueba)';
export const CUSTOM20_QUESTION_COUNT = 20;
export const CUSTOM20_OPTIONS = ['A', 'B', 'C', 'D'] as const;

const WARP_W = 640;
const WARP_H = 820;

/** Centros de burbuja en la hoja enderezada (0–1), fila 0 = pregunta 1 o 11. */
const GRID = {
  leftColX0: 0.19,
  rightColX0: 0.49,
  colPitch: 0.056,
  rowY0: 0.454,
  rowPitch: 0.049,
  /** La fila 10 queda un poco más arriba que una rejilla uniforme. */
  lastRowY: 0.905,
  radius: 0.012,
} as const;

/** Oscuridad media del interior. Una marca borrada queda por debajo de la nueva. */
const MARK_MIN = 10;
const MARK_GAP = 8;

export type Custom20Bubble = {
  letter: (typeof CUSTOM20_OPTIONS)[number];
  fill: number;
};

export type Custom20Row = {
  question: number;
  answer: string | null;
  ambiguous: boolean;
  bubbles: Custom20Bubble[];
};

export type Custom20Read = {
  rows: Custom20Row[];
  /** Respuestas listas para la revisión: null si ambigua o vacía. */
  picks: (number | null)[];
  warped: HTMLCanvasElement;
  geometry: CalifacilOmrScanGeometry;
};

type Pt = HomographyPoint;

function luminance(data: Uint8ClampedArray, i: number): number {
  return data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
}

function findCornerSquares(canvas: HTMLCanvasElement): [Pt, Pt, Pt, Pt] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 200 || h < 200) return null;
  const data = ctx.getImageData(0, 0, w, h).data;
  const side = Math.max(8, Math.round(Math.min(w, h) * 0.018));
  const step = Math.max(2, Math.round(side / 3));
  const hits: { x: number; y: number; score: number }[] = [];

  for (let y = step; y < h - side; y += step) {
    for (let x = step; x < w - side; x += step) {
      let sum = 0;
      let dark = 0;
      const samples = 5;
      for (let yy = 0; yy < samples; yy++) {
        for (let xx = 0; xx < samples; xx++) {
          const px = x + Math.round(((xx + 0.5) * side) / samples);
          const py = y + Math.round(((yy + 0.5) * side) / samples);
          const lum = luminance(data, (py * w + px) * 4);
          sum += lum;
          if (lum < 90) dark++;
        }
      }
      const mean = sum / (samples * samples);
      const fill = dark / (samples * samples);
      if (mean < 95 && fill > 0.55) {
        hits.push({ x: x + side / 2, y: y + side / 2, score: fill * (120 - mean) });
      }
    }
  }
  if (hits.length < 3) return null;

  hits.sort((a, b) => b.score - a.score);
  const picked: { x: number; y: number }[] = [];
  for (const hit of hits) {
    if (picked.some((p) => Math.hypot(p.x - hit.x, p.y - hit.y) < side * 2.2)) continue;
    picked.push(hit);
    if (picked.length >= 8) break;
  }

  const solid = picked.filter((p) => p.y > h * 0.25 && p.y < h * 0.95 && p.x > w * 0.12 && p.x < w * 0.9);
  if (solid.length < 3) return null;

  const tl = solid.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b));
  const rest = solid.filter((p) => p !== tl);
  const tr = rest.reduce((a, b) => (a.x - a.y > b.x - b.y ? a : b));
  const bl = rest.filter((p) => p !== tr).reduce((a, b) => (b.y - b.x > a.y - a.x ? b : a));
  const inferred: Pt = { x: tr.x + (bl.x - tl.x), y: tr.y + (bl.y - tl.y) };
  const brHit = rest.find(
    (p) => p !== tr && p !== bl && Math.hypot(p.x - inferred.x, p.y - inferred.y) < side * 4
  );
  const br = brHit ?? inferred;
  if (tr.x - tl.x < w * 0.25) return null;
  if (bl.y - tl.y < h * 0.2) return null;
  return [tl, tr, br, bl];
}

function warpToTemplate(canvas: HTMLCanvasElement, quad: [Pt, Pt, Pt, Pt]): HTMLCanvasElement | null {
  const margin = 0.04;
  const dst: [Pt, Pt, Pt, Pt] = [
    { x: WARP_W * margin, y: WARP_H * margin },
    { x: WARP_W * (1 - margin), y: WARP_H * margin },
    { x: WARP_W * (1 - margin), y: WARP_H * (1 - margin) },
    { x: WARP_W * margin, y: WARP_H * (1 - margin) },
  ];
  const h = computeHomographySrcToDst(quad, dst);
  if (!h) return null;
  return warpCanvasWithHomography(canvas, h, WARP_W, WARP_H);
}

function bubbleDarkness(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number): number {
  const rIn = r * 0.62;
  let sum = 0;
  let total = 0;
  const x0 = Math.max(0, Math.floor(cx - rIn));
  const x1 = Math.min(w - 1, Math.ceil(cx + rIn));
  const y0 = Math.max(0, Math.floor(cy - rIn));
  const y1 = Math.min(h - 1, Math.ceil(cy + rIn));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > rIn * rIn) continue;
      total++;
      sum += 255 - luminance(data, (y * w + x) * 4);
    }
  }
  return total ? sum / total : 0;
}

function gridCells(width: number, height: number): OmrNormRect[][] {
  const r = GRID.radius;
  const cells: OmrNormRect[][] = [];
  for (let i = 0; i < 10; i++) {
    const rowY = i === 9 ? GRID.lastRowY : GRID.rowY0 + i * GRID.rowPitch;
    const y = rowY - r;
    for (const col of [0, 1] as const) {
      const x0 = col === 0 ? GRID.leftColX0 : GRID.rightColX0;
      cells.push(
        CUSTOM20_OPTIONS.map((_, k) => ({
          x: x0 + k * GRID.colPitch - r,
          y,
          w: r * 2,
          h: r * 2,
        }))
      );
    }
  }
  const ordered: OmrNormRect[][] = [];
  for (let q = 0; q < 20; q++) {
    const i = q < 10 ? q * 2 : (q - 10) * 2 + 1;
    ordered.push(cells[i]!);
  }
  void width;
  void height;
  return ordered;
}

function readGrid(warped: HTMLCanvasElement): Custom20Read {
  const ctx = warped.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      rows: [],
      picks: [],
      warped,
      geometry: { imageWidth: warped.width, imageHeight: warped.height, cells: [] },
    };
  }
  const w = warped.width;
  const h = warped.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const r = GRID.radius * Math.min(w, h);
  const rows: Custom20Row[] = [];

  for (let i = 0; i < 10; i++) {
    const y = (i === 9 ? GRID.lastRowY : GRID.rowY0 + i * GRID.rowPitch) * h;
    for (const col of [0, 1] as const) {
      const question = col === 0 ? i + 1 : i + 11;
      const x0 = (col === 0 ? GRID.leftColX0 : GRID.rightColX0) * w;
      const bubbles: Custom20Bubble[] = CUSTOM20_OPTIONS.map((letter, k) => ({
        letter,
        fill: bubbleDarkness(data, w, h, x0 + k * GRID.colPitch * w, y, r),
      }));
      const ranked = [...bubbles].sort((a, b) => b.fill - a.fill);
      const best = ranked[0]!;
      const second = ranked[1]!;
      const ambiguous = !(best.fill >= MARK_MIN && best.fill - second.fill >= MARK_GAP);
      const answer = ambiguous ? null : best.letter;
      rows.push({ question, answer, ambiguous: ambiguous || answer === null, bubbles });
    }
  }

  rows.sort((a, b) => a.question - b.question);
  return {
    rows,
    picks: rows.map((row) => {
      if (row.ambiguous || !row.answer) return null;
      return CUSTOM20_OPTIONS.indexOf(row.answer as (typeof CUSTOM20_OPTIONS)[number]);
    }),
    warped,
    geometry: { imageWidth: w, imageHeight: h, cells: gridCells(w, h) },
  };
}

/** Admin con un examen de exactamente 20 reactivos A–D. No depende del título. */
export function isCustom20Exam(
  email: string | null | undefined,
  questions: { type?: string | null; options?: string[] | null }[] | null | undefined
): boolean {
  if ((email ?? '').trim().toLowerCase() !== CUSTOM20_ADMIN_EMAIL) return false;
  const list = questions ?? [];
  if (list.length !== CUSTOM20_QUESTION_COUNT) return false;
  return list.every((q) => {
    if (q.type && q.type !== 'multiple_choice') return false;
    const opts = (q.options ?? []).map((o) => String(o).trim().toUpperCase());
    return opts.length === 4 && ['A', 'B', 'C', 'D'].every((letter, i) => opts[i] === letter);
  });
}

export function warpCustom20Canvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const quad = findCornerSquares(canvas);
  if (!quad) return null;
  return warpToTemplate(canvas, quad);
}

/** Lee la hoja. Devuelve null si no encuentra los cuadros de referencia. */
export function readCustom20AnswerSheet(canvas: HTMLCanvasElement): Custom20Read | null {
  const warped = warpCustom20Canvas(canvas);
  if (!warped) return null;
  return readGrid(warped);
}
