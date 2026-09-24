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

/** Desplazamiento del overlay hacia el centro de la tinta, por columna. */
const OVERLAY_DX = { left: 0.009, right: 0.001 } as const;
const OVERLAY_DY = { left: 0.003, right: -0.002 } as const;

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
          if (lum < 140) dark++;
        }
      }
      const mean = sum / (samples * samples);
      const fill = dark / (samples * samples);
      if (mean < 125 && fill > 0.4) {
        const cx = x + side / 2;
        const cy = y + side / 2;
        const fillBox = (x0: number, y0: number, rw: number, rh: number) => {
          let n = 0;
          let tot = 0;
          const stepPx = Math.max(1, Math.round(Math.min(rw, rh) / 6));
          for (let py = y0; py < y0 + rh; py += stepPx) {
            for (let px = x0; px < x0 + rw; px += stepPx) {
              const ix = Math.round(px);
              const iy = Math.round(py);
              if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
              tot++;
              if (luminance(data, (iy * w + ix) * 4) < 155) n++;
            }
          }
          return tot ? n / tot : 0;
        };
        const local = fillBox(cx - side / 2, cy - side / 2, side, side);
        const wide = fillBox(cx - side * 1.6, cy - side / 2, side * 3.2, side);
        const tall = fillBox(cx - side / 2, cy - side * 1.6, side, side * 3.2);
        // Las marcas del encabezado son barras; los cuadros del bloque son compactos.
        if (local < 0.28) continue;
        if (wide > Math.max(0.55, local * 0.75) || tall > Math.max(0.55, local * 0.75)) continue;
        hits.push({ x: cx, y: cy, score: fill * (120 - mean) });
      }
    }
  }
  if (hits.length < 3) return null;

  hits.sort((a, b) => b.score - a.score);
  const picked: { x: number; y: number }[] = [];
  for (const hit of hits) {
    if (picked.some((p) => Math.hypot(p.x - hit.x, p.y - hit.y) < side * 2.2)) continue;
    picked.push(hit);
    if (picked.length >= 24) break;
  }

  const solid = picked.filter((p) => p.y > h * 0.2 && p.y < h * 0.96 && p.x > w * 0.08 && p.x < w * 0.92);
  const lefts = solid.filter((p) => p.x < w * 0.42);
  const rights = solid.filter((p) => p.x > w * 0.58);
  if (lefts.length < 1 || rights.length < 1) return null;

  const tl = lefts.reduce((a, b) => (a.y < b.y ? a : b));
  const bl = lefts.reduce((a, b) => (a.y > b.y ? a : b));
  const alignedRight = rights.filter((p) => Math.abs(p.y - tl.y) < h * 0.05);
  const tr = (alignedRight.length ? alignedRight : rights).reduce((a, b) => (a.y < b.y ? a : b));
  const inferred: Pt = { x: tr.x + (bl.x - tl.x), y: tr.y + (bl.y - tl.y) };
  const brHit = rights
    .filter((p) => p !== tr && Math.abs(p.x - tr.x) < w * 0.08 && p.y > tr.y + h * 0.12)
    .reduce<(typeof rights)[number] | null>((best, p) => {
      if (!best) return p;
      return Math.hypot(p.x - inferred.x, p.y - inferred.y) < Math.hypot(best.x - inferred.x, best.y - inferred.y)
        ? p
        : best;
    }, null);
  const br = brHit ?? inferred;
  if (tr.x - tl.x < w * 0.25) return null;
  if (Math.max(bl.y, br.y) - Math.min(tl.y, tr.y) < h * 0.2) return null;
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
      const x0 = (col === 0 ? GRID.leftColX0 : GRID.rightColX0) + (col === 0 ? OVERLAY_DX.left : OVERLAY_DX.right);
      const dy = col === 0 ? OVERLAY_DY.left : OVERLAY_DY.right;
      cells.push(
        CUSTOM20_OPTIONS.map((_, k) => ({
          x: x0 + k * GRID.colPitch - r,
          y: y + dy,
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

/**
 * La CURP a veces va pegada a NOMBRE y a veces más arriba.
 * Toma la primera línea ancha encima de los cuadros y deja fuera el rótulo NOMBRE.
 */
function sliceCurpLine(strip: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = strip.getContext('2d', { willReadFrequently: true });
  if (!ctx || typeof document === 'undefined') return null;
  const w = strip.width;
  const h = strip.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const bins = 12;
  const rowCov = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    const counts = new Array<number>(bins).fill(0);
    for (let x = Math.round(w * 0.12); x < Math.round(w * 0.88); x++) {
      if (luminance(data, (y * w + x) * 4) < 150) {
        const bin = Math.min(bins - 1, Math.floor(((x / w - 0.12) / 0.76) * bins));
        counts[bin]!++;
      }
    }
    let covered = 0;
    for (const n of counts) if (n > 2) covered++;
    rowCov[y] = covered / bins;
  }
  const win = 34;
  const nameMargin = Math.round(h * 0.12);
  let yLine = -1;
  for (let y = h - win - nameMargin; y >= 0; y--) {
    let cov = 0;
    for (let i = 0; i < win; i++) cov += rowCov[y + i]!;
    cov /= win;
    if (cov >= 0.34) {
      yLine = y;
      break;
    }
  }
  if (yLine < 0) return null;
  let y0 = yLine;
  let y1 = yLine + win;
  while (y0 > 0 && rowCov[y0 - 1]! > 0.2) y0--;
  while (y1 < h && rowCov[y1]! > 0.2) y1++;
  y0 = Math.max(0, y0 - 8);
  y1 = Math.min(h, y1 + 8);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = Math.max(48, y1 - y0);
  const outCtx = out.getContext('2d');
  if (!outCtx) return null;
  outCtx.fillStyle = '#fff';
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(strip, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
  return out;
}

/** Franja manuscrita encima de los cuadros (CURP), en la foto original. */
export function cropCustom20HandwrittenId(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const quad = findCornerSquares(canvas);
  if (!quad || typeof document === 'undefined') return null;
  const tl = quad[0];
  const tr = quad[1];
  const bl = quad[3];
  const downX = bl.x - tl.x;
  const downY = bl.y - tl.y;
  const edgeX = tr.x - tl.x;
  const edgeY = tr.y - tl.y;
  const pad = 0.2;
  const left = { x: tl.x - edgeX * pad, y: tl.y - edgeY * pad };
  const right = { x: tr.x + edgeX * pad, y: tr.y + edgeY * pad };
  const top = 0.26;
  const bot = 0.02;
  const src: [Pt, Pt, Pt, Pt] = [
    { x: left.x - downX * top, y: left.y - downY * top },
    { x: right.x - downX * top, y: right.y - downY * top },
    { x: right.x - downX * bot, y: right.y - downY * bot },
    { x: left.x - downX * bot, y: left.y - downY * bot },
  ];
  const outW = 720;
  const outH = 240;
  const dst: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const h = computeHomographySrcToDst(src, dst);
  if (!h) return null;
  const strip = warpCanvasWithHomography(canvas, h, outW, outH);
  if (!strip) return null;
  return sliceCurpLine(strip);
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
