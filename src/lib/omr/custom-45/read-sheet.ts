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
  colA: [0.167, 0.432, 0.697],
  optPitch: 0.0514,
  row0: 0,
  rowPitch: 0.0643,
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

/**
 * Esquinas del formato en la hoja matutina que ya califica bien.
 * Las hojas chicas o chuecas se enderezan hasta caer aquí.
 */
const REFERENCE_FORM: [Pt, Pt, Pt, Pt] = [
  { x: 0.121, y: 0.133 },
  { x: 0.769, y: 0.133 },
  { x: 0.773, y: 0.675 },
  { x: 0.126, y: 0.677 },
];

function findLenguajeFormQuad(canvas: HTMLCanvasElement): [Pt, Pt, Pt, Pt] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 200 || h < 200) return null;
  const data = ctx.getImageData(0, 0, w, h).data;
  const points: Pt[] = [];

  for (const frac of [0.01, 0.015]) {
    const side = Math.max(5, Math.round(Math.min(w, h) * frac));
    const step = Math.max(2, Math.round(side / 2));
    const hits: Pt[] = [];
    for (let y = 0; y < h - side; y += step) {
      for (let x = 0; x < w - side; x += step) {
        let dark = 0;
        let total = 0;
        for (let yy = 0; yy < side; yy += Math.max(1, Math.round(side / 4))) {
          for (let xx = 0; xx < side; xx += Math.max(1, Math.round(side / 4))) {
            total++;
            if (luminance(data, ((y + yy) * w + (x + xx)) * 4) < 90) dark++;
          }
        }
        if (!total || dark / total < 0.55) continue;
        const cx = x + side / 2;
        const cy = y + side / 2;
        const fill = (x0: number, y0: number, rw: number, rh: number) => {
          let n = 0;
          let tot = 0;
          const jump = Math.max(1, Math.round(Math.min(rw, rh) / 5));
          for (let py = y0; py < y0 + rh; py += jump) {
            for (let px = x0; px < x0 + rw; px += jump) {
              const ix = Math.round(px);
              const iy = Math.round(py);
              if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
              tot++;
              if (luminance(data, (iy * w + ix) * 4) < 90) n++;
            }
          }
          return tot ? n / tot : 0;
        };
        if (fill(cx - side * 2, cy - side / 2, side * 4, side) > 0.7) continue;
        if (fill(cx - side / 2, cy - side * 2, side, side * 4) > 0.7) continue;
        hits.push({ x: cx, y: cy });
      }
    }
    const clustered: { x: number; y: number; n: number }[] = [];
    for (const hit of hits) {
      const near = clustered.find((c) => Math.hypot(c.x - hit.x, c.y - hit.y) < side * 3.2);
      if (near) {
        near.x = (near.x * near.n + hit.x) / (near.n + 1);
        near.y = (near.y * near.n + hit.y) / (near.n + 1);
        near.n += 1;
      } else {
        clustered.push({ x: hit.x, y: hit.y, n: 1 });
      }
    }
    for (const mark of clustered) {
      if (mark.n < 2) continue;
      if (points.some((p) => Math.hypot(p.x - mark.x, p.y - mark.y) < Math.min(w, h) * 0.02)) continue;
      points.push({ x: mark.x, y: mark.y });
    }
  }

  let best: { area: number; quad: [Pt, Pt, Pt, Pt] } | null = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (Math.abs(a.y - b.y) > h * 0.08 || Math.abs(a.x - b.x) < w * 0.22) continue;
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      const top = Math.min(left.y, right.y);
      if (top > h * 0.55) continue;
      for (const p of points) {
        for (const q of points) {
          if (Math.abs(p.y - q.y) > h * 0.08) continue;
          if (Math.min(p.y, q.y) < top + h * 0.22) continue;
          const bl = p.x < q.x ? p : q;
          const br = p.x < q.x ? q : p;
          if (Math.abs(bl.x - left.x) > w * 0.12 || Math.abs(br.x - right.x) > w * 0.12) continue;
          const width = right.x - left.x;
          const height = (bl.y + br.y) / 2 - top;
          const area = width * height;
          if (!best || area > best.area) best = { area, quad: [left, right, br, bl] };
        }
      }
    }
  }
  return best?.quad ?? null;
}

function warpFormToReference(canvas: HTMLCanvasElement, quad: [Pt, Pt, Pt, Pt]): HTMLCanvasElement | null {
  const dst = REFERENCE_FORM.map((point) => ({
    x: point.x * canvas.width,
    y: point.y * canvas.height,
  })) as [Pt, Pt, Pt, Pt];
  const homography = computeHomographySrcToDst(quad, dst);
  if (!homography) return null;
  return warpCanvasWithHomography(canvas, homography, canvas.width, canvas.height);
}

export function readLenguajeAnswerSheet(canvas: HTMLCanvasElement): LenguajeRead | null {
  if (canvas.width < 200 || canvas.height < 200) return null;
  const quad = findLenguajeFormQuad(canvas);
  if (quad) {
    const warped = warpFormToReference(canvas, quad);
    if (warped) return readGrid(warped, true);
  }
  if (isAlignedScanPage(canvas)) return readGrid(canvas, true);
  const fallback = fixedQuad(canvas);
  const dst: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: WARP_W, y: 0 },
    { x: WARP_W, y: WARP_H },
    { x: 0, y: WARP_H },
  ];
  const homography = computeHomographySrcToDst(fallback, dst);
  if (!homography) return null;
  const warped = warpCanvasWithHomography(canvas, homography, WARP_W, WARP_H);
  if (!warped) return null;
  return readGrid(warped, false);
}

function cropFixedCurpBand(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const x = Math.round(canvas.width * 0.08);
  const y = Math.round(canvas.height * 0.042);
  const cw = Math.round(canvas.width * 0.78);
  const ch = Math.round(canvas.height * 0.062);
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

/** Primera línea de tinta azul, arriba del formato. En la escuela 72 la CURP va en pluma. */
function firstBlueBand(
  canvas: HTMLCanvasElement,
  yStart: number,
  yEnd: number
): { y: number; height: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  const y0 = Math.max(0, Math.round(h * yStart));
  const y1 = Math.min(h, Math.round(h * yEnd));
  const x0 = Math.round(w * 0.18);
  const x1 = Math.round(w * 0.88);
  if (y1 <= y0 || x1 <= x0) return null;
  const width = x1 - x0;
  const data = ctx.getImageData(x0, y0, width, y1 - y0).data;
  const minCount = Math.max(4, Math.round((width / 2) * 0.012));
  let run = -1;
  for (let y = 0; y <= y1 - y0; y++) {
    let count = 0;
    if (y < y1 - y0) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        if (b > r + 20 && b > g + 8 && b < 200) count++;
      }
    }
    const on = count >= minCount;
    if (on && run < 0) run = y;
    if (!on && run >= 0) {
      if (y - run >= 4) {
        const pad = Math.round(h * 0.006);
        const top = Math.max(0, y0 + run - pad);
        const bottom = Math.min(h, y0 + y + pad);
        return { y: top, height: Math.max(1, bottom - top) };
      }
      run = -1;
    }
  }
  return null;
}

/** CURP encima de Nombre. Si la hoja viene chica o chueca, primero se endereza. */
export function cropLenguajeHandwrittenId(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const blue = firstBlueBand(canvas, 0.02, 0.12);
  if (blue) {
    const x = Math.round(canvas.width * 0.12);
    const cw = Math.round(canvas.width * 0.76);
    const out = document.createElement('canvas');
    out.width = Math.max(1, cw);
    out.height = Math.max(1, blue.height);
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, x, blue.y, cw, blue.height, 0, 0, cw, blue.height);
      return out;
    }
  }
  const quad = findLenguajeFormQuad(canvas);
  if (quad) {
    const warped = warpFormToReference(canvas, quad);
    if (warped) return cropFixedCurpBand(warped);
  }
  if (!isAlignedScanPage(canvas)) return null;
  return cropFixedCurpBand(canvas);
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
