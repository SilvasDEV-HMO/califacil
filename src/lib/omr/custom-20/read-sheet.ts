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
  const side = Math.max(6, Math.round(Math.min(w, h) * 0.012));
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
  const picked: { x: number; y: number; score: number }[] = [];
  for (const hit of hits) {
    if (picked.some((p) => Math.hypot(p.x - hit.x, p.y - hit.y) < side * 2.2)) continue;
    picked.push(hit);
    if (picked.length >= 40) break;
  }

  const solid = picked.filter((p) => p.y > h * 0.12 && p.y < h * 0.97 && p.x > w * 0.04 && p.x < w * 0.96);
  const quad = chooseCornerQuad(solid, w, h);
  return quad;
}

function chooseCornerQuad(
  solid: { x: number; y: number; score: number }[],
  w: number,
  h: number
): [Pt, Pt, Pt, Pt] | null {
  if (solid.length < 4) return null;
  let best: { quad: [Pt, Pt, Pt, Pt]; area: number } | null = null;
  const top = [...solid].sort((a, b) => b.score - a.score).slice(0, 24);
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i]!;
      const b = top[j]!;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx < w * 0.28 || dy > h * 0.08) continue;
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      const topEdge = Math.min(left.y, right.y);
      if (topEdge < h * 0.32 || topEdge > h * 0.62) continue;
      const bl = solid
        .filter((p) => p !== left && p !== right && p.y > left.y + h * 0.18 && Math.abs(p.x - left.x) < w * 0.1)
        .sort((p, q) => q.y - p.y)[0];
      const br = solid
        .filter((p) => p !== left && p !== right && p !== bl && p.y > right.y + h * 0.18 && Math.abs(p.x - right.x) < w * 0.1)
        .sort((p, q) => q.y - p.y)[0];
      if (!bl || !br) continue;
      const width = right.x - left.x;
      const height = Math.max(bl.y, br.y) - topEdge;
      if (width < w * 0.3 || height < h * 0.15) continue;
      const ratio = height / width;
      if (ratio < 0.55 || ratio > 2.2) continue;
      const area = width * height;
      if (!best || area > best.area) {
        best = { quad: [left, right, br, bl], area };
      }
    }
  }
  return best?.quad ?? null;
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

function rotateCanvas(canvas: HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const out = document.createElement('canvas');
  const swap = degrees === 90 || degrees === 270;
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function canvasWithCorners(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (findCornerSquares(canvas)) return canvas;
  for (const degrees of [180, 90, 270] as const) {
    const rotated = rotateCanvas(canvas, degrees);
    if (rotated && findCornerSquares(rotated)) return rotated;
  }
  return null;
}

/** Hoja de este escáner: vertical y con la CURP siempre en la misma franja. */
function isAlignedScanPage(canvas: HTMLCanvasElement): boolean {
  const aspect = canvas.height / Math.max(1, canvas.width);
  return aspect > 1.45 && aspect < 1.85;
}

/**
 * En los PDF del escáner la CURP cae siempre entre el 25.5% y el 30.8% de la altura.
 * Medido sobre las 17 hojas de 1A M TEC 06.
 */
function cropAlignedScanCurp(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !isAlignedScanPage(canvas)) return null;
  const x = Math.round(canvas.width * 0.22);
  const y = Math.round(canvas.height * 0.255);
  const cw = Math.round(canvas.width * 0.6);
  const ch = Math.round(canvas.height * 0.053);
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

/** Esquinas del bloque de respuestas cuando el escáner deja la hoja en el mismo lugar. */
function alignedScanAnswerQuad(canvas: HTMLCanvasElement): [Pt, Pt, Pt, Pt] | null {
  if (!isAlignedScanPage(canvas)) return null;
  const w = canvas.width;
  const h = canvas.height;
  return [
    { x: w * 0.276, y: h * 0.507 },
    { x: w * 0.75, y: h * 0.507 },
    { x: w * 0.744, y: h * 0.703 },
    { x: w * 0.271, y: h * 0.703 },
  ];
}

/**
 * Franja fija de la CURP, igual en todas las hojas de este formato.
 * Queda una altura de bloque por encima de los cuadros de las respuestas,
 * que es donde se escribe la CURP, encima de NOMBRE.
 */
export function cropCustom20HandwrittenId(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const aligned = cropAlignedScanCurp(canvas);
  if (aligned) return aligned;
  const oriented = canvasWithCorners(canvas);
  if (!oriented || typeof document === 'undefined') return null;
  const quad = findCornerSquares(oriented);
  if (!quad) return null;
  const tl = quad[0];
  const tr = quad[1];
  const bl = quad[3];
  const downX = bl.x - tl.x;
  const downY = bl.y - tl.y;
  const top = 1.28;
  const bot = 1.08;
  const src: [Pt, Pt, Pt, Pt] = [
    { x: tl.x - downX * top, y: tl.y - downY * top },
    { x: tr.x - downX * top, y: tr.y - downY * top },
    { x: tr.x - downX * bot, y: tr.y - downY * bot },
    { x: tl.x - downX * bot, y: tl.y - downY * bot },
  ];
  const outW = 900;
  const outH = 220;
  const dst: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const h = computeHomographySrcToDst(src, dst);
  if (!h) return null;
  return warpCanvasWithHomography(oriented, h, outW, outH);
}

export function warpCustom20Canvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const detected = findCornerSquares(canvas);
  if (detected) return warpToTemplate(canvas, detected);
  const fixed = alignedScanAnswerQuad(canvas);
  if (fixed) return warpToTemplate(canvas, fixed);
  const oriented = canvasWithCorners(canvas);
  if (!oriented || oriented === canvas) return null;
  const quad = findCornerSquares(oriented);
  if (!quad) return null;
  return warpToTemplate(oriented, quad);
}

/** Lee la hoja. Devuelve null si no encuentra los cuadros de referencia. */
export function readCustom20AnswerSheet(canvas: HTMLCanvasElement): Custom20Read | null {
  const warped = warpCustom20Canvas(canvas);
  if (!warped) return null;
  return readGrid(warped);
}
