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

export const CUSTOM20_ADMIN_EMAIL = 'admin@califacil.com';
export const CUSTOM20_EXAM_TITLE = 'OMR hoja 20 (prueba)';
export const CUSTOM20_QUESTION_COUNT = 20;
export const CUSTOM20_OPTIONS = ['A', 'B', 'C', 'D'] as const;

const WARP_W = 640;
const WARP_H = 820;

/** Centros de burbuja en la hoja enderezada (0–1), fila 0 = pregunta 1 o 11. */
const GRID = {
  leftColX0: 0.205,
  rightColX0: 0.438,
  colPitch: 0.054,
  rowY0: 0.427,
  rowPitch: 0.0546,
  radius: 0.011,
} as const;

/** El lápiz de esta hoja es gris claro: el interior marcado baja de ~165. */
const INK_LUM = 168;
const MARK_MIN = 0.2;
const MARK_GAP = 0.12;

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

function bubbleFill(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number): number {
  const rIn = r * 0.72;
  let dark = 0;
  let total = 0;
  const x0 = Math.max(0, Math.floor(cx - rIn));
  const x1 = Math.min(w - 1, Math.ceil(cx + rIn));
  const y0 = Math.max(0, Math.floor(cy - rIn));
  const y1 = Math.min(h - 1, Math.ceil(cy + rIn));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > rIn * rIn) continue;
      total++;
      if (luminance(data, (y * w + x) * 4) < INK_LUM) dark++;
    }
  }
  return total ? dark / total : 0;
}

function readGrid(warped: HTMLCanvasElement): Custom20Read {
  const ctx = warped.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { rows: [], picks: [] };
  const w = warped.width;
  const h = warped.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const r = GRID.radius * Math.min(w, h);
  const rows: Custom20Row[] = [];

  for (let i = 0; i < 10; i++) {
    const y = (GRID.rowY0 + i * GRID.rowPitch) * h;
    for (const col of [0, 1] as const) {
      const question = col === 0 ? i + 1 : i + 11;
      const x0 = (col === 0 ? GRID.leftColX0 : GRID.rightColX0) * w;
      const bubbles: Custom20Bubble[] = CUSTOM20_OPTIONS.map((letter, k) => ({
        letter,
        fill: bubbleFill(data, w, h, x0 + k * GRID.colPitch * w, y, r),
      }));
      const ranked = [...bubbles].sort((a, b) => b.fill - a.fill);
      const best = ranked[0]!;
      const second = ranked[1]!;
      const ahead = best.fill - second.fill >= MARK_GAP && best.fill >= second.fill * 1.45;
      const ambiguous = !(best.fill >= MARK_MIN && ahead);
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
  };
}

export function isCustom20Exam(email: string | null | undefined, title: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === CUSTOM20_ADMIN_EMAIL && (title ?? '').trim() === CUSTOM20_EXAM_TITLE;
}

/** Lee la hoja. Devuelve null si no encuentra los cuadros de referencia. */
export function readCustom20AnswerSheet(canvas: HTMLCanvasElement): Custom20Read | null {
  const quad = findCornerSquares(canvas);
  if (!quad) return null;
  const warped = warpToTemplate(canvas, quad);
  if (!warped) return null;
  return readGrid(warped);
}
