/**
 * Lectura OMR para hojas estilo ZipGrade (4 esquinas + 3 columnas de burbujas).
 * Compatible con formularios de 20–50 preguntas en layout vertical de 3 columnas.
 */

import type { CalifacilOmrScanGeometry, OmrNormRect, Point, WarpAlignmentReport } from '@/lib/omrScan';
import {
  readAnswerSheetPicksFromTemplateGeometry,
  syncCalifacilOmrGeometryImageSize,
  warpCalifacilSheetFromQuad,
} from '@/lib/omrScan';

export const ZIPGRADE_WARP_WIDTH = 850;
export const ZIPGRADE_WARP_HEIGHT = 1100;

/** Esquinas negras típicas de ZipGrade (coords. normalizadas en hoja enderezada). */
const ZIPGRADE_CORNER_NORM = {
  tl: { x: 0.028, y: 0.024 },
  tr: { x: 0.972, y: 0.024 },
  bl: { x: 0.028, y: 0.976 },
  br: { x: 0.972, y: 0.976 },
} as const;

/** Área de burbujas (3 columnas verticales). */
const ZIPGRADE_GRID_NORM = {
  x: 0.06,
  y: 0.2,
  w: 0.88,
  h: 0.72,
} as const;

/**
 * Cajas de nombre + apellido encima de la rejilla (hoja ZipGrade enderezada).
 * Una franja ancha: [Nombre] [Apellido] como en el encabezado de la hoja.
 */
const ZIPGRADE_NAME_STRIP_NORM = {
  x: 0.07,
  y: 0.042,
  w: 0.86,
  h: 0.125,
} as const;

/** Recorte del nombre en reportes PDF «Paper Details» de ZipGrade (arriba-izquierda). */
const ZIPGRADE_REPORT_NAME_NORM = {
  x: 0.02,
  y: 0.055,
  w: 0.38,
  h: 0.14,
} as const;

export type ZipGradeSheetKind = 'califacil' | 'zipgrade' | 'unknown';

export function detectZipGradeCornerQuad(
  canvas: HTMLCanvasElement
): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 120 || h < 120) return null;

  const patch = Math.max(10, Math.round(Math.min(w, h) * 0.07));
  const corners = [
    { x: 0, y: 0 },
    { x: w - patch, y: 0 },
    { x: w - patch, y: h - patch },
    { x: 0, y: h - patch },
  ];

  let dark = 0;
  for (const c of corners) {
    const id = ctx.getImageData(c.x, c.y, patch, patch);
    let sum = 0;
    for (let i = 0; i < id.data.length; i += 4) {
      sum += id.data[i]! * 0.299 + id.data[i + 1]! * 0.587 + id.data[i + 2]! * 0.114;
    }
    if (sum / (patch * patch) < 200) dark += 1;
  }
  if (dark < 3) return null;

  const padX = w * 0.012;
  const padY = h * 0.012;
  return [
    { x: padX, y: padY },
    { x: w - padX, y: padY },
    { x: w - padX, y: h - padY },
    { x: padX, y: h - padY },
  ];
}

export function isZipGradeWarpedCanvas(canvas: HTMLCanvasElement): boolean {
  const ar = canvas.width / Math.max(1, canvas.height);
  return (
    canvas.width >= 400 &&
    canvas.height >= 500 &&
    ar > 0.72 &&
    ar < 0.82
  );
}

export function warpZipGradeAnswerSheet(
  canvas: HTMLCanvasElement
): { warped: HTMLCanvasElement | null; alignment: WarpAlignmentReport | null } {
  const quad = detectZipGradeCornerQuad(canvas);
  if (!quad) return { warped: null, alignment: null };

  const warped = warpCalifacilSheetFromQuad(canvas, quad);
  if (!warped) return { warped: null, alignment: null };

  const alignment: WarpAlignmentReport = {
    ok: true,
    maxErrorPx: 4,
    meanErrorPx: 2,
    maxAllowedPx: 12,
    corners: [],
  };
  return { warped, alignment };
}

/** Construye geometría OMR para N preguntas en 3 columnas estilo ZipGrade. */
export function buildZipGradeOmrGeometry(
  questionCount: number,
  optionColumns: number,
  imageWidth: number,
  imageHeight: number
): CalifacilOmrScanGeometry {
  const total = Math.max(1, Math.min(50, questionCount));
  const cols = Math.max(2, Math.min(5, optionColumns));
  const layoutCols = 3;
  const rowsPerCol = Math.ceil(total / layoutCols);

  const gx = ZIPGRADE_GRID_NORM.x * imageWidth;
  const gy = ZIPGRADE_GRID_NORM.y * imageHeight;
  const gw = ZIPGRADE_GRID_NORM.w * imageWidth;
  const gh = ZIPGRADE_GRID_NORM.h * imageHeight;
  const colW = gw / layoutCols;
  const rowH = gh / Math.max(1, rowsPerCol);

  const cells: OmrNormRect[][] = [];
  for (let q = 0; q < total; q++) {
    const layoutCol = Math.floor(q / rowsPerCol);
    const rowInCol = q % rowsPerCol;
    const rowRects: OmrNormRect[] = [];
    const bubbleW = (colW * 0.82) / cols;
    const bubbleAreaLeft = gx + layoutCol * colW + colW * 0.1;
    const yRowTop = gy + rowInCol * rowH + rowH * 0.12;
    const yRowH = rowH * 0.76;

    for (let c = 0; c < cols; c++) {
      const x0 = bubbleAreaLeft + c * bubbleW;
      rowRects.push({
        x: x0 / imageWidth,
        y: yRowTop / imageHeight,
        w: bubbleW / imageWidth,
        h: yRowH / imageHeight,
      });
    }
    cells.push(rowRects);
  }

  return { imageWidth, imageHeight, cells };
}

const ZIPGRADE_SCAN_THRESHOLDS = {
  minMarkDarkness: 0.048,
  minBestVsSecondGap: 0.022,
  minBestVsSecondRatio: 1.18,
  minCenterVsRingDelta: 0.022,
  minSolidCenterDarkness: 0.14,
  ringDarknessWeight: 0.35,
};

export function scanZipGradeAnswerSheet(
  warped: HTMLCanvasElement,
  optionColumns: number,
  questionCount: number
): {
  picks: (number | null)[];
  geometry: CalifacilOmrScanGeometry | null;
} {
  const rows = Math.max(1, Math.min(50, questionCount));
  const geometry = buildZipGradeOmrGeometry(rows, optionColumns, warped.width, warped.height);
  const read = readAnswerSheetPicksFromTemplateGeometry(
    warped,
    geometry,
    ZIPGRADE_SCAN_THRESHOLDS,
    rows,
    optionColumns
  );
  return {
    picks: read.picks,
    geometry: syncCalifacilOmrGeometryImageSize(geometry, warped.width, warped.height),
  };
}

function canvasMeanLuminance(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): number | null {
  try {
    const sampled = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < sampled.data.length; i += 16) {
      sum +=
        (sampled.data[i]! * 0.299 + sampled.data[i + 1]! * 0.587 + sampled.data[i + 2]! * 0.114) /
        255;
      n++;
    }
    return n > 0 ? sum / n : null;
  } catch {
    return null;
  }
}

function cropNormRectToJpegDataUrl(
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
  maxWidth: number,
  maxMeanLuma = 0.94
): string | null {
  if (typeof document === 'undefined' || canvas.width < 40 || canvas.height < 40) {
    return null;
  }
  const W = canvas.width;
  const H = canvas.height;
  const sx = Math.max(0, Math.floor(rect.x * W));
  const sy = Math.max(0, Math.floor(rect.y * H));
  const sw = Math.max(8, Math.min(W - sx, Math.round(rect.w * W)));
  const sh = Math.max(6, Math.min(H - sy, Math.round(rect.h * H)));
  if (sw < 8 || sh < 6) return null;

  const out = document.createElement('canvas');
  const scale = Math.min(1, maxWidth / sw);
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const mean = canvasMeanLuminance(ctx, out.width, out.height);
  if (mean != null && mean > maxMeanLuma) return null;
  try {
    return out.toDataURL('image/jpeg', 0.92);
  } catch {
    return null;
  }
}

/**
 * Recorte JPEG del nombre + apellido manuscritos (cajas superiores de la hoja ZipGrade).
 * Sirve para mostrarlo junto al buscador de alumnos al calificar.
 */
export function cropZipGradeNameSnippetDataUrl(
  canvas: HTMLCanvasElement,
  maxWidth = 520
): string | null {
  const aspect = canvas.width / Math.max(1, canvas.height);
  // Hoja enderezada ~850×1100 (aspect ~0.77)
  if (aspect > 0.68 && aspect < 0.88) {
    const fromSheet = cropNormRectToJpegDataUrl(
      canvas,
      ZIPGRADE_NAME_STRIP_NORM,
      maxWidth,
      0.95
    );
    if (fromSheet) return fromSheet;
  }
  // PDF reporte ZipGrade «Paper Details»: snippet de nombre arriba a la izquierda
  if (aspect < 0.95) {
    const fromReport = cropNormRectToJpegDataUrl(
      canvas,
      ZIPGRADE_REPORT_NAME_NORM,
      Math.min(maxWidth, 360),
      0.96
    );
    if (fromReport) return fromReport;
  }
  return cropNormRectToJpegDataUrl(canvas, ZIPGRADE_NAME_STRIP_NORM, maxWidth, 0.95);
}

function patchMeanLuma(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  pw: number,
  ph: number
): number {
  let sum = 0;
  let n = 0;
  const x1 = Math.min(width, x0 + pw);
  const y1 = y0 + ph;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      sum += data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
      n++;
    }
  }
  return n > 0 ? sum / n : 255;
}

/**
 * En reportes «Paper Details» la hoja está incrustada (no llena la página).
 * Busca un rectángulo con 4 esquinas oscuras y lo recorta para OMR / nombre.
 */
export function extractEmbeddedZipGradeSheet(
  canvas: HTMLCanvasElement
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 200 || canvas.height < 200) return null;

  const w = canvas.width;
  const h = canvas.height;
  const aspect = w / h;
  // Página de reporte típica (más alta que hoja carta sola)
  if (aspect >= 0.72 && aspect <= 0.85 && detectZipGradeCornerQuad(canvas)) {
    return null; // ya es hoja completa
  }

  let id: ImageData;
  try {
    id = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const d = id.data;
  const patch = Math.max(6, Math.round(Math.min(w, h) * 0.025));
  const darkLimit = 140;

  type Cand = { x: number; y: number; rw: number; rh: number; score: number };
  let best: Cand | null = null;

  // Candidatos: zona izquierda / centro (donde ZipGrade pone la foto de la hoja)
  const widths = [0.42, 0.48, 0.55, 0.62].map((f) => Math.round(w * f));
  for (const rw of widths) {
    const rh = Math.round(rw / 0.773);
    if (rh > h * 0.85 || rh < h * 0.28) continue;
    const stepX = Math.max(8, Math.round(rw * 0.08));
    const stepY = Math.max(8, Math.round(rh * 0.08));
    const maxX = Math.max(0, Math.floor(w * 0.62) - rw);
    const maxY = Math.max(0, h - rh - Math.round(h * 0.02));
    const minY = Math.round(h * 0.18);
    for (let y = minY; y <= maxY; y += stepY) {
      for (let x = 0; x <= maxX; x += stepX) {
        const tl = patchMeanLuma(d, w, x, y, patch, patch);
        const tr = patchMeanLuma(d, w, x + rw - patch, y, patch, patch);
        const bl = patchMeanLuma(d, w, x, y + rh - patch, patch, patch);
        const br = patchMeanLuma(d, w, x + rw - patch, y + rh - patch, patch, patch);
        const dark =
          (tl < darkLimit ? 1 : 0) +
          (tr < darkLimit ? 1 : 0) +
          (bl < darkLimit ? 1 : 0) +
          (br < darkLimit ? 1 : 0);
        if (dark < 3) continue;
        const score = dark * 1000 - (tl + tr + bl + br);
        if (!best || score > best.score) best = { x, y, rw, rh, score };
      }
    }
  }

  if (!best) return null;
  const out = document.createElement('canvas');
  out.width = best.rw;
  out.height = best.rh;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(canvas, best.x, best.y, best.rw, best.rh, 0, 0, best.rw, best.rh);
  return out;
}

/** Intenta detectar si la imagen es una hoja ZipGrade (4 esquinas negras, sin franjas CaliFacil). */
export function classifyAnswerSheetFormat(canvas: HTMLCanvasElement): ZipGradeSheetKind {
  const zgQuad = detectZipGradeCornerQuad(canvas);
  if (!zgQuad) return 'unknown';

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 'unknown';
  const w = canvas.width;
  const h = canvas.height;

  const stripW = Math.round(w * 0.04);
  let leftStripDark = 0;
  let rightStripDark = 0;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let y = Math.round(h * 0.15); y < Math.round(h * 0.85); y += 4) {
    for (let x = 0; x < stripW; x++) {
      const i = (y * w + x) * 4;
      const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
      if (lum < 80) leftStripDark++;
    }
    for (let x = w - stripW; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
      if (lum < 80) rightStripDark++;
    }
  }

  const stripScore = leftStripDark + rightStripDark;
  if (stripScore > 80) return 'califacil';
  return 'zipgrade';
}
