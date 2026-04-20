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
  minBubbleInkFraction: 0.4,
  /** Diferencia mínima entre la mayor y la segunda fracción de tinta en la fila. */
  minInkFractionGap: 0.15,
  /** Dos columnas por encima de esto (binario) ⇒ posible doble marca / ambigüedad. */
  ambiguousInkTwinFloor: 0.3,
  /**
   * Franja horizontal por columna (toda la celda A–D): ventaja mínima de la mejor columna
   * sobre la segunda tras restar la mediana por fila (anula sombras / viñeteado).
   */
  minStripMedianGap: 0.034,
  /** Mínimo exceso sobre la mediana por fila en la franja elegida para contar como marca. */
  minStripAboveMedian: 0.028,
  /** Fracción mínima de tinta (Otsu) en la celda ganadora de la franja; evita elegir columna con solo ruido. */
  minStripWinnerRawFrac: 0.12,
  /** Fracción mínima en el interior de casilla (path cuadrado) para aceptar lectura por interior. */
  minInnerWinnerRawFrac: 0.26,
  /** Si la tinta máxima en la fila es muy baja, tratar como sin respuesta (evita falsas «A»). */
  maxStripFracBlankRow: 0.095,
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

/** Subconjunto para cámara en vivo: alineado con barrido completo para no perder el candidato óptimo. */
const QNUM_WIDTH_SWEEP_LIVE = QNUM_WIDTH_SWEEP;

/**
 * Traslación horizontal del área de burbujas en px (corrige desalineación cámara vs rejilla).
 * Se combina con el barrido de `qnumWidthRatio`.
 */
const COLUMN_SHIFT_PX_SWEEP = [-18, -14, -10, -6, -3, 0, 3, 6, 10, 14, 18] as const;
const COLUMN_SHIFT_PX_LIVE = COLUMN_SHIFT_PX_SWEEP;

export type CalifacilScanOptions = {
  /** Si true, no recorta al marco guía (la imagen ya pasó por prepare/autoOrient). */
  skipGuideCrop?: boolean;
  /** Barrido de `qnumWidthRatio`; `live` usa el mismo conjunto que `full` (rendimiento similar). */
  qnumSweep?: 'full' | 'live';
  /** Barrido de desplazamiento horizontal en px; `live` coincide con `full`. */
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
  /** Máximo de filas que el OMR local asignó a la misma columna (posible desalineación). */
  maxSameColumnCount: number;
  /** Geometría de celdas del barrido ganador (coordenadas normalizadas 0–1). */
  geometry: CalifacilOmrScanGeometry | null;
  /**
   * Mismos píxeles que la lectura y que `geometry` (misma anchura/alto que `geometry.imageWidth/Height`).
   * Si no es null, la vista previa debe mostrar esta imagen para que la cuadrícula SVG coincida.
   */
  reviewSourceCanvas: HTMLCanvasElement | null;
};

/** Rectángulo normalizado 0–1 respecto al canvas escaneado (misma relación de aspecto que la foto de revisión). */
export type OmrNormRect = { x: number; y: number; w: number; h: number };

export type CalifacilOmrScanGeometry = {
  /** Dimensiones del canvas usado en la lectura (puede estar escalado respecto a la foto original). */
  imageWidth: number;
  imageHeight: number;
  /** 10 filas × `cols` celdas de opción (solo cuerpo de tabla, sin cabecera). */
  cells: OmrNormRect[][];
};

type ScanDetailedResult = {
  picks: (number | null)[];
  resolvedCount: number;
  confidenceSum: number;
  rows: OmrScanRowDetail[];
  /** Suma de gaps mediana-franja por filas con lectura por franja (mayor = columnas mejor alineadas). */
  clarityStripGapSum: number;
  /** Máximo de filas con la misma columna elegida (penaliza desalineación que da todo igual). */
  maxSameColumnCount: number;
  /** Se detectaron 11 líneas horizontales de la tabla (más fiable que interpolar filas uniformes). */
  hasDetectedRowLines: boolean;
  /** Se detectaron bordes verticales de columnas desde líneas impresas. */
  hasDetectedColumnEdges: boolean;
  geometry: CalifacilOmrScanGeometry | null;
};

/** Elige el mejor barrido perfil×qnw×colShift: claridad agregada y penalización si todo coincide en una columna. */
function omrSweepCandidateScore(d: ScanDetailedResult): number {
  const avgConf = d.resolvedCount > 0 ? d.confidenceSum / d.resolvedCount : 0;
  const samePenalty =
    d.maxSameColumnCount >= 10 ? 520 : d.maxSameColumnCount >= 8 ? 240 : d.maxSameColumnCount >= 7 ? 90 : 0;
  return (
    d.resolvedCount * 52 +
    d.confidenceSum * 11 +
    avgConf * 72 +
    d.clarityStripGapSum * 125 -
    samePenalty +
    (d.hasDetectedRowLines ? 185 : -240) +
    (d.hasDetectedColumnEdges ? 90 : -70)
  );
}

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

/** Franjas por columna usando bordes x medidos (rejilla real A|B|C|D). */
function columnStripInkFractionsForEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edges: number[],
  cols: number,
  y0: number,
  y1: number,
  grayThreshold: number
): number[] {
  const out: number[] = [];
  for (let c = 0; c < cols; c++) {
    const xL = edges[c]!;
    const xR = edges[c + 1]!;
    const cw = Math.max(1, xR - xL);
    const margin = cw * 0.07;
    const xa = xL + margin;
    const xb = xR - margin;
    out.push(sampleRectInkFractionAtThreshold(data, width, height, xa, xb, y0, y1, grayThreshold));
  }
  return out;
}

/**
 * Interior de cada celda (casilla cuadrada rellena): ignora bordes impresos gruesos y muestrea el centro.
 * Mejor que la franja completa cuando la marca llena la casilla.
 */
function columnInnerBubbleInkFractions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edges: number[],
  cols: number,
  yRowTop: number,
  yRowBot: number,
  grayThreshold: number
): number[] {
  const out: number[] = [];
  const rowH = Math.max(1, yRowBot - yRowTop);
  for (let c = 0; c < cols; c++) {
    const xL = edges[c]!;
    const xR = edges[c + 1]!;
    const cw = Math.max(1, xR - xL);
    const marginX = cw * 0.14;
    const marginY = rowH * 0.13;
    const xa = xL + marginX;
    const xb = xR - marginX;
    const ya = yRowTop + marginY;
    const yb = yRowBot - marginY;
    out.push(
      sampleRectInkFractionAtThreshold(data, width, height, xa, xb, ya, yb, grayThreshold, 2)
    );
  }
  return out;
}

function sampleRectMeanDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step = 2
): number {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  if (xb < xa || yb < ya) return 0;
  let sum = 0;
  let n = 0;
  for (let y = ya; y <= yb; y += step) {
    for (let x = xa; x <= xb; x += step) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Oscuridad media en el interior de cada celda (relleno de casilla), para combinar con modelo circular. */
function columnInnerRectMeanDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edges: number[],
  cols: number,
  yRowTop: number,
  yRowBot: number
): number[] {
  const out: number[] = [];
  const rowH = Math.max(1, yRowBot - yRowTop);
  for (let c = 0; c < cols; c++) {
    const xL = edges[c]!;
    const xR = edges[c + 1]!;
    const cw = Math.max(1, xR - xL);
    const marginX = cw * 0.14;
    const marginY = rowH * 0.13;
    out.push(
      sampleRectMeanDarkness(
        data,
        width,
        height,
        xL + marginX,
        yRowTop + marginY,
        xR - marginX,
        yRowBot - marginY
      )
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
  const ctx = out.getContext('2d', { willReadFrequently: true });
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
  const ctx = out.getContext('2d', { willReadFrequently: true });
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

/** Proyectivo a partir de bordes del papel claro (hoja sobre fondo negro / mesa oscura). */
function detectCalifacilQuadFromBrightPaper(
  d: Uint8ClampedArray,
  width: number,
  height: number,
  lumMin: number
): [Point, Point, Point, Point] | null {
  const rowBright = new Uint32Array(height);
  const colBright = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        rowBright[y]++;
        colBright[x]++;
      }
    }
  }

  const rbMin = Math.max(10, Math.floor(width * 0.024));
  const cbMin = Math.max(10, Math.floor(height * 0.024));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    if (rowBright[y] >= rbMin) {
      top = y;
      break;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (rowBright[y] >= rbMin) {
      bottom = y;
      break;
    }
  }
  for (let x = 0; x < width; x++) {
    if (colBright[x] >= cbMin) {
      left = x;
      break;
    }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (colBright[x] >= cbMin) {
      right = x;
      break;
    }
  }
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom - top < height * 0.18 || right - left < width * 0.18) return null;

  const y0 = Math.max(0, top - Math.floor(height * 0.03));
  const y1 = Math.min(height - 1, bottom + Math.floor(height * 0.03));
  const x0 = Math.max(0, left - Math.floor(width * 0.03));
  const x1 = Math.min(width - 1, right + Math.floor(width * 0.03));

  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  const leftPts: Point[] = [];
  const rightPts: Point[] = [];
  const topPts: Point[] = [];
  const bottomPts: Point[] = [];

  for (let y = y0; y <= y1; y += 2) {
    let lx = -1;
    for (let x = 0; x <= midX; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        lx = x;
        break;
      }
    }
    if (lx >= 0) leftPts.push({ x: lx, y });

    let rx = -1;
    for (let x = width - 1; x >= midX; x--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        rx = x;
        break;
      }
    }
    if (rx >= 0) rightPts.push({ x: rx, y });
  }

  for (let x = x0; x <= x1; x += 2) {
    let ty = -1;
    for (let y = 0; y <= midY; y++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        ty = y;
        break;
      }
    }
    if (ty >= 0) topPts.push({ x, y: ty });

    let by = -1;
    for (let y = height - 1; y >= midY; y--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
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
  if (area < width * height * 0.06) return null;
  return quad;
}

/** Proyectivo a partir de tinta/borde oscuro sobre papel claro (caso típico). */
function detectCalifacilQuadFromDarkInk(
  d: Uint8ClampedArray,
  width: number,
  height: number
): [Point, Point, Point, Point] | null {
  const rowCounts = new Array<number>(height).fill(0);
  const colCounts = new Array<number>(width).fill(0);

  let darkSum = 0;
  const n = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const darkness = 1 - lum;
      darkSum += darkness;
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

function detectCalifacilQuad(canvas: HTMLCanvasElement): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 120 || height < 120) return null;

  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;

  let darkSum = 0;
  const nPix = width * height;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
    darkSum += 1 - lum;
  }
  const avgDark = darkSum / Math.max(1, nPix);

  /** Escenas con mucho negro alrededor de la hoja: encajar bordes claros antes que tinta. */
  const preferPaperFirst = avgDark >= 0.29;
  if (preferPaperFirst) {
    const qHi = detectCalifacilQuadFromBrightPaper(d, width, height, 0.61);
    if (qHi) return qHi;
    const qLo = detectCalifacilQuadFromBrightPaper(d, width, height, 0.52);
    if (qLo) return qLo;
  }

  const ink = detectCalifacilQuadFromDarkInk(d, width, height);
  if (ink) return ink;

  if (!preferPaperFirst) {
    const qHi = detectCalifacilQuadFromBrightPaper(d, width, height, 0.61);
    if (qHi) return qHi;
    const qLo = detectCalifacilQuadFromBrightPaper(d, width, height, 0.52);
    if (qLo) return qLo;
  }

  return null;
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

  const srcCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return null;
  const src = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const srcData = src.data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d', { willReadFrequently: true });
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
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, left, top, rw, rh, 0, 0, rw, rh);
  return out;
}

/** Opciones para preparar imagen antes de orientar / escanear CaliFacil */
export type PrepareCalifacilScanInputOptions = {
  /**
   * Si es true (predeterminado), recorta al mismo encuadre que el marco naranja en cámara en vivo.
   * Pon `false` para fotos de página completa o archivo subido: el recorte artificial puede quitar el borde
   * del recuadro negro y empeorar la corrección de perspectiva frente al encuadre real de la cámara.
   */
  useGuideCrop?: boolean;
};

/** Escala, opcionalmente recorta al marco guía y devuelve imagen lista para orientar/escanear. */
export function prepareCalifacilScanInput(
  source: HTMLImageElement | HTMLCanvasElement,
  opts?: PrepareCalifacilScanInputOptions
): HTMLCanvasElement | null {
  const base = drawSourceToCanvas(source, 1400);
  if (!base) return null;
  if (opts?.useGuideCrop === false) return base;
  return cropCanvasToCalifacilGuideOverlay(base) ?? base;
}

/** Opciones para {@link autoOrientCalifacilSheet}. */
export type AutoOrientCalifacilSheetOptions = PrepareCalifacilScanInputOptions;

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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
 * Pasa bajo suave vía downscale + upscale: reduce moiré/subpixel en fotos de pantalla LCD
 * donde la franja completa por columna puede engañar al OMR.
 */
function applyAntiMoirLowPass(
  canvas: HTMLCanvasElement,
  scale: number
): HTMLCanvasElement | null {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 32 || h < 32 || scale <= 0.55 || scale >= 0.98) return null;
  const sw = Math.max(16, Math.round(w * scale));
  const sh = Math.max(16, Math.round(h * scale));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) return null;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(small, 0, 0, w, h);
  return out;
}

const ANTI_MOIR_DOWN_SCALE = 0.84 as const;

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
  const antiOrig = applyAntiMoirLowPass(canvas, ANTI_MOIR_DOWN_SCALE);
  if (antiOrig) {
    pushUnique(antiOrig, true);
  }
  if (corrected !== canvas) {
    const antiCorr = applyAntiMoirLowPass(corrected, ANTI_MOIR_DOWN_SCALE);
    if (antiCorr) {
      pushUnique(antiCorr, false);
    }
  }
  return out;
}

function isLikelyFullSheetPhoto(canvas: HTMLCanvasElement): boolean {
  const w = Math.max(1, canvas.width);
  const h = Math.max(1, canvas.height);
  // Hoja completa en vertical suele ser claramente más alta que ancha.
  return h / w >= 1.2;
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

/**
 * Proyección de borde vertical: promedio de |I(y,x) − I(y,x−1)| en la franja de la tabla.
 * Los trazos verticales entre columnas A–D producen picos en x.
 */
function buildVerticalEdgeProjection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Float64Array {
  const proj = new Float64Array(width);
  const xa = Math.max(1, Math.floor(x0));
  const xb = Math.min(width - 2, Math.ceil(x1));
  const ya = Math.max(1, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  const denom = Math.max(1, yb - ya);
  for (let x = xa; x <= xb; x++) {
    let s = 0;
    for (let y = ya; y < yb; y++) {
      const i1 = (y * width + x) * 4;
      const i0 = (y * width + (x - 1)) * 4;
      s += Math.abs(pixelGray255(data, i1) - pixelGray255(data, i0));
    }
    proj[x] = s / denom;
  }
  return proj;
}

function boxSmoothInRangeX(proj: Float64Array, x0: number, x1: number, radius: number): void {
  if (radius < 1) return;
  const lo = Math.max(0, x0);
  const hi = Math.min(proj.length - 1, x1);
  const tmp = new Float64Array(hi - lo + 1);
  for (let i = lo; i <= hi; i++) tmp[i - lo] = proj[i];
  const w = radius * 2 + 1;
  for (let x = lo + radius; x <= hi - radius; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[x - lo + k];
    proj[x] = sum / w;
  }
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

function findVerticalLinePeaks(
  proj: Float64Array,
  x0: number,
  x1: number,
  minDist: number,
  minRel: number
): number[] {
  let peakMax = 0;
  for (let x = x0 + 2; x < x1 - 2; x++) peakMax = Math.max(peakMax, proj[x]);
  const thr = Math.max(peakMax * minRel, 1e-6);
  const raw: number[] = [];
  for (let x = x0 + 2; x < x1 - 2; x++) {
    const v = proj[x];
    if (v < thr) continue;
    if (v <= proj[x - 1] || v < proj[x + 1]) continue;
    raw.push(x);
  }
  raw.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const x of raw) {
    if (merged.length === 0) {
      merged.push(x);
      continue;
    }
    const last = merged[merged.length - 1]!;
    if (x - last < minDist) {
      if (proj[x] > proj[last]) merged[merged.length - 1] = x;
    } else {
      merged.push(x);
    }
  }
  return merged;
}

/**
 * Infiere bordes x entre columnas A… usando líneas verticales impresas (cols+1 valores).
 */
function inferColumnEdgesFromVerticalLines(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bubbleAreaLeft: number,
  bubbleAreaW: number,
  cols: number,
  dataTop: number,
  rowH: number
): number[] | null {
  const cellGuess = bubbleAreaW / Math.max(1, cols);
  const y0 = Math.max(1, Math.floor(dataTop + 1.2 * rowH));
  const y1 = Math.min(height - 1, Math.ceil(dataTop + 8.8 * rowH));
  const xLo = Math.max(1, Math.floor(bubbleAreaLeft - cellGuess * 0.2));
  const xHi = Math.min(width - 2, Math.ceil(bubbleAreaLeft + bubbleAreaW + cellGuess * 0.25));
  if (y1 <= y0 + 6 || xHi <= xLo + 24) return null;

  const proj = buildVerticalEdgeProjection(data, width, height, xLo, xHi, y0, y1);
  boxSmoothInRangeX(proj, xLo, xHi, 2);

  const minDist = Math.max(3, cellGuess * 0.26);
  const peaks = findVerticalLinePeaks(proj, xLo, xHi, minDist, 0.088);
  const need = cols + 1;
  if (peaks.length < need) return null;

  peaks.sort((a, b) => a - b);
  let bestWindow: number[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let s = 0; s <= peaks.length - need; s++) {
    const w = peaks.slice(s, s + need);
    const gaps: number[] = [];
    for (let i = 0; i < need - 1; i++) gaps.push(w[i + 1]! - w[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (mean < cellGuess * 0.52 || mean > cellGuess * 1.55) continue;
    const var_ = gaps.reduce((acc, g) => acc + (g - mean) * (g - mean), 0) / gaps.length;
    const cv = mean > 1e-6 ? Math.sqrt(var_) / mean : 1;
    if (cv > 0.44) continue;
    const score =
      var_ + (Math.abs(mean - cellGuess) / (cellGuess + 1e-6)) * cellGuess * cellGuess * 0.15;
    if (score < bestScore) {
      bestScore = score;
      bestWindow = w;
    }
  }
  if (!bestWindow) return null;

  const left0 = bestWindow[0]!;
  if (Math.abs(left0 - bubbleAreaLeft) > bubbleAreaW * 0.5) return null;

  return bestWindow;
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
 *
 * En **hoja impresa completa**, la tabla está solo en la parte inferior; si analizamos
 * casi toda la altura (`bottomBandRatio: 1`), los trazos del enunciado añaden picos y
 * casi nunca salen exactamente 11 líneas. Por eso probamos primero la misma franja inferior
 * que usa el escaneo OMR (`printExam`), y dejamos `bottomBandRatio: 1` para fotos ya
 * recortadas al recuadro.
 */
export function hasCalifacilPrintedTableGrid(
  canvas: HTMLCanvasElement,
  columns: number
): boolean {
  void columns;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const { width, height } = canvas;
  if (width < 80 || height < 80) return false;
  const id = ctx.getImageData(0, 0, width, height);
  const { data } = id;

  const profiles: OmrGeometryProfile[] = [
    {
      bottomBandRatio: CALIFACIL_OMR_SCAN.bottomBandRatio,
      titleStripRatioOfBand: CALIFACIL_OMR_SCAN.titleStripRatioOfBand,
      qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
    },
    {
      bottomBandRatio: 0.52,
      titleStripRatioOfBand: 0.2,
      qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
    },
    {
      bottomBandRatio: 0.58,
      titleStripRatioOfBand: 0.17,
      qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
    },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.12, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];
  const shifts = [0, -6, 6, -8, 8, -14, 14, -20, 20];

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
  if (hasCalifacilPrintedTableGrid(corrected, columns)) return true;
  /** Página muy cargada o borde mal inferido: la homografía puede estropear líneas; probar imagen previa al warp. */
  if (corrected !== canvas && hasCalifacilPrintedTableGrid(canvas, columns)) return true;
  return false;
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    for (let i = 0; i < 10; i++) {
      rowMetas.push({ pick: null, ambiguous: false, inkFractions: [] });
    }
    return {
      picks: out,
      resolvedCount: 0,
      confidenceSum: 0,
      rows: rowMetas,
      clarityStripGapSum: 0,
      maxSameColumnCount: 0,
      hasDetectedRowLines: false,
      hasDetectedColumnEdges: false,
      geometry: null,
    };
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

  const inferredColEdges = inferColumnEdgesFromVerticalLines(
    data,
    width,
    height,
    bubbleAreaLeft,
    bubbleAreaW,
    cols,
    dataTop,
    rowH
  );
  const uniformColEdges: number[] = [];
  for (let c = 0; c <= cols; c++) {
    uniformColEdges.push(
      c === cols
        ? Math.min(width - 1, Math.round(bubbleAreaLeft + bubbleAreaW))
        : Math.round(bubbleAreaLeft + (c * bubbleAreaW) / cols)
    );
  }
  const columnEdges = inferredColEdges ?? uniformColEdges;
  const hasDetectedRowLines = Boolean(lineYs && lineYs.length === 11);
  const hasDetectedColumnEdges = Boolean(inferredColEdges && inferredColEdges.length === cols + 1);
  const minCellW = Math.min(
    ...Array.from({ length: cols }, (_, c) => Math.max(1, columnEdges[c + 1]! - columnEdges[c]!))
  );

  const minInkFrac = CALIFACIL_OMR_SCAN.minBubbleInkFraction;
  const minInkGap = CALIFACIL_OMR_SCAN.minInkFractionGap;
  const twinFloor = CALIFACIL_OMR_SCAN.ambiguousInkTwinFloor;

  let resolvedCount = 0;
  let confidenceSum = 0;
  let clarityStripGapSum = 0;
  const cells: OmrNormRect[][] = [];
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
    const radiusPx = Math.max(2, Math.min(minCellW, localRowH) * 0.22);
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
    let stripFracs = columnStripInkFractionsForEdges(
      data,
      width,
      height,
      columnEdges,
      cols,
      stripY0,
      stripY1,
      otsuT
    );
    if (row === 9 && lineYs && lineYs.length === 11) {
      const y0g = Math.min(height - 1, Math.ceil(dataTop + 9 * rowH + stripPad));
      const y1g = Math.max(y0g, Math.floor(dataTop + 10 * rowH - stripPad));
      const stripGeo = columnStripInkFractionsForEdges(
        data,
        width,
        height,
        columnEdges,
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

    const innerFracs = columnInnerBubbleInkFractions(
      data,
      width,
      height,
      columnEdges,
      cols,
      yRowTop,
      yRowBot,
      otsuT
    );
    const innerMedianAdj = innerFracs.map((f) => f - medianOfNumbers(innerFracs));
    const innerPickInfo = bestMedianStripPick(innerMedianAdj);
    const innerRectDark = columnInnerRectMeanDarkness(
      data,
      width,
      height,
      columnEdges,
      cols,
      yRowTop,
      yRowBot
    );
    let innerRectBest = 0;
    for (let c = 1; c < cols; c++) {
      if (innerRectDark[c]! > innerRectDark[innerRectBest]!) innerRectBest = c;
    }
    let innerRectSecond = innerRectBest === 0 ? 1 : 0;
    for (let c = 0; c < cols; c++) {
      if (c === innerRectBest) continue;
      if (innerRectDark[c]! > innerRectDark[innerRectSecond]!) innerRectSecond = c;
    }
    const rectGap =
      (innerRectDark[innerRectBest] ?? 0) - (innerRectDark[innerRectSecond] ?? 0);
    const rectMean = innerRectDark.reduce((a, b) => a + b, 0) / Math.max(1, cols);
    const dynamicRectMin = Math.max(0.048, rectMean + 0.022);
    const rectRulePick: number | null =
      (innerRectDark[innerRectBest] ?? 0) >= dynamicRectMin &&
      rectGap >= 0.036 &&
      (innerRectDark[innerRectBest] ?? 0) / Math.max(0.001, (innerRectDark[innerRectSecond] ?? 0) + 0.001) >= 1.22
        ? innerRectBest
        : null;

    const scores: number[] = [];
    const fills: number[] = [];
    const rings: number[] = [];
    const inkFracs: number[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = (columnEdges[c]! + columnEdges[c + 1]!) * 0.5;
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
    const maxStripRaw = stripFracs.reduce((a, b) => Math.max(a, b), 0);
    const stripWinnerRaw = stripFracs[stripPickInfo.bestIdx] ?? 0;
    const minStripWin = CALIFACIL_OMR_SCAN.minStripWinnerRawFrac;
    let stripPrimaryPick: number | null = null;
    if (
      stripPickInfo.aboveMed >= minAbove &&
      stripPickInfo.gap >= minStripGap &&
      stripWinnerRaw >= minStripWin &&
      !(maxStripRaw < CALIFACIL_OMR_SCAN.maxStripFracBlankRow && stripPickInfo.gap < 0.055)
    ) {
      stripPrimaryPick = stripPickInfo.bestIdx;
    }

    let pick: number | null = null;
    let ambiguous = false;

    const innerWinnerRaw = innerFracs[innerPickInfo.bestIdx] ?? 0;
    const minInnerWin = CALIFACIL_OMR_SCAN.minInnerWinnerRawFrac;

    const innerStrong =
      innerPickInfo.aboveMed >= minAbove * 0.95 &&
      innerPickInfo.gap >= minStripGap * 0.92 &&
      innerWinnerRaw >= minInnerWin &&
      !(maxStripRaw < CALIFACIL_OMR_SCAN.maxStripFracBlankRow && innerPickInfo.gap < 0.048);

    if (stripPrimaryPick !== null) {
      const preferInner =
        innerStrong &&
        innerPickInfo.bestIdx !== stripPrimaryPick &&
        innerPickInfo.gap >= 0.042 &&
        (innerPickInfo.gap + 0.005 >= stripPickInfo.gap ||
          innerWinnerRaw >= stripWinnerRaw + 0.035);

      if (preferInner) {
        /** Pantalla/moiré: la franja completa a veces elige mal columna; el interior del cuadrado suele acertar. */
        pick = innerPickInfo.bestIdx;
        clarityStripGapSum += innerPickInfo.gap * 0.95;
        const twinsIn = innerFracs.filter((f) => f >= twinFloor * 0.95).length;
        ambiguous = twinsIn >= 2 && innerPickInfo.gap < 0.058;
      } else {
        pick = stripPrimaryPick;
        clarityStripGapSum += stripPickInfo.gap;
        const twinsStrip = stripFracs.filter((f) => f >= twinFloor).length;
        ambiguous = twinsStrip >= 2 && stripPickInfo.gap < 0.065;
      }
    } else if (innerStrong) {
      /** Casillas cuadradas rellenas: el interior de la celda marca mejor que la franja completa. */
      pick = innerPickInfo.bestIdx;
      clarityStripGapSum += innerPickInfo.gap * 0.95;
      const twinsIn = innerFracs.filter((f) => f >= twinFloor * 0.95).length;
      ambiguous = twinsIn >= 2 && innerPickInfo.gap < 0.058;
    } else if (
      rectRulePick !== null &&
      (inkPick === null || inkPick === rectRulePick || rulePick === rectRulePick)
    ) {
      pick = rectRulePick;
      const twinsR = innerFracs.filter((f) => f >= twinFloor * 0.92).length;
      ambiguous = twinsR >= 2 && rectGap < 0.048;
    } else {
      const twins = inkFracs.filter((f) => f >= twinFloor).length;
      if (rulePick !== null && inkPick !== null) {
        if (rulePick === inkPick) {
          pick = rulePick;
          ambiguous = twins >= 2 && inkGap < 0.19;
        } else {
          pick = null;
          ambiguous = true;
        }
      } else if (rulePick !== null && inkPick === null) {
        /** Solo modelo anular: exigir señal fuerte para no inventar columna. */
        const strongRule =
          best >= dynamicMin * 1.22 &&
          gap >= dynamicGap * 1.18 &&
          ratio >= minRatio * 1.12 &&
          (centerVsRing >= minCenterVsRingDelta * 1.15 || fillBest >= solidCenterMin * 1.05);
        if (strongRule) {
          pick = rulePick;
          ambiguous = twins >= 2;
        } else {
          pick = null;
          ambiguous = false;
        }
      } else if (inkPick !== null && rulePick === null) {
        /** Solo tinta binaria: umbrales ya altos en CALIFACIL_OMR_SCAN. */
        pick = inkPick;
        ambiguous = twins >= 2 || inkGap < minInkGap + 0.05;
      } else {
        pick = null;
        ambiguous = maxInk > 0.22 && (twins >= 2 || inkGap < 0.09);
      }
    }

    out[row] = pick;
    rowMetas.push({ pick, ambiguous, inkFractions: [...stripFracs] });
    if (pick !== null) {
      resolvedCount++;
      const scoredAsInner =
        pick === innerPickInfo.bestIdx &&
        innerStrong &&
        (stripPrimaryPick === null || innerPickInfo.bestIdx !== stripPrimaryPick);

      if (scoredAsInner) {
        const maxIn = innerFracs.reduce((a, b) => Math.max(a, b), 0);
        confidenceSum +=
          innerPickInfo.aboveMed * 1.05 + innerPickInfo.gap * 2.5 + maxIn * 0.18;
      } else if (stripPrimaryPick !== null && pick === stripPrimaryPick) {
        const maxStrip = stripFracs.reduce((a, b) => Math.max(a, b), 0);
        confidenceSum +=
          stripPickInfo.aboveMed + stripPickInfo.gap * 2.5 + maxStrip * 0.2;
      } else if (
        pick === innerPickInfo.bestIdx &&
        innerPickInfo.aboveMed >= minAbove * 0.95 &&
        innerPickInfo.gap >= minStripGap * 0.92
      ) {
        const maxIn = innerFracs.reduce((a, b) => Math.max(a, b), 0);
        confidenceSum +=
          innerPickInfo.aboveMed * 1.05 + innerPickInfo.gap * 2.5 + maxIn * 0.18;
      } else if (rectRulePick !== null && pick === rectRulePick) {
        confidenceSum += rectGap * 18 + (innerRectDark[pick] ?? 0) * 12;
      } else {
        confidenceSum += best + gap + maxInk * 0.15;
      }
    }

    const rowRects: OmrNormRect[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = columnEdges[c]!;
      const x1 = columnEdges[c + 1]!;
      rowRects.push({
        x: x0 / width,
        y: yRowTop / height,
        w: Math.max(0, (x1 - x0) / width),
        h: Math.max(0, (yRowBot - yRowTop) / height),
      });
    }
    cells.push(rowRects);
  }
  let maxSameColumnCount = 0;
  const colTally = new Map<number, number>();
  for (const p of out) {
    if (p !== null) colTally.set(p, (colTally.get(p) ?? 0) + 1);
  }
  colTally.forEach((v) => {
    maxSameColumnCount = Math.max(maxSameColumnCount, v);
  });

  const geometry: CalifacilOmrScanGeometry = {
    imageWidth: width,
    imageHeight: height,
    cells,
  };

  return {
    picks: out,
    resolvedCount,
    confidenceSum,
    rows: rowMetas,
    clarityStripGapSum,
    maxSameColumnCount,
    hasDetectedRowLines,
    hasDetectedColumnEdges,
    geometry,
  };
}

function estimateBottomBandInk(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
    clarityStripGapSum: 0,
    maxSameColumnCount: 0,
    hasDetectedRowLines: false,
    hasDetectedColumnEdges: false,
    geometry: null,
  };
  let bestSweepScore = Number.NEGATIVE_INFINITY;

  const qnumSweep =
    opts?.qnumSweep === 'live' ? QNUM_WIDTH_SWEEP_LIVE : QNUM_WIDTH_SWEEP;
  const colSweep =
    opts?.columnShiftSweep === 'live' ? COLUMN_SHIFT_PX_LIVE : COLUMN_SHIFT_PX_SWEEP;

  for (const { canvas: c, preferFullSheetFirst } of variants) {
    const likelyFullSheet = isLikelyFullSheetPhoto(c);
    const orderedProfiles =
      preferFullSheetFirst || likelyFullSheet
        ? [fullSheetProfile, ...croppedBoxProfiles]
        : [...croppedBoxProfiles, fullSheetProfile];
    for (const profile of orderedProfiles) {
      const profilePrior =
        likelyFullSheet && profile.bottomBandRatio >= 0.99
          ? -260
          : !likelyFullSheet && profile.bottomBandRatio < 0.95
            ? -95
            : profile.bottomBandRatio < 0.95
              ? 18
              : 0;
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
          const detailScore = omrSweepCandidateScore(detail) + profilePrior;
          if (detailScore > bestSweepScore) {
            best = detail;
            bestSweepScore = detailScore;
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
      maxSameColumnCount: 0,
      geometry: null,
      reviewSourceCanvas: null,
    };
  }
  let canvas = drawSourceToCanvas(source);
  if (!canvas) {
    return {
      picks: Array(10).fill(null),
      rows: Array.from({ length: 10 }, () => ({ pick: null, ambiguous: false, inkFractions: [] })),
      needsVisionAssist: false,
      maxSameColumnCount: 0,
      geometry: null,
      reviewSourceCanvas: null,
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
    clarityStripGapSum: 0,
    maxSameColumnCount: 0,
    hasDetectedRowLines: false,
    hasDetectedColumnEdges: false,
    geometry: null,
  };
  let bestSweepScore = Number.NEGATIVE_INFINITY;
  /** Canvas de la variante que produjo `best`; debe ser la misma imagen que la vista previa con overlay. */
  let bestReviewCanvas: HTMLCanvasElement | null = null;

  const qnumSweep =
    opts?.qnumSweep === 'live' ? QNUM_WIDTH_SWEEP_LIVE : QNUM_WIDTH_SWEEP;
  const colSweep =
    opts?.columnShiftSweep === 'live' ? COLUMN_SHIFT_PX_LIVE : COLUMN_SHIFT_PX_SWEEP;

  for (const { canvas: c, preferFullSheetFirst } of variants) {
    const likelyFullSheet = isLikelyFullSheetPhoto(c);
    const orderedProfiles =
      preferFullSheetFirst || likelyFullSheet
        ? [fullSheetProfile, ...croppedBoxProfiles]
        : [...croppedBoxProfiles, fullSheetProfile];
    for (const profile of orderedProfiles) {
      const profilePrior =
        likelyFullSheet && profile.bottomBandRatio >= 0.99
          ? -260
          : !likelyFullSheet && profile.bottomBandRatio < 0.95
            ? -95
            : profile.bottomBandRatio < 0.95
              ? 18
              : 0;
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
          const detailScore = omrSweepCandidateScore(detail) + profilePrior;
          if (detailScore > bestSweepScore) {
            best = detail;
            bestReviewCanvas = c;
            bestSweepScore = detailScore;
          }
        }
      }
    }
  }

  const needsVisionAssist = best.rows.some((r) => r.ambiguous);
  return {
    picks: best.picks,
    rows: best.rows,
    needsVisionAssist,
    maxSameColumnCount: best.maxSameColumnCount,
    geometry: best.geometry,
    reviewSourceCanvas: bestReviewCanvas,
  };
}

/**
 * Auto-orienta la foto para que la banda CaliFacil quede en la posición esperada.
 * Prueba 0/90/180/270 y se queda con la orientación con mayor evidencia de marcas válidas.
 */
export function autoOrientCalifacilSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: AutoOrientCalifacilSheetOptions
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const base = prepareCalifacilScanInput(source, opts);
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
    const score =
      bandInk * 2000 +
      detail.resolvedCount * 100 +
      detail.confidenceSum * 10 +
      detail.clarityStripGapSum * 40;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = rotated;
      bestCardinal = angle;
    }
  }

  /** Base ya en 0/90/180/270; todo giro fino se aplica sobre esta copia (no encadenado). */
  const cardinalBest = bestCanvas;

  const scoreTilted = (tilted: HTMLCanvasElement) => {
    const detail = scanCalifacilOmrCanvasDetailed(tilted, columns, {
      minMarkDarkness: 0.04,
      minBestVsSecondGap: 0.02,
    });
    const bandInk = estimateBottomBandInk(tilted);
    return (
      bandInk * 2000 +
      detail.resolvedCount * 100 +
      detail.confidenceSum * 10 +
      detail.clarityStripGapSum * 40
    );
  };

  // Inclinaciones fuertes (p. ej. ~45°): el barrido anterior ±38° dejaba la hoja torcida y la rejilla desfasada.
  // Paso grueso 3° hasta ±60° y luego afinación de 1° (con paso 3° el óptimo puede quedar a ±1.5° del mejor).
  let bestDeltaDeg = 0;
  for (let delta = -60; delta <= 60; delta += 3) {
    if (delta === 0) continue;
    const tilted = rotateCanvasByDegrees(cardinalBest, delta);
    const score = scoreTilted(tilted);
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = tilted;
      bestDeltaDeg = delta;
    }
  }

  for (let fine = -5; fine <= 5; fine++) {
    if (fine === 0) continue;
    const total = bestDeltaDeg + fine;
    if (total < -65 || total > 65) continue;
    const tilted = rotateCanvasByDegrees(cardinalBest, total);
    const score = scoreTilted(tilted);
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = tilted;
      bestDeltaDeg = total;
    }
  }

  let deskewed = applyPerspectiveCorrection(bestCanvas);

  /** Tras el warp, a veces queda 2–8° de sesgo residual; un barrido corto encaja la rejilla con la tabla. */
  let bestPostScore = scoreTilted(deskewed);
  for (let post = -10; post <= 10; post += 2) {
    if (post === 0) continue;
    const t = rotateCanvasByDegrees(deskewed, post);
    const sc = scoreTilted(t);
    if (sc > bestPostScore) {
      bestPostScore = sc;
      deskewed = t;
    }
  }

  // Evita variable no usada cuando el compilador endurece reglas.
  void bestCardinal;
  return deskewed;
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
  const ctx = c.getContext('2d', { willReadFrequently: true });
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
