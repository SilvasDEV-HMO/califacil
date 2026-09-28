/**
 * Hoja de lenguaje: 45 reactivos, tres columnas de 15, opciones A–D.
 * En el escáner la CURP va arriba de Nombre y Apellido.
 */
import {
  computeHomographySrcToDst,
  warpCanvasWithHomography,
  type HomographyPoint,
} from '@/lib/omr/homography';
import type { CalifacilOmrScanGeometry, OmrNormRect } from '@/lib/omrScan';
import { despegueSheetKind } from '@/lib/omr/despegueSheet';

export const LENGUAJE_QUESTION_COUNT = 45;
/** Los exámenes de lenguaje califican los primeros 30 reactivos de esa hoja. */
export const LENGUAJE_EXAM_QUESTIONS = 30;
export const LENGUAJE_OPTIONS = ['A', 'B', 'C', 'D'] as const;

const WARP_W = 720;
const WARP_H = 900;

/** Rectángulo del bloque en una hoja escaneada alineada (fracción de la página). */
const PAGE = { left: 0.1, right: 0.82, top: 0.24, bottom: 0.7 } as const;

/** Centros dentro de ese rectángulo (0–1). Medidos en la hoja de lenguaje de ejemplo. */
const GRID = {
  colA: [0.16, 0.354, 0.694],
  optPitch: 0.0514,
  row0: 0.039,
  rowPitch: 0.0565,
  radius: 0.012,
} as const;

const MARK_MIN = 18;
const MARK_GAP = 8;

type Pt = HomographyPoint;

export type LenguajeBubble = { letter: (typeof LENGUAJE_OPTIONS)[number]; fill: number };
export type LenguajeRow = {
  question: number;
  answer: string | null;
  ambiguous: boolean;
  bubbles: LenguajeBubble[];
};
export type LenguajeRead = {
  rows: LenguajeRow[];
  picks: (number | null)[];
  warped: HTMLCanvasElement;
  geometry: CalifacilOmrScanGeometry;
};

function luminance(data: Uint8ClampedArray, i: number): number {
  return data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
}

function isAlignedScanPage(canvas: HTMLCanvasElement): boolean {
  const aspect = canvas.height / Math.max(1, canvas.width);
  return aspect > 1.45 && aspect < 1.85;
}

function bubbleDarkness(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number): number {
  const rIn = Math.max(2, r * 0.62);
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

/** Busca el centro más oscuro cerca del punto esperado, por si la fila cae un poco corrida. */
function darkestNear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number
): number {
  let best = 0;
  const step = Math.max(2, Math.round(r * 0.45));
  for (let oy = -step * 2; oy <= step * 2; oy += step) {
    for (let ox = -step * 2; ox <= step * 2; ox += step) {
      best = Math.max(best, bubbleDarkness(data, w, h, cx + ox, cy + oy, r));
    }
  }
  return best;
}

function normToPage(u: number, v: number): { x: number; y: number } {
  return {
    x: PAGE.left + u * (PAGE.right - PAGE.left),
    y: PAGE.top + v * (PAGE.bottom - PAGE.top),
  };
}

function readGrid(canvas: HTMLCanvasElement, onPage: boolean): LenguajeRead {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const empty: LenguajeRead = {
    rows: [],
    picks: [],
    warped: canvas,
    geometry: { imageWidth: canvas.width, imageHeight: canvas.height, cells: [] },
  };
  if (!ctx) return empty;
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const r = GRID.radius * Math.min(w, h);
  const rows: LenguajeRow[] = [];
  const cells: OmrNormRect[][] = Array.from({ length: LENGUAJE_QUESTION_COUNT }, () => []);

  for (let i = 0; i < 15; i++) {
    const v = GRID.row0 + i * GRID.rowPitch;
    for (let col = 0; col < 3; col++) {
      const question = col * 15 + i + 1;
      const bubbles: LenguajeBubble[] = LENGUAJE_OPTIONS.map((letter, k) => {
        const u = GRID.colA[col]! + k * GRID.optPitch;
        const point = onPage ? normToPage(u, v) : { x: u, y: v };
        return {
          letter,
          fill: darkestNear(data, w, h, point.x * w, point.y * h, r),
        };
      });
      const ranked = [...bubbles].sort((a, b) => b.fill - a.fill);
      const best = ranked[0]!;
      const second = ranked[1]!;
      const ambiguous = !(best.fill >= MARK_MIN && best.fill - second.fill >= MARK_GAP);
      rows.push({
        question,
        answer: ambiguous ? null : best.letter,
        ambiguous: ambiguous || best.letter == null,
        bubbles,
      });
      cells[question - 1] = LENGUAJE_OPTIONS.map((_, k) => {
        const u = GRID.colA[col]! + k * GRID.optPitch;
        const point = onPage ? normToPage(u, v) : { x: u, y: v };
        return { x: point.x - GRID.radius, y: point.y - GRID.radius, w: GRID.radius * 2, h: GRID.radius * 2 };
      });
    }
  }
  rows.sort((a, b) => a.question - b.question);
  const orderedCells = cells;
  return {
    rows,
    picks: rows.map((row) => {
      if (row.ambiguous || !row.answer) return null;
      return LENGUAJE_OPTIONS.indexOf(row.answer as (typeof LENGUAJE_OPTIONS)[number]);
    }),
    warped: canvas,
    geometry: { imageWidth: w, imageHeight: h, cells: orderedCells },
  };
}

function fixedQuad(canvas: HTMLCanvasElement): [Pt, Pt, Pt, Pt] {
  const w = canvas.width;
  const h = canvas.height;
  return [
    { x: w * PAGE.left, y: h * PAGE.top },
    { x: w * PAGE.right, y: h * PAGE.top },
    { x: w * PAGE.right, y: h * PAGE.bottom },
    { x: w * PAGE.left, y: h * PAGE.bottom },
  ];
}

export function readLenguajeAnswerSheet(canvas: HTMLCanvasElement): LenguajeRead | null {
  if (canvas.width < 200 || canvas.height < 200) return null;
  if (isAlignedScanPage(canvas)) return readGrid(canvas, true);
  const quad = fixedQuad(canvas);
  const dst: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: WARP_W, y: 0 },
    { x: WARP_W, y: WARP_H },
    { x: 0, y: WARP_H },
  ];
  const homography = computeHomographySrcToDst(quad, dst);
  if (!homography) return null;
  const warped = warpCanvasWithHomography(canvas, homography, WARP_W, WARP_H);
  if (!warped) return null;
  return readGrid(warped, false);
}

/** CURP escrita arriba de Nombre, en la misma franja de todas las hojas escaneadas. */
export function cropLenguajeHandwrittenId(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !isAlignedScanPage(canvas)) return null;
  const x = Math.round(canvas.width * 0.12);
  const y = Math.round(canvas.height * 0.012);
  const cw = Math.round(canvas.width * 0.76);
  const ch = Math.round(canvas.height * 0.066);
  const out = document.createElement('canvas');
  out.width = Math.max(1, cw);
  out.height = Math.max(1, ch);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);
  return out;
}

export function isLenguaje45Exam(
  email: string | null | undefined,
  title: string | null | undefined,
  questions: { type?: string | null; options?: string[] | null }[] | null | undefined
): boolean {
  if (despegueSheetKind(email, title) !== 'lenguaje') return false;
  const list = questions ?? [];
  if (list.length !== LENGUAJE_EXAM_QUESTIONS) return false;
  return list.every((q) => {
    if (q.type && q.type !== 'multiple_choice') return false;
    const opts = (q.options ?? []).map((o) => String(o).trim().toUpperCase());
    return opts.length === 4 && ['A', 'B', 'C', 'D'].every((letter, i) => opts[i] === letter);
  });
}
