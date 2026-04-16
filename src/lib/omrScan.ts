/**
 * Lectura aproximada de la banda CaliFacil del pie de hoja impresa.
 * Debe coincidir con el layout de `printExam.ts` (tabla 10 filas × N columnas de burbujas).
 */

import { CALIFACIL_OMR_GUIDE_ASPECT_RATIO } from '@/lib/printExam';

export const CALIFACIL_OMR_SCAN = {
  /** Fracción inferior de la imagen donde cae el recuadro CaliFacil impreso */
  bottomBandRatio: 0.46,
  /** Incluye título + cabecera A–D; el muestreo de 10 filas usa solo el cuerpo de la tabla. */
  titleStripRatioOfBand: 0.19,
  /** Ancho relativo reservado a la columna del número de pregunta */
  qnumWidthRatio: 0.09,
  /**
   * Peso del anillo en (fillDark - ringDark * R). Menor R = mejor para burbujas bien
   * rellenas (centro y anillo igual de oscuros); con R≈0.9 el score quedaba casi 0 y
   * se rechazaban marcas claras a simple vista.
   */
  ringDarknessWeight: 0.68,
  /** Intensidad mínima de relleno real (score fill − weight·ring tras elegir mejor columna) */
  minMarkDarkness: 0.045,
  /** Ventaja mínima de la mejor burbuja contra la segunda */
  minBestVsSecondGap: 0.028,
  /** Relación mínima entre mejor y segunda para evitar dobles marcas */
  minBestVsSecondRatio: 1.2,
  /** Diferencia mínima centro-anillo para confirmar anillo impreso + centro claro (no relleno) */
  minCenterVsRingDelta: 0.03,
  /** Si el disco interior es tan oscuro, damos por válida una marca aunque centro≈anillo (tinta llena). */
  minSolidCenterDarkness: 0.19,
  /** Tras binarizar (Otsu por fila), fracción mínima de píxeles oscuros en disco para considerar marca. */
  minBubbleInkFraction: 0.34,
  /** Diferencia mínima entre la mayor y la segunda fracción de tinta en la fila. */
  minInkFractionGap: 0.11,
  /** Dos columnas por encima de esto (binario) ⇒ posible doble marca / ambigüedad. */
  ambiguousInkTwinFloor: 0.3,
  /**
   * Franja horizontal por columna (toda la celda A–D): ventaja mínima de la mejor columna
   * sobre la segunda tras restar la mediana por fila (anula sombras / viñeteado).
   */
  minStripMedianGap: 0.018,
  /** Mínimo exceso sobre la mediana por fila en la franja elegida para contar como marca. */
  minStripAboveMedian: 0.012,
} as const;

/**
 * Parámetros inspirados en [OMRChecker](https://github.com/Udayraj123/OMRChecker)
 * (CLAHE, GAMMA_LOW, normalización) para fotos de móvil con sombras / bajo contraste.
 */
const OMRCHECKER_STYLE_PRE = {
  claheClipLimit: 5,
  tileW: 16,
  tileH: 16,
  /** `threshold_params.GAMMA_LOW` en OMRChecker `defaults/config.py` */
  gammaLow: 0.7,
} as const;

/**
 * Barrido del ancho relativo de la columna N.º (debe alinear con impresión ~9%).
 * Evita lecturas sistemáticas en una sola columna (p. ej. todo "D") cuando la foto está desplazada.
 */
const QNUM_WIDTH_SWEEP = [0.065, 0.075, 0.085, 0.09, 0.1, 0.11, 0.125, 0.14] as const;

/** Subconjunto para cámara en vivo (menos latencia por frame). */
const QNUM_WIDTH_SWEEP_LIVE = [0.075, 0.085, 0.09, 0.1, 0.11, 0.125] as const;

/**
 * Traslación horizontal del área de burbujas en px (corrige desalineación cámara vs rejilla).
 * Se combina con el barrido de `qnumWidthRatio`.
 */
const COLUMN_SHIFT_PX_SWEEP = [-14, -10, -6, -3, 0, 3, 6, 10, 14] as const;
const COLUMN_SHIFT_PX_LIVE = [-10, -6, 0, 6, 10] as const;

export type CalifacilScanOptions = {
  /** Si true, no recorta al marco guía (la imagen ya pasó por prepare/autoOrient). */
  skipGuideCrop?: boolean;
  /** Barrido de `qnumWidthRatio`: `live` = menos valores (vídeo en vivo). */
  qnumSweep?: 'full' | 'live';
  /** Barrido de desplazamiento horizontal en px: `live` = menos valores. */
  columnShiftSweep?: 'full' | 'live';
};

type ScanThresholds = {
  minMarkDarkness: number;
  minBestVsSecondGap: number;
  minBestVsSecondRatio?: number;
  minCenterVsRingDelta?: number;
  minSolidCenterDarkness?: number;
  ringDarknessWeight?: number;
};

export type OmrScanRowDetail = {
  pick: number | null;
  /** Lectura dudosa: conviene segunda opinión (p. ej. visión). */
  ambiguous: boolean;
  /** Fracción de píxeles "tinta" por columna (0–1), tras umbral Otsu en la franja de la fila. */
  inkFractions: number[];
};

export type OmrScanMetaResult = {
  picks: (number | null)[];
  rows: OmrScanRowDetail[];
  /** Hay filas ambiguas donde la visión puede ayudar. */
  needsVisionAssist: boolean;
};

type ScanDetailedResult = {
  picks: (number | null)[];
  resolvedCount: number;
  confidenceSum: number;
  rows: OmrScanRowDetail[];
};

type OmrGeometryProfile = {
  bottomBandRatio: number;
  titleStripRatioOfBand: number;
  qnumWidthRatio: number;
};

type Point = { x: number; y: number };

type LineXFromY = { m: number; b: number }; // x = m*y + b
type LineYFromX = { m: number; b: number }; // y = m*x + b

function sampleDiskDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): number {
  let sum = 0;
  let n = 0;
  const r2 = radiusPx * radiusPx;
  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function sampleAnnulusDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  innerRadiusPx: number,
  outerRadiusPx: number
): number {
  let sum = 0;
  let n = 0;
  const in2 = innerRadiusPx * innerRadiusPx;
  const out2 = outerRadiusPx * outerRadiusPx;
  for (let dy = -outerRadiusPx; dy <= outerRadiusPx; dy++) {
    for (let dx = -outerRadiusPx; dx <= outerRadiusPx; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > out2 || d2 < in2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function pixelGray255(data: Uint8ClampedArray, idx: number): number {
  return Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
}

function buildRowGrayHistogram(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  step: number
): { hist: Uint32Array; total: number } {
  const hist = new Uint32Array(256);
  let total = 0;
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y += step) {
    for (let x = xa; x <= xb; x += step) {
      const i = (y * width + x) * 4;
      const g = pixelGray255(data, i);
      hist[g]++;
      total++;
    }
  }
  return { hist, total };
}

function otsuThreshold256(hist: Uint32Array, total: number): number {
  if (total < 8) return 140;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

function sampleDiskInkFractionAtThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number,
  grayThreshold: number
): number {
  let ink = 0;
  let n = 0;
  const r2 = radiusPx * radiusPx;
  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      if (pixelGray255(data, i) < grayThreshold) ink++;
      n++;
    }
  }
  return n > 0 ? ink / n : 0;
}

function medianOfNumbers(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Mejor columna y separación entre 1.º y 2.º tras restar mediana (franjas A/B/C/D). */
function bestMedianStripPick(adj: number[]): {
  bestIdx: number;
  gap: number;
  aboveMed: number;
} {
  if (adj.length === 0) return { bestIdx: 0, gap: 0, aboveMed: 0 };
  let bestIdx = 0;
  for (let c = 1; c < adj.length; c++) {
    if (adj[c]! > adj[bestIdx]!) bestIdx = c;
  }
  let second = -Infinity;
  for (let c = 0; c < adj.length; c++) {
    if (c === bestIdx) continue;
    second = Math.max(second, adj[c]!);
  }
  return {
    bestIdx,
    gap: adj[bestIdx]! - second,
    aboveMed: adj[bestIdx]!,
  };
}

/** Fracción de píxeles oscuros (Otsu) en rectángulo; paso 2 para fotos grandes. */
function sampleRectInkFractionAtThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  grayThreshold: number,
  step = 2
): number {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  if (xb < xa || yb < ya) return 0;
  let ink = 0;
  let n = 0;
  for (let y = ya; y <= yb; y += step) {
    for (let x = xa; x <= xb; x += step) {
      const i = (y * width + x) * 4;
      if (pixelGray255(data, i) < grayThreshold) ink++;
      n++;
    }
  }
  return n > 0 ? ink / n : 0;
}

/**
 * Por cada columna de burbujas, integra tinta en toda la franja (A/B/C/D), no solo el centro.
 * Reduce errores cuando el círculo está desplazado o la foto está borrosa / con sombra lateral.
 */
function columnStripInkFractions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bubbleAreaLeft: number,
  cellW: number,
  cols: number,
  y0: number,
  y1: number,
  grayThreshold: number
): number[] {
  const out: number[] = [];
  const margin = cellW * 0.07;
  for (let c = 0; c < cols; c++) {
    const xa = bubbleAreaLeft + c * cellW + margin;
    const xb = bubbleAreaLeft + (c + 1) * cellW - margin;
    out.push(
      sampleRectInkFractionAtThreshold(data, width, height, xa, xb, y0, y1, grayThreshold)
    );
  }
  return out;
}

function drawSourceToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxSide = 1100
): HTMLCanvasElement | null {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (srcW < 40 || srcH < 40) return null;

  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

function rotateCanvas(canvas: HTMLCanvasElement, angleDeg: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (angleDeg === 0) return canvas;
  const out = document.createElement('canvas');
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (angleDeg === 180) {
    out.width = srcW;
    out.height = srcH;
  } else {
    out.width = srcH;
    out.height = srcW;
  }
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  if (angleDeg === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (angleDeg === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function rotateCanvasByDegrees(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.max(1, Math.round(canvas.width * cos + canvas.height * sin));
  const outH = Math.max(1, Math.round(canvas.width * sin + canvas.height * cos));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;

  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function fitLineXFromY(points: Point[]): LineXFromY | null {
  if (points.length < 6) return null;
  let sumY = 0;
  let sumX = 0;
  let sumYY = 0;
  let sumYX = 0;
  for (const p of points) {
    sumY += p.y;
    sumX += p.x;
    sumYY += p.y * p.y;
    sumYX += p.y * p.x;
  }
  const n = points.length;
  const den = n * sumYY - sumY * sumY;
  if (Math.abs(den) < 1e-6) return null;
  const m = (n * sumYX - sumY * sumX) / den;
  const b = (sumX - m * sumY) / n;
  return { m, b };
}

function fitLineYFromX(points: Point[]): LineYFromX | null {
  if (points.length < 6) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }
  const n = points.length;
  const den = n * sumXX - sumX * sumX;
  if (Math.abs(den) < 1e-6) return null;
  const m = (n * sumXY - sumX * sumY) / den;
  const b = (sumY - m * sumX) / n;
  return { m, b };
}

function intersectLineXFromYAndYFromX(lineX: LineXFromY, lineY: LineYFromX): Point | null {
  const den = 1 - lineX.m * lineY.m;
  if (Math.abs(den) < 1e-6) return null;
  const x = (lineX.m * lineY.b + lineX.b) / den;
  const y = lineY.m * x + lineY.b;
  return { x, y };
}

function solveLinearSystem8(matrix: number[][], rhs: number[]): number[] | null {
  const n = 8;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-10) return null;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const div = a[col][col];
    for (let c = col; c <= n; c++) a[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row[n]);
}

function computeHomographyFromRectToQuad(
  dstWidth: number,
  dstHeight: number,
  quad: [Point, Point, Point, Point]
): number[] | null {
  const srcPts: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: dstWidth - 1, y: 0 },
    { x: dstWidth - 1, y: dstHeight - 1 },
    { x: 0, y: dstHeight - 1 },
  ];
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const u = srcPts[i].x;
    const v = srcPts[i].y;
    const x = quad[i].x;
    const y = quad[i].y;
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    rhs.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    rhs.push(y);
  }
  const sol = solveLinearSystem8(matrix, rhs);
  if (!sol) return null;
  return sol; // [a,b,c,d,e,f,g,h]
}

function sampleBilinear(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v00 = data[i00 + c];
    const v10 = data[i10 + c];
    const v01 = data[i01 + c];
    const v11 = data[i11 + c];
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;
    out[c] = v0 * (1 - ty) + v1 * ty;
  }
  return out;
}

function detectCalifacilQuad(canvas: HTMLCanvasElement): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 120 || height < 120) return null;

  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;
  const rowCounts = new Array<number>(height).fill(0);
  const colCounts = new Array<number>(width).fill(0);

  let darkSum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const darkness = 1 - lum;
      darkSum += darkness;
      n++;
    }
  }
  const avgDark = darkSum / Math.max(1, n);
  const darkThreshold = Math.min(0.5, Math.max(0.22, avgDark + 0.16));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const darkness = 1 - lum;
      if (darkness >= darkThreshold) {
        rowCounts[y]++;
        colCounts[x]++;
      }
    }
  }

  const rowMin = Math.max(8, Math.floor(width * 0.1));
  const colMin = Math.max(8, Math.floor(height * 0.1));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] >= rowMin) {
      top = y;
      break;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (rowCounts[y] >= rowMin) {
      bottom = y;
      break;
    }
  }
  for (let x = 0; x < width; x++) {
    if (colCounts[x] >= colMin) {
      left = x;
      break;
    }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (colCounts[x] >= colMin) {
      right = x;
      break;
    }
  }
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom - top < height * 0.22 || right - left < width * 0.22) return null;

  const y0 = Math.max(0, top - Math.floor(height * 0.03));
  const y1 = Math.min(height - 1, bottom + Math.floor(height * 0.03));
  const x0 = Math.max(0, left - Math.floor(width * 0.03));
  const x1 = Math.min(width - 1, right + Math.floor(width * 0.03));

  const leftPts: Point[] = [];
  const rightPts: Point[] = [];
  const topPts: Point[] = [];
  const bottomPts: Point[] = [];
  const midX = Math.floor((x0 + x1) / 2);
  const midY = Math.floor((y0 + y1) / 2);

  for (let y = y0; y <= y1; y += 2) {
    let lx = -1;
    for (let x = x0; x <= midX; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        lx = x;
        break;
      }
    }
    if (lx >= 0) leftPts.push({ x: lx, y });

    let rx = -1;
    for (let x = x1; x >= midX; x--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        rx = x;
        break;
      }
    }
    if (rx >= 0) rightPts.push({ x: rx, y });
  }

  for (let x = x0; x <= x1; x += 2) {
    let ty = -1;
    for (let y = y0; y <= midY; y++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        ty = y;
        break;
      }
    }
    if (ty >= 0) topPts.push({ x, y: ty });

    let by = -1;
    for (let y = y1; y >= midY; y--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        by = y;
        break;
      }
    }
    if (by >= 0) bottomPts.push({ x, y: by });
  }

  const l = fitLineXFromY(leftPts);
  const r = fitLineXFromY(rightPts);
  const t = fitLineYFromX(topPts);
  const b = fitLineYFromX(bottomPts);
  if (!l || !r || !t || !b) return null;

  const tl = intersectLineXFromYAndYFromX(l, t);
  const tr = intersectLineXFromYAndYFromX(r, t);
  const br = intersectLineXFromYAndYFromX(r, b);
  const bl = intersectLineXFromYAndYFromX(l, b);
  if (!tl || !tr || !br || !bl) return null;

  const quad: [Point, Point, Point, Point] = [tl, tr, br, bl];
  const inside = quad.every(
    (p) => p.x >= -width * 0.1 && p.x <= width * 1.1 && p.y >= -height * 0.1 && p.y <= height * 1.1
  );
  if (!inside) return null;
  const area =
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y)
    ) * 0.5;
  if (area < width * height * 0.08) return null;
  return quad;
}

function warpPerspectiveToRect(
  canvas: HTMLCanvasElement,
  quad: [Point, Point, Point, Point]
): HTMLCanvasElement | null {
  const topW = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const bottomW = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const leftH = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const rightH = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
  const outW = Math.max(120, Math.round((topW + bottomW) * 0.5));
  const outH = Math.max(120, Math.round((leftH + rightH) * 0.5));

  const h = computeHomographyFromRectToQuad(outW, outH, quad);
  if (!h) return null;
  const [a, b, c, d, e, f, g, hh] = h;

  const srcCtx = canvas.getContext('2d');
  if (!srcCtx) return null;
  const src = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const srcData = src.data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d');
  if (!outCtx) return null;
  const outId = outCtx.createImageData(outW, outH);
  const outData = outId.data;

  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const den = g * u + hh * v + 1;
      if (Math.abs(den) < 1e-9) continue;
      const x = (a * u + b * v + c) / den;
      const y = (d * u + e * v + f) / den;
      const outIdx = (v * outW + u) * 4;
      if (x < 0 || y < 0 || x >= canvas.width - 1 || y >= canvas.height - 1) {
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
        outData[outIdx + 3] = 255;
        continue;
      }
      const [r, gg, bb, aa] = sampleBilinear(srcData, canvas.width, canvas.height, x, y);
      outData[outIdx] = r;
      outData[outIdx + 1] = gg;
      outData[outIdx + 2] = bb;
      outData[outIdx + 3] = aa;
    }
  }
  outCtx.putImageData(outId, 0, 0);
  return out;
}

function applyPerspectiveCorrection(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const quad = detectCalifacilQuad(canvas);
  if (!quad) return canvas;
  return warpPerspectiveToRect(canvas, quad) ?? canvas;
}

/**
 * Recorta la región equivalente al marco naranja en Calificar (centrado 50%/62%, ancho 86%, misma relación de aspecto).
 * Alinea el análisis OMR con lo que el usuario encuadra en cámara.
 */
export function cropCanvasToCalifacilGuideOverlay(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 80 || H < 80) return null;
  const ar = CALIFACIL_OMR_GUIDE_ASPECT_RATIO;
  const rectW = Math.min(W * 0.86, W - 2);
  const rectH = rectW / ar;
  if (rectH > H * 0.98) return null;
  const cx = W * 0.5;
  const cy = H * 0.62;
  let left = Math.round(cx - rectW / 2);
  let top = Math.round(cy - rectH / 2);
  const rw = Math.round(rectW);
  const rh = Math.round(rectH);
  left = Math.max(0, Math.min(left, W - rw));
  top = Math.max(0, Math.min(top, H - rh));
  if (rw < 100 || rh < 48 || left + rw > W || top + rh > H) return null;
  const out = document.createElement('canvas');
  out.width = rw;
  out.height = rh;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, left, top, rw, rh, 0, 0, rw, rh);
  return out;
}

/** Escala, recorta al marco guía y devuelve imagen lista para orientar/escanear. */
export function prepareCalifacilScanInput(source: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement | null {
  const base = drawSourceToCanvas(source, 1400);
  if (!base) return null;
  return cropCanvasToCalifacilGuideOverlay(base) ?? base;
}

function normalizeMinMaxInPlaceGray(gray: Uint8Array): void {
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) return;
  const scale = 255 / (max - min);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round((gray[i]! - min) * scale);
  }
}

function gammaCorrectGrayInPlace(gray: Uint8Array, gamma: number): void {
  const invGamma = 1 / gamma;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]! / 255;
    gray[i] = Math.round(Math.pow(v, invGamma) * 255);
  }
}

/** CLAHE por teselas (similar a `cv2.createCLAHE` en OMRChecker). */
function claheGrayToNewBuffer(
  src: Uint8Array,
  w: number,
  h: number,
  tileW: number,
  tileH: number,
  clipLimit: number
): Uint8Array {
  const dst = new Uint8Array(w * h);
  const tilesX = Math.ceil(w / tileW);
  const tilesY = Math.ceil(h / tileH);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(w, x0 + tileW);
      const y1 = Math.min(h, y0 + tileH);
      let tilePixels = 0;
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[src[y * w + x]!]++;
          tilePixels++;
        }
      }
      const limit = Math.max(1, Math.floor((clipLimit * tilePixels) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i]! > limit) {
          excess += hist[i]! - limit;
          hist[i] = limit;
        }
      }
      const add = Math.floor(excess / 256);
      for (let i = 0; i < 256; i++) {
        hist[i] += add;
      }
      let rem = excess - add * 256;
      for (let i = 0; i < 256 && rem > 0; i++) {
        const space = limit - hist[i]!;
        if (space > 0) {
          const take = Math.min(space, rem);
          hist[i] += take;
          rem -= take;
        }
      }
      const cdf = new Uint32Array(256);
      cdf[0] = hist[0]!;
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1]! + hist[i]!;
      let cdfMin = 0;
      for (let i = 0; i < 256; i++) {
        if (cdf[i]! > 0) {
          cdfMin = cdf[i]!;
          break;
        }
      }
      const denom = Math.max(1, tilePixels - cdfMin);
      const lut = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        lut[i] = Math.min(255, Math.round(((cdf[i]! - cdfMin) * 255) / denom));
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          dst[y * w + x] = lut[src[y * w + x]!]!;
        }
      }
    }
  }
  return dst;
}

function grayBufferToRgbCanvas(gray: Uint8Array, w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const g = gray[i]!;
    d[j] = g;
    d[j + 1] = g;
    d[j + 2] = g;
    d[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

function getGrayBufferFromCanvas(canvas: HTMLCanvasElement): { gray: Uint8Array; w: number; h: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 32 || h < 32) return null;
  const id = ctx.getImageData(0, 0, w, h);
  const src = id.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!);
  }
  return { gray, w, h };
}

/**
 * Cadena similar a OMRChecker `read_omr_response` (CLAHE → gamma → normalize) antes de leer medias.
 * Mejora fotos de cámara con sombras; se combina con el escaneo original y se elige la lectura con mejor puntuación.
 */
function applyOmrcheckerStylePreprocess(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const got = getGrayBufferFromCanvas(canvas);
  if (!got) return null;
  let { gray, w, h } = got;
  normalizeMinMaxInPlaceGray(gray);
  gray = claheGrayToNewBuffer(
    gray,
    w,
    h,
    OMRCHECKER_STYLE_PRE.tileW,
    OMRCHECKER_STYLE_PRE.tileH,
    OMRCHECKER_STYLE_PRE.claheClipLimit
  );
  gammaCorrectGrayInPlace(gray, OMRCHECKER_STYLE_PRE.gammaLow);
  normalizeMinMaxInPlaceGray(gray);
  return grayBufferToRgbCanvas(gray, w, h);
}

/**
 * Variantes a probar: original / corrección de perspectiva / mismas con preprocesado estilo OMRChecker.
 * `preferFullSheetFirst`: orden de perfiles geométricos (igual que antes para raw vs corregido).
 */
function buildOmrScanCanvasVariants(
  canvas: HTMLCanvasElement,
  corrected: HTMLCanvasElement
): Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> {
  const out: Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> = [];
  const pushUnique = (c: HTMLCanvasElement, preferFullFirst: boolean) => {
    if (!out.some((o) => o.canvas === c)) {
      out.push({ canvas: c, preferFullSheetFirst: preferFullFirst });
    }
  };
  pushUnique(canvas, true);
  if (corrected !== canvas) {
    pushUnique(corrected, false);
  }
  const preOrig = applyOmrcheckerStylePreprocess(canvas);
  if (preOrig) {
    pushUnique(preOrig, true);
  }
  if (corrected !== canvas) {
    const preCorr = applyOmrcheckerStylePreprocess(corrected);
    if (preCorr) {
      pushUnique(preCorr, false);
    }
  }
  return out;
}

/**
 * Proyección de borde horizontal: promedio de |I(y,x) − I(y−1,x)| en la franja de burbujas.
 * Los trazos negros de la tabla producen picos en y.
 */
function buildHorizontalEdgeProjection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Float64Array {
  const proj = new Float64Array(height);
  const ya = Math.max(1, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const denom = Math.max(1, xb - xa);
  for (let y = ya; y < yb; y++) {
    let s = 0;
    for (let x = xa; x < xb; x++) {
      const i1 = (y * width + x) * 4;
      const i0 = ((y - 1) * width + x) * 4;
      s += Math.abs(pixelGray255(data, i1) - pixelGray255(data, i0));
    }
    proj[y] = s / denom;
  }
  return proj;
}

function boxSmoothInRange(proj: Float64Array, y0: number, y1: number, radius: number): void {
  if (radius < 1) return;
  const lo = Math.max(0, y0);
  const hi = Math.min(proj.length - 1, y1);
  const tmp = new Float64Array(hi - lo + 1);
  for (let i = lo; i <= hi; i++) tmp[i - lo] = proj[i];
  const w = radius * 2 + 1;
  for (let y = lo + radius; y <= hi - radius; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[y - lo + k];
    proj[y] = sum / w;
  }
}

/** Picos locales con fusión de vecinos demasiado cercanos (se queda el más alto). */
function findHorizontalLinePeaks(
  proj: Float64Array,
  y0: number,
  y1: number,
  minDist: number,
  minRel: number
): number[] {
  let peakMax = 0;
  for (let y = y0 + 2; y < y1 - 2; y++) peakMax = Math.max(peakMax, proj[y]);
  const thr = Math.max(peakMax * minRel, 1e-6);
  const raw: number[] = [];
  for (let y = y0 + 2; y < y1 - 2; y++) {
    const v = proj[y];
    if (v < thr) continue;
    if (v <= proj[y - 1] || v < proj[y + 1]) continue;
    raw.push(y);
  }
  raw.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const y of raw) {
    if (merged.length === 0) {
      merged.push(y);
      continue;
    }
    const last = merged[merged.length - 1]!;
    if (y - last < minDist) {
      if (proj[y] > proj[last]) merged[merged.length - 1] = y;
    } else {
      merged.push(y);
    }
  }
  return merged;
}

/**
 * Elige 11 líneas horizontales coherentes con el espaciado esperado (~altura de fila).
 * Devuelve y ordenadas de arriba abajo o null.
 */
function pickElevenTableLines(
  peaks: number[],
  expectedGap: number,
  dataTop: number,
  dataHeight: number
): number[] | null {
  if (peaks.length < 11) return null;
  peaks = [...peaks].sort((a, b) => a - b);
  const yMin = dataTop - dataHeight * 0.08;
  const yMax = dataTop + dataHeight * 1.08;
  const filtered = peaks.filter((y) => y >= yMin && y <= yMax);
  if (filtered.length < 11) return null;

  let best: number[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const n = filtered.length;
  for (let s = 0; s <= n - 11; s++) {
    const window = filtered.slice(s, s + 11);
    const gaps: number[] = [];
    for (let i = 0; i < 10; i++) gaps.push(window[i + 1]! - window[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / 10;
    if (mean < expectedGap * 0.42 || mean > expectedGap * 2.2) continue;
    const var_ = gaps.reduce((acc, g) => acc + (g - mean) * (g - mean), 0) / 10;
    const cv = mean > 1e-6 ? Math.sqrt(var_) / mean : 1;
    if (cv > 0.42) continue;
    const spacingPenalty =
      Math.abs(mean - expectedGap) / (expectedGap + 1e-6);
    const score = var_ + spacingPenalty * expectedGap * expectedGap * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = window;
    }
  }
  return best;
}

/**
 * Detecta 11 líneas horizontales de la rejilla impresa y devuelve sus y (11 bordes → 10 filas).
 */
function refineOmrRowBoundariesFromTableLines(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bubbleAreaLeft: number,
  dataTop: number,
  dataHeight: number
): number[] | null {
  const rowHGuess = dataHeight / 10;
  const pad = Math.max(3, rowHGuess * 0.12);
  const yStart = Math.max(1, Math.floor(dataTop - pad));
  const yEnd = Math.min(height - 2, Math.ceil(dataTop + dataHeight + pad));
  const xPad = Math.max(2, width * 0.015);
  const x0 = Math.min(width - 10, bubbleAreaLeft + xPad);
  const x1 = width - 2;
  if (x1 <= x0 + 12 || yEnd <= yStart + rowHGuess * 4) return null;

  const proj = buildHorizontalEdgeProjection(data, width, height, x0, x1, yStart, yEnd);
  boxSmoothInRange(proj, yStart, yEnd, 2);

  const minDist = Math.max(2, rowHGuess * 0.38);
  const peaks = findHorizontalLinePeaks(proj, yStart, yEnd, minDist, 0.14);
  const lines = pickElevenTableLines(peaks, rowHGuess, dataTop, dataHeight);
  if (!lines) return null;

  for (let i = 0; i < 10; i++) {
    const g = lines[i + 1]! - lines[i]!;
    if (g < 3 || g > rowHGuess * 2.5) return null;
  }
  return lines;
}

/**
 * Comprueba si la imagen (recorte guía CaliFacil ya orientado) muestra la rejilla impresa
 * de la tabla de respuestas (~11 líneas horizontales coherentes). Las escenas sin examen
 * suelen no cumplir esto, así que sirve para no “leer” basura con la cámara.
 */
export function hasCalifacilPrintedTableGrid(
  canvas: HTMLCanvasElement,
  columns: number
): boolean {
  void columns;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { width, height } = canvas;
  if (width < 80 || height < 80) return false;
  const id = ctx.getImageData(0, 0, width, height);
  const { data } = id;

  const profiles: OmrGeometryProfile[] = [
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.12, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];
  const shifts = [0, -8, 8, -14, 14];

  for (const profile of profiles) {
    const bandH = height * profile.bottomBandRatio;
    const bandTop = height - bandH;
    const dataTop = bandTop + bandH * profile.titleStripRatioOfBand;
    const dataHeight = bandH * (1 - profile.titleStripRatioOfBand);
    const qNumW = width * profile.qnumWidthRatio;
    for (const colShift of shifts) {
      const bubbleAreaLeft = Math.max(
        2,
        Math.min(width * 0.45, Math.round(qNumW + colShift))
      );
      const lineYs = refineOmrRowBoundariesFromTableLines(
        data,
        width,
        height,
        bubbleAreaLeft,
        dataTop,
        dataHeight
      );
      if (lineYs && lineYs.length === 11) return true;
    }
  }
  return false;
}

/**
 * True si parece una hoja CaliFacil impresa (rejilla detectable). Aplica la misma
 * corrección de perspectiva que el escaneo OMR.
 */
export function isCalifacilExamSheetLikely(
  canvas: HTMLCanvasElement,
  columns: number
): boolean {
  if (typeof document === 'undefined') return false;
  const corrected = applyPerspectiveCorrection(canvas);
  return hasCalifacilPrintedTableGrid(corrected, columns);
}

function scanCalifacilOmrCanvasDetailed(
  canvas: HTMLCanvasElement,
  columns: number,
  thresholds: ScanThresholds
): ScanDetailedResult {
  return scanCalifacilOmrCanvasDetailedWithProfile(
    canvas,
    columns,
    thresholds,
    CALIFACIL_OMR_SCAN
  );
}

function scanCalifacilOmrCanvasDetailedWithProfile(
  canvas: HTMLCanvasElement,
  columns: number,
  thresholds: ScanThresholds,
  profile: OmrGeometryProfile,
  columnShiftPx = 0
): ScanDetailedResult {
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const out: (number | null)[] = Array(10).fill(null);
  const rowMetas: OmrScanRowDetail[] = [];
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    for (let i = 0; i < 10; i++) {
      rowMetas.push({ pick: null, ambiguous: false, inkFractions: [] });
    }
    return { picks: out, resolvedCount: 0, confidenceSum: 0, rows: rowMetas };
  }
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = id;

  const bandH = height * profile.bottomBandRatio;
  const bandTop = height - bandH;
  const dataTop = bandTop + bandH * profile.titleStripRatioOfBand;
  const dataHeight = bandH * (1 - profile.titleStripRatioOfBand);
  const rowH = dataHeight / 10;

  const qNumW = width * profile.qnumWidthRatio;
  const bubbleAreaLeft = Math.max(
    2,
    Math.min(width * 0.45, Math.round(qNumW + columnShiftPx))
  );
  const bubbleAreaW = width - bubbleAreaLeft;
  const cellW = bubbleAreaW / cols;

  const lineYs = refineOmrRowBoundariesFromTableLines(
    data,
    width,
    height,
    bubbleAreaLeft,
    dataTop,
    dataHeight
  );

  const minInkFrac = CALIFACIL_OMR_SCAN.minBubbleInkFraction;
  const minInkGap = CALIFACIL_OMR_SCAN.minInkFractionGap;
  const twinFloor = CALIFACIL_OMR_SCAN.ambiguousInkTwinFloor;

  let resolvedCount = 0;
  let confidenceSum = 0;
  for (let row = 0; row < 10; row++) {
    let yRowTop: number;
    let yRowBot: number;
    let cy: number;
    if (lineYs && lineYs.length === 11) {
      yRowTop = lineYs[row]!;
      yRowBot = lineYs[row + 1]!;
      cy = (yRowTop + yRowBot) * 0.5;
      // Última fila: si el hueco entre la línea 9 y 10 no coincide con el resto, la rejilla
      // detectada suele desplazar el centro vertical y se lee mal la columna (p. ej. B → A).
      if (row === 9) {
        let sumG = 0;
        for (let i = 0; i < 9; i++) {
          sumG += lineYs[i + 1]! - lineYs[i]!;
        }
        const meanGap = sumG / 9;
        const lastGap = lineYs[10]! - lineYs[9]!;
        if (lastGap < meanGap * 0.68 || lastGap > meanGap * 1.42) {
          yRowTop = dataTop + 9 * rowH;
          yRowBot = dataTop + 10 * rowH;
          cy = dataTop + 9.5 * rowH;
        }
      }
    } else {
      yRowTop = dataTop + row * rowH;
      yRowBot = dataTop + (row + 1) * rowH;
      cy = dataTop + (row + 0.5) * rowH;
    }
    const localRowH = Math.max(1, yRowBot - yRowTop);
    const radiusPx = Math.max(2, Math.min(cellW, localRowH) * 0.22);
    const diskRInk = Math.max(2, Math.round(radiusPx * 0.9));

    const { hist, total } = buildRowGrayHistogram(
      data,
      width,
      height,
      bubbleAreaLeft,
      width - 1,
      yRowTop,
      yRowBot,
      2
    );
    const otsuT = otsuThreshold256(hist, Math.max(1, total));

    const stripPad = Math.max(1, Math.floor(localRowH * 0.2));
    let stripY0 = Math.min(height - 1, Math.ceil(yRowTop + stripPad));
    let stripY1 = Math.max(stripY0, Math.floor(yRowBot - stripPad));
    let stripFracs = columnStripInkFractions(
      data,
      width,
      height,
      bubbleAreaLeft,
      cellW,
      cols,
      stripY0,
      stripY1,
      otsuT
    );
    if (row === 9 && lineYs && lineYs.length === 11) {
      const y0g = Math.min(height - 1, Math.ceil(dataTop + 9 * rowH + stripPad));
      const y1g = Math.max(y0g, Math.floor(dataTop + 10 * rowH - stripPad));
      const stripGeo = columnStripInkFractions(
        data,
        width,
        height,
        bubbleAreaLeft,
        cellW,
        cols,
        y0g,
        y1g,
        otsuT
      );
      const medAdj = (arr: number[]) => arr.map((f) => f - medianOfNumbers(arr));
      const pLine = bestMedianStripPick(medAdj(stripFracs));
      const pGeo = bestMedianStripPick(medAdj(stripGeo));
      if (pGeo.gap > pLine.gap + 0.006) stripFracs = stripGeo;
    }

    const scores: number[] = [];
    const fills: number[] = [];
    const rings: number[] = [];
    const inkFracs: number[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = bubbleAreaLeft + (c + 0.5) * cellW;
      const fillDark = sampleDiskDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(2, Math.round(radiusPx * 0.5))
      );
      const ringDark = sampleAnnulusDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(1, Math.round(radiusPx * 0.62)),
        Math.max(2, Math.round(radiusPx))
      );
      fills.push(fillDark);
      rings.push(ringDark);
      const rw = thresholds.ringDarknessWeight ?? CALIFACIL_OMR_SCAN.ringDarknessWeight;
      scores.push(fillDark - ringDark * rw);
      inkFracs.push(
        sampleDiskInkFractionAtThreshold(data, width, height, cx, cy, diskRInk, otsuT)
      );
    }

    let bestIdx = 0;
    for (let c = 1; c < cols; c++) {
      if (scores[c] > scores[bestIdx]) bestIdx = c;
    }
    let secondIdx = bestIdx === 0 ? 1 : 0;
    for (let c = 0; c < cols; c++) {
      if (c === bestIdx) continue;
      if (scores[c] > scores[secondIdx]) secondIdx = c;
    }

    const best = scores[bestIdx] ?? 0;
    const second = scores[secondIdx] ?? -1;
    const gap = best - second;
    const rowMean = scores.reduce((sum, s) => sum + s, 0) / Math.max(1, scores.length);
    const dynamicMin = Math.max(thresholds.minMarkDarkness, rowMean + 0.012);
    const dynamicGap = Math.max(thresholds.minBestVsSecondGap, Math.abs(best) * 0.26);
    const ratio = best / Math.max(0.001, second + 0.001);
    const fillBest = fills[bestIdx] ?? 0;
    const ringBest = rings[bestIdx] ?? 0;
    const centerVsRing = fillBest - ringBest;
    const minRatio = thresholds.minBestVsSecondRatio ?? CALIFACIL_OMR_SCAN.minBestVsSecondRatio;
    const minCenterVsRingDelta =
      thresholds.minCenterVsRingDelta ?? CALIFACIL_OMR_SCAN.minCenterVsRingDelta;
    const solidCenterMin =
      thresholds.minSolidCenterDarkness ?? CALIFACIL_OMR_SCAN.minSolidCenterDarkness;

    let rulePick: number | null = null;
    if (
      best >= dynamicMin &&
      !(cols >= 2 && (gap < dynamicGap || ratio < minRatio)) &&
      !(second > dynamicMin * 0.92 && gap < dynamicGap * 1.25) &&
      (centerVsRing >= minCenterVsRingDelta || fillBest >= solidCenterMin)
    ) {
      rulePick = bestIdx;
    }

    let inkBestIdx = 0;
    for (let c = 1; c < cols; c++) {
      if (inkFracs[c] > inkFracs[inkBestIdx]) inkBestIdx = c;
    }
    let inkSecondIdx = inkBestIdx === 0 ? 1 : 0;
    for (let c = 0; c < cols; c++) {
      if (c === inkBestIdx) continue;
      if (inkFracs[c] > inkFracs[inkSecondIdx]) inkSecondIdx = c;
    }
    const maxInk = inkFracs[inkBestIdx] ?? 0;
    const secondInk = inkFracs[inkSecondIdx] ?? 0;
    const inkGap = maxInk - secondInk;

    let inkPick: number | null = null;
    if (maxInk >= minInkFrac && inkGap >= minInkGap) {
      inkPick = inkBestIdx;
    }

    const medianAdj = stripFracs.map((f) => f - medianOfNumbers(stripFracs));
    const stripPickInfo = bestMedianStripPick(medianAdj);
    const minStripGap = CALIFACIL_OMR_SCAN.minStripMedianGap;
    const minAbove = CALIFACIL_OMR_SCAN.minStripAboveMedian;
    let stripPrimaryPick: number | null = null;
    if (stripPickInfo.aboveMed >= minAbove && stripPickInfo.gap >= minStripGap) {
      stripPrimaryPick = stripPickInfo.bestIdx;
    }

    let pick: number | null = null;
    let ambiguous = false;

    if (stripPrimaryPick !== null) {
      pick = stripPrimaryPick;
      const twinsStrip = stripFracs.filter((f) => f >= twinFloor).length;
      ambiguous = twinsStrip >= 2 && stripPickInfo.gap < 0.055;
    } else {
      const twins = inkFracs.filter((f) => f >= twinFloor).length;
      if (rulePick !== null && inkPick !== null) {
        if (rulePick === inkPick) {
          pick = rulePick;
          ambiguous = twins >= 2 && inkGap < 0.17;
        } else {
          pick = null;
          ambiguous = true;
        }
      } else if (rulePick !== null) {
        pick = rulePick;
        ambiguous = twins >= 2;
      } else if (inkPick !== null) {
        pick = inkPick;
        ambiguous = twins >= 2 || inkGap < minInkGap + 0.04;
      } else {
        pick = null;
        ambiguous = maxInk > 0.22 && (twins >= 2 || inkGap < 0.09);
      }
    }

    out[row] = pick;
    rowMetas.push({ pick, ambiguous, inkFractions: [...stripFracs] });
    if (pick !== null) {
      resolvedCount++;
      if (stripPrimaryPick !== null) {
        const maxStrip = stripFracs.reduce((a, b) => Math.max(a, b), 0);
        confidenceSum +=
          stripPickInfo.aboveMed + stripPickInfo.gap * 2.5 + maxStrip * 0.2;
      } else {
        confidenceSum += best + gap + maxInk * 0.15;
      }
    }
  }
  return { picks: out, resolvedCount, confidenceSum, rows: rowMetas };
}

function estimateBottomBandInk(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const w = canvas.width;
  const h = canvas.height;
  const y0 = Math.max(0, Math.floor(h * (1 - CALIFACIL_OMR_SCAN.bottomBandRatio)));
  const hh = Math.max(1, h - y0);
  const id = ctx.getImageData(0, y0, w, hh);
  const d = id.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    sum += 1 - lum;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * @param columns — Número de columnas de burbujas impresas (2–5)
 * @returns Siempre 10 entradas: índice de columna elegida (0 = A) o null si no hay lectura clara
 */
export function scanCalifacilOmrSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: CalifacilScanOptions
): (number | null)[] {
  if (typeof document === 'undefined') return Array(10).fill(null);
  let canvas = drawSourceToCanvas(source);
  if (!canvas) return Array(10).fill(null);
  if (!opts?.skipGuideCrop) {
    const cropped = cropCanvasToCalifacilGuideOverlay(canvas);
    if (cropped) canvas = cropped;
  }

  const thresholds: ScanThresholds = {
    minMarkDarkness: CALIFACIL_OMR_SCAN.minMarkDarkness,
    minBestVsSecondGap: CALIFACIL_OMR_SCAN.minBestVsSecondGap,
    minBestVsSecondRatio: CALIFACIL_OMR_SCAN.minBestVsSecondRatio,
    minCenterVsRingDelta: CALIFACIL_OMR_SCAN.minCenterVsRingDelta,
    minSolidCenterDarkness: CALIFACIL_OMR_SCAN.minSolidCenterDarkness,
    ringDarknessWeight: CALIFACIL_OMR_SCAN.ringDarknessWeight,
  };

  const fullSheetProfile: OmrGeometryProfile = {
    bottomBandRatio: CALIFACIL_OMR_SCAN.bottomBandRatio,
    titleStripRatioOfBand: CALIFACIL_OMR_SCAN.titleStripRatioOfBand,
    qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
  };
  const croppedBoxProfiles: OmrGeometryProfile[] = [
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.12, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];

  const corrected = applyPerspectiveCorrection(canvas);
  const variants = buildOmrScanCanvasVariants(canvas, corrected);

  const emptyRows: OmrScanRowDetail[] = Array.from({ length: 10 }, () => ({
    pick: null,
    ambiguous: false,
    inkFractions: [],
  }));
  let best: ScanDetailedResult = {
    picks: Array(10).fill(null),
    resolvedCount: 0,
    confidenceSum: Number.NEGATIVE_INFINITY,
    rows: emptyRows,
  };

  const qnumSweep =
    opts?.qnumSweep === 'live' ? QNUM_WIDTH_SWEEP_LIVE : QNUM_WIDTH_SWEEP;
  const colSweep =
    opts?.columnShiftSweep === 'live' ? COLUMN_SHIFT_PX_LIVE : COLUMN_SHIFT_PX_SWEEP;

  for (const { canvas: c, preferFullSheetFirst } of variants) {
    const profiles = preferFullSheetFirst
      ? [fullSheetProfile, ...croppedBoxProfiles]
      : [...croppedBoxProfiles, fullSheetProfile];
    for (const profile of profiles) {
      for (const qnw of qnumSweep) {
        for (const colShift of colSweep) {
          const profileQ: OmrGeometryProfile = { ...profile, qnumWidthRatio: qnw };
          const detail = scanCalifacilOmrCanvasDetailedWithProfile(
            c,
            columns,
            thresholds,
            profileQ,
            colShift
          );
          const avgConfidence =
            detail.resolvedCount > 0 ? detail.confidenceSum / detail.resolvedCount : 0;
          const bestAvgConfidence =
            best.resolvedCount > 0 ? best.confidenceSum / best.resolvedCount : 0;
          const score = detail.resolvedCount * 70 + detail.confidenceSum * 12 + avgConfidence * 90;
          const bestScore = best.resolvedCount * 70 + best.confidenceSum * 12 + bestAvgConfidence * 90;
          if (score > bestScore) {
            best = detail;
          }
        }
      }
    }
  }

  return best.picks;
}

/**
 * Igual que {@link scanCalifacilOmrSheet} pero expone filas, fracción de tinta y si conviene asistencia por visión.
 */
export function scanCalifacilOmrSheetWithMeta(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: CalifacilScanOptions
): OmrScanMetaResult {
  if (typeof document === 'undefined') {
    return {
      picks: Array(10).fill(null),
      rows: Array.from({ length: 10 }, () => ({ pick: null, ambiguous: false, inkFractions: [] })),
      needsVisionAssist: false,
    };
  }
  let canvas = drawSourceToCanvas(source);
  if (!canvas) {
    return {
      picks: Array(10).fill(null),
      rows: Array.from({ length: 10 }, () => ({ pick: null, ambiguous: false, inkFractions: [] })),
      needsVisionAssist: false,
    };
  }
  if (!opts?.skipGuideCrop) {
    const cropped = cropCanvasToCalifacilGuideOverlay(canvas);
    if (cropped) canvas = cropped;
  }

  const thresholds: ScanThresholds = {
    minMarkDarkness: CALIFACIL_OMR_SCAN.minMarkDarkness,
    minBestVsSecondGap: CALIFACIL_OMR_SCAN.minBestVsSecondGap,
    minBestVsSecondRatio: CALIFACIL_OMR_SCAN.minBestVsSecondRatio,
    minCenterVsRingDelta: CALIFACIL_OMR_SCAN.minCenterVsRingDelta,
    minSolidCenterDarkness: CALIFACIL_OMR_SCAN.minSolidCenterDarkness,
    ringDarknessWeight: CALIFACIL_OMR_SCAN.ringDarknessWeight,
  };

  const fullSheetProfile: OmrGeometryProfile = {
    bottomBandRatio: CALIFACIL_OMR_SCAN.bottomBandRatio,
    titleStripRatioOfBand: CALIFACIL_OMR_SCAN.titleStripRatioOfBand,
    qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
  };
  const croppedBoxProfiles: OmrGeometryProfile[] = [
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.12, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];

  const corrected = applyPerspectiveCorrection(canvas);
  const variants = buildOmrScanCanvasVariants(canvas, corrected);

  const emptyRows: OmrScanRowDetail[] = Array.from({ length: 10 }, () => ({
    pick: null,
    ambiguous: false,
    inkFractions: [],
  }));
  let best: ScanDetailedResult = {
    picks: Array(10).fill(null),
    resolvedCount: 0,
    confidenceSum: Number.NEGATIVE_INFINITY,
    rows: emptyRows,
  };

  const qnumSweep =
    opts?.qnumSweep === 'live' ? QNUM_WIDTH_SWEEP_LIVE : QNUM_WIDTH_SWEEP;
  const colSweep =
    opts?.columnShiftSweep === 'live' ? COLUMN_SHIFT_PX_LIVE : COLUMN_SHIFT_PX_SWEEP;

  for (const { canvas: c, preferFullSheetFirst } of variants) {
    const profiles = preferFullSheetFirst
      ? [fullSheetProfile, ...croppedBoxProfiles]
      : [...croppedBoxProfiles, fullSheetProfile];
    for (const profile of profiles) {
      for (const qnw of qnumSweep) {
        for (const colShift of colSweep) {
          const profileQ: OmrGeometryProfile = { ...profile, qnumWidthRatio: qnw };
          const detail = scanCalifacilOmrCanvasDetailedWithProfile(
            c,
            columns,
            thresholds,
            profileQ,
            colShift
          );
          const avgConfidence =
            detail.resolvedCount > 0 ? detail.confidenceSum / detail.resolvedCount : 0;
          const bestAvgConfidence =
            best.resolvedCount > 0 ? best.confidenceSum / best.resolvedCount : 0;
          const score = detail.resolvedCount * 70 + detail.confidenceSum * 12 + avgConfidence * 90;
          const bestScore = best.resolvedCount * 70 + best.confidenceSum * 12 + bestAvgConfidence * 90;
          if (score > bestScore) {
            best = detail;
          }
        }
      }
    }
  }

  const needsVisionAssist = best.rows.some((r) => r.ambiguous);
  return { picks: best.picks, rows: best.rows, needsVisionAssist };
}

/**
 * Auto-orienta la foto para que la banda CaliFacil quede en la posición esperada.
 * Prueba 0/90/180/270 y se queda con la orientación con mayor evidencia de marcas válidas.
 */
export function autoOrientCalifacilSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const base = prepareCalifacilScanInput(source);
  if (!base) return null;

  const candidates: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let bestCanvas: HTMLCanvasElement = base;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCardinal: 0 | 90 | 180 | 270 = 0;

  for (const angle of candidates) {
    const rotated = rotateCanvas(base, angle);
    const detail = scanCalifacilOmrCanvasDetailed(rotated, columns, {
      minMarkDarkness: 0.04,
      minBestVsSecondGap: 0.02,
    });
    const bandInk = estimateBottomBandInk(rotated);
    const score = bandInk * 2000 + detail.resolvedCount * 100 + detail.confidenceSum * 10;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = rotated;
      bestCardinal = angle;
    }
  }

  // Ajuste fino para fotos ligeramente inclinadas.
  // Se aplica sobre el ángulo cardinal elegido para mejorar "derechita".
  for (let delta = -12; delta <= 12; delta += 2) {
    if (delta === 0) continue;
    const tilted = rotateCanvasByDegrees(bestCanvas, delta);
    const detail = scanCalifacilOmrCanvasDetailed(tilted, columns, {
      minMarkDarkness: 0.04,
      minBestVsSecondGap: 0.02,
    });
    const bandInk = estimateBottomBandInk(tilted);
    const score = bandInk * 2000 + detail.resolvedCount * 100 + detail.confidenceSum * 10;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = tilted;
    }
  }

  // Evita variable no usada cuando el compilador endurece reglas.
  void bestCardinal;
  return applyPerspectiveCorrection(bestCanvas);
}

/** JPEG en data URL para enviar a la API de visión (desde imagen o canvas). */
export function califacilImageToJpegDataUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  quality = 0.88
): string {
  if (typeof document === 'undefined') return '';
  if (source instanceof HTMLCanvasElement) {
    return source.toDataURL('image/jpeg', quality);
  }
  const c = document.createElement('canvas');
  c.width = source.naturalWidth || source.width;
  c.height = source.naturalHeight || source.height;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0);
  return c.toDataURL('image/jpeg', quality);
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}
