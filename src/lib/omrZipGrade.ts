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
 * Cajas Nombre | Apellido encima de la rejilla (hoja ZipGrade enderezada).
 * Varias plantillas usadas en México (wizard custom).
 */
const ZIPGRADE_NAME_LAYOUTS: ReadonlyArray<{
  left: { x: number; y: number; w: number; h: number };
  right: { x: number; y: number; w: number; h: number };
}> = [
  {
    left: { x: 0.055, y: 0.032, w: 0.42, h: 0.115 },
    right: { x: 0.49, y: 0.032, w: 0.44, h: 0.115 },
  },
  {
    left: { x: 0.06, y: 0.045, w: 0.4, h: 0.1 },
    right: { x: 0.5, y: 0.045, w: 0.42, h: 0.1 },
  },
  {
    left: { x: 0.05, y: 0.025, w: 0.43, h: 0.13 },
    right: { x: 0.5, y: 0.025, w: 0.43, h: 0.13 },
  },
];

/** Una sola franja ancha (formularios con un solo campo Name). */
const ZIPGRADE_NAME_WIDE_NORMS = [
  { x: 0.055, y: 0.032, w: 0.88, h: 0.12 },
  { x: 0.06, y: 0.04, w: 0.86, h: 0.1 },
] as const;

/** Fallback: región típica de la foto de la hoja en el PDF Paper Details. */
const PAPER_DETAILS_SHEET_FALLBACK = { x: 0.02, y: 0.36, w: 0.47, h: 0.58 } as const;

export type ZipGradeSheetKind = 'califacil' | 'zipgrade' | 'unknown';

/** Detecta el verde característico del logo ZipGrade (evita recortarlo como «nombre»). */
function regionLooksLikeZipGradeLogo(
  data: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  let greenHits = 0;
  let brightGreen = 0;
  let samples = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 60));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      samples++;
      if (g > 90 && g > r + 22 && g > b + 10) greenHits++;
      if (g > 120 && r < 120 && b < 140 && g - r > 35) brightGreen++;
    }
  }
  if (samples === 0) return false;
  return greenHits / samples > 0.022 || brightGreen / samples > 0.01;
}

function canvasRegionLooksLikeLogo(
  canvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || sw < 4 || sh < 4) return false;
  try {
    const id = ctx.getImageData(sx, sy, sw, sh);
    return regionLooksLikeZipGradeLogo(id.data, sw, sh);
  } catch {
    return false;
  }
}

/** Logo ZipGrade arriba-izquierda del PDF Paper Details. */
function pageHasZipGradeReportLogo(canvas: HTMLCanvasElement): boolean {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 80 || h < 80) return false;
  const probes = [
    { x: 0, y: 0, wf: 0.34, hf: 0.14 },
    { x: 0, y: 0, wf: 0.22, hf: 0.09 },
    { x: Math.round(w * 0.01), y: Math.round(h * 0.01), wf: 0.28, hf: 0.11 },
  ];
  for (const p of probes) {
    const sw = Math.max(12, Math.round(w * p.wf));
    const sh = Math.max(10, Math.round(h * p.hf));
    if (canvasRegionLooksLikeLogo(canvas, p.x, p.y, sw, sh)) return true;
  }
  return false;
}

/**
 * Página PDF «Paper Details» de ZipGrade: fondo blanco, logo verde arriba,
 * hoja de respuestas incrustada (no llena la página).
 */
export function isZipGradePaperDetailsReport(canvas: HTMLCanvasElement): boolean {
  if (canvas.width < 200 || canvas.height < 200) return false;
  if (pageHasZipGradeReportLogo(canvas)) return true;
  const w = canvas.width;
  const h = canvas.height;
  const aspect = w / Math.max(1, h);
  // Página sin esquinas negras de hoja + proporción de reporte
  const pageCornersDark = detectZipGradeCornerQuad(canvas) != null;
  if (pageCornersDark) return false;
  return aspect < 0.68 || aspect > 0.92 || h > w * 1.2;
}

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

function jpegDataUrlFromCanvas(source: HTMLCanvasElement, maxWidth: number): string | null {
  const scale = Math.min(1, maxWidth / Math.max(1, source.width));
  let out = source;
  if (scale < 0.999) {
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.round(source.width * scale));
    scaled.height = Math.max(1, Math.round(source.height * scale));
    const sctx = scaled.getContext('2d');
    if (!sctx) return null;
    sctx.drawImage(source, 0, 0, scaled.width, scaled.height);
    out = scaled;
  }
  try {
    return out.toDataURL('image/jpeg', 0.92);
  } catch {
    return null;
  }
}

function stitchRejectingLogo(
  left: HTMLCanvasElement,
  right: HTMLCanvasElement,
  maxWidth: number
): string | null {
  if (canvasRegionLooksLikeLogo(left, 0, 0, left.width, left.height)) return null;
  if (canvasRegionLooksLikeLogo(right, 0, 0, right.width, right.height)) return null;

  const gap = 8;
  const h = Math.max(left.height, right.height);
  const out = document.createElement('canvas');
  out.width = left.width + gap + right.width;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(left, 0, Math.floor((h - left.height) / 2));
  ctx.drawImage(right, left.width + gap, Math.floor((h - right.height) / 2));

  try {
    const id = ctx.getImageData(0, 0, out.width, out.height);
    if (regionLooksLikeZipGradeLogo(id.data, out.width, out.height)) return null;
    // El logo suele quedar a la izquierda del stitch
    const leftW = Math.max(8, Math.floor(out.width * 0.4));
    const leftId = ctx.getImageData(0, 0, leftW, out.height);
    if (regionLooksLikeZipGradeLogo(leftId.data, leftW, out.height)) return null;
    const mean = canvasMeanLuminance(ctx, out.width, out.height);
    if (mean != null && mean > 0.97) return null;
  } catch {
    return null;
  }
  return jpegDataUrlFromCanvas(out, maxWidth);
}

function cropWideNameRejectingLogo(
  sheet: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
  maxWidth: number
): string | null {
  const piece = cropRect(sheet, rect);
  if (!piece) return null;
  if (canvasRegionLooksLikeLogo(piece, 0, 0, piece.width, piece.height)) return null;
  const leftW = Math.max(8, Math.floor(piece.width * 0.35));
  if (canvasRegionLooksLikeLogo(piece, 0, 0, leftW, piece.height)) return null;
  const ctx = piece.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const mean = canvasMeanLuminance(ctx, piece.width, piece.height);
  if (mean != null && mean > 0.97) return null;
  return jpegDataUrlFromCanvas(piece, maxWidth);
}

/**
 * Une las cajas [Nombre] [Apellido] de la hoja ZipGrade en un solo JPEG.
 * Rechaza cualquier recorte que parezca el logo verde del reporte.
 * Solo llamar con la hoja (o warpeada), nunca con la página Paper Details entera.
 */
function cropNameAndApellidoFromSheet(
  sheet: HTMLCanvasElement,
  maxWidth: number
): string | null {
  if (typeof document === 'undefined' || sheet.width < 40 || sheet.height < 40) {
    return null;
  }
  // Si nos pasaron el reporte completo por error, no recortar arriba (logo).
  if (pageHasZipGradeReportLogo(sheet)) return null;

  for (const layout of ZIPGRADE_NAME_LAYOUTS) {
    const left = cropRect(sheet, layout.left);
    const right = cropRect(sheet, layout.right);
    if (!left || !right) continue;
    const url = stitchRejectingLogo(left, right, maxWidth);
    if (url) return url;
  }
  for (const wide of ZIPGRADE_NAME_WIDE_NORMS) {
    const url = cropWideNameRejectingLogo(sheet, wide, maxWidth);
    if (url) return url;
  }
  return null;
}

function cropSheetFallbackFromReport(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  return cropRect(canvas, PAPER_DETAILS_SHEET_FALLBACK);
}

/**
 * Recorte JPEG del nombre + apellido desde una hoja ZipGrade ya resuelta/warpeada.
 * No intenta extraer de reportes — usar resolveZipGradeSheetForGrading para eso.
 */
export function cropZipGradeNameFromSheetCanvas(
  sheet: HTMLCanvasElement,
  maxWidth = 560
): string | null {
  return cropNameAndApellidoFromSheet(sheet, maxWidth);
}

/**
 * Recorte JPEG del nombre + apellido manuscritos (cajas superiores de la hoja ZipGrade).
 * Nunca usa el logo del reporte Paper Details.
 */
export function cropZipGradeNameSnippetDataUrl(
  canvas: HTMLCanvasElement,
  maxWidth = 520
): string | null {
  if (typeof document === 'undefined' || canvas.width < 40 || canvas.height < 40) {
    return null;
  }
  // Hoja ya aislada / warpeada: recortar directo.
  if (!pageHasZipGradeReportLogo(canvas) && detectZipGradeCornerQuad(canvas)) {
    const warped = warpZipGradeAnswerSheet(canvas).warped;
    return cropNameAndApellidoFromSheet(warped ?? canvas, maxWidth);
  }
  const resolved = resolveZipGradeSheetForGrading(canvas);
  return resolved.nameCropUrl;
}

/**
 * Devuelve el canvas listo para OMR ZipGrade: hoja cruda o recorte de Paper Details.
 * El nameCropUrl siempre sale de las cajas nombre/apellido de la hoja (nunca el logo).
 */
export function resolveZipGradeSheetForGrading(canvas: HTMLCanvasElement): {
  sheet: HTMLCanvasElement;
  fromReport: boolean;
  nameCropUrl: string | null;
} {
  const hasLogo = pageHasZipGradeReportLogo(canvas);
  const report = hasLogo || isZipGradePaperDetailsReport(canvas);
  // Con logo arriba, NUNCA tratar la página como hoja completa.
  const pageIsFullSheet = !hasLogo && detectZipGradeCornerQuad(canvas) != null;

  let embedded: HTMLCanvasElement | null = null;
  if (report || !pageIsFullSheet) {
    embedded = extractEmbeddedZipGradeSheet(canvas) ?? cropSheetFallbackFromReport(canvas);
  } else {
    embedded = extractEmbeddedZipGradeSheet(canvas);
  }

  let useSheet = canvas;
  if (embedded) {
    const embeddedSmaller =
      embedded.width * embedded.height < canvas.width * canvas.height * 0.58;
    if (report || !pageIsFullSheet || embeddedSmaller) {
      useSheet = embedded;
    }
  }

  const fromReport = useSheet !== canvas;
  // Preferir hoja warpeada para alinear Nombre | Apellido.
  const warped = warpZipGradeAnswerSheet(useSheet).warped;
  const nameSource = warped ?? useSheet;
  let nameCropUrl = cropNameAndApellidoFromSheet(nameSource, 560);
  if (!nameCropUrl && nameSource !== useSheet) {
    nameCropUrl = cropNameAndApellidoFromSheet(useSheet, 560);
  }

  return { sheet: useSheet, fromReport, nameCropUrl };
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
 * En reportes «Paper Details» la hoja está incrustada abajo-izquierda.
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
  // Ya es hoja completa (sin logo de reporte arriba)
  if (
    !pageHasZipGradeReportLogo(canvas) &&
    aspect >= 0.72 &&
    aspect <= 0.85 &&
    detectZipGradeCornerQuad(canvas)
  ) {
    return null;
  }

  let id: ImageData;
  try {
    id = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const d = id.data;
  const patch = Math.max(6, Math.round(Math.min(w, h) * 0.02));
  const darkLimit = 155;

  type Cand = { x: number; y: number; rw: number; rh: number; score: number };
  let best: Cand | null = null;

  // Paper Details: hoja ~45% ancho, mitad inferior-izquierda
  const widths = [0.38, 0.42, 0.46, 0.5, 0.55].map((f) => Math.round(w * f));
  for (const rw of widths) {
    const rh = Math.round(rw / 0.773);
    if (rh > h * 0.78 || rh < h * 0.32) continue;
    const stepX = Math.max(6, Math.round(rw * 0.06));
    const stepY = Math.max(6, Math.round(rh * 0.06));
    const maxX = Math.max(0, Math.floor(w * 0.55) - rw);
    const maxY = Math.max(0, h - rh - Math.round(h * 0.01));
    // Debajo del encabezado / logo ZipGrade
    const minY = Math.round(h * 0.28);
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
        // Preferir más grande y más abajo (foto de la hoja en el reporte)
        const areaBonus = (rw * rh) / (w * h);
        const lowBonus = y / h;
        const score = dark * 1000 - (tl + tr + bl + br) + areaBonus * 800 + lowBonus * 200;
        if (!best || score > best.score) best = { x, y, rw, rh, score };
      }
    }
  }

  if (best) {
    const out = document.createElement('canvas');
    out.width = best.rw;
    out.height = best.rh;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(canvas, best.x, best.y, best.rw, best.rh, 0, 0, best.rw, best.rh);
    return out;
  }
  // Fallback geométrico típico de Paper Details (foto de la hoja abajo-izquierda)
  return cropSheetFallbackFromReport(canvas);
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
