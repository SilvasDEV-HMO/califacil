/**
 * Un solo camino carta → geometría (cells) → lectura para Calificar (móvil + desktop).
 * Preview, OMR y overlay comparten el mismo canvas y las mismas cells.
 */
import {
  buildAnswerSheetOmrGeometry,
  geometryCellsForBubbleSampling,
  isAnswerSheetOmrMostlyBlank,
  isCalifacilWarpedLetterCanvas,
  optimizeAnswerSheetGeometryBubbleFit,
  prepareMobileScannedDocumentCanvasFast,
  refineAnswerSheetGeometryToBubblePeaks,
  rereadOmrPicksOnGeometry,
  scoreAnswerSheetGeometryBubbleFit,
  syncCalifacilOmrGeometryImageSize,
  type CalifacilOmrScanGeometry,
  type OmrScanMetaResult,
  type WarpAlignmentReport,
} from '@/lib/omrScan';

export type LetterGradePrepareResult = {
  canvas: HTMLCanvasElement;
  geometry: CalifacilOmrScanGeometry;
  alignment: WarpAlignmentReport | null;
};

export type LetterGradeReadResult = {
  picks: (number | null)[];
  geometry: CalifacilOmrScanGeometry;
  meta: OmrScanMetaResult;
  bubbleFit: number;
};

const LETTER_GRID_ROWS = 30;
/** Mínimo bubble-fit para confiar una lectura densa (anti % inventado). */
export const LETTER_GRADE_MIN_BUBBLE_FIT = 0.55;

function canvasImageData(canvas: HTMLCanvasElement): ImageData | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

export function measureLetterGeometryBubbleFit(
  canvas: HTMLCanvasElement,
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): number {
  const img = canvasImageData(canvas);
  if (!img) return 0;
  const rows = Math.max(1, Math.min(LETTER_GRID_ROWS, rowCount));
  return scoreAnswerSheetGeometryBubbleFit(
    img.data,
    img.width,
    img.height,
    geometry,
    rows
  );
}

function readWithCellGeometry(
  canvas: HTMLCanvasElement,
  geometry: CalifacilOmrScanGeometry,
  cols: number,
  rows: number,
  baseMeta?: OmrScanMetaResult | null
): OmrScanMetaResult {
  const sampleGeom = geometryCellsForBubbleSampling(geometry);
  const meta = rereadOmrPicksOnGeometry(canvas, sampleGeom, cols, rows, baseMeta ?? null);
  return {
    ...meta,
    geometry,
    reviewSourceCanvas: canvas,
  };
}

/**
 * Prepara carta warpeada para calificar: un canvas (sin split display/scan).
 * Si ya es letter warpeada, no re-refine ni trim (evita drift de cells).
 */
export function prepareLetterGradeCanvas(
  source: HTMLCanvasElement,
  opts: {
    columns: number;
    rowCount?: number;
    preWarped?: boolean;
    warpAlignment?: WarpAlignmentReport | null;
  }
): LetterGradePrepareResult {
  const columns = Math.max(2, Math.min(5, Math.round(opts.columns)));
  const rowCount = Math.max(1, Math.min(LETTER_GRID_ROWS, opts.rowCount ?? LETTER_GRID_ROWS));
  let canvas = source;
  if (opts.preWarped === true) {
    if (!isCalifacilWarpedLetterCanvas(source)) {
      canvas =
        prepareMobileScannedDocumentCanvasFast(source, { skipPrintCrop: true }) ?? source;
    }
    // Carta ya warpeada: usar tal cual (sin segundo refine/trim).
  }
  const geometry = syncCalifacilOmrGeometryImageSize(
    buildAnswerSheetOmrGeometry(rowCount, columns, canvas.width, canvas.height),
    canvas.width,
    canvas.height
  );
  return {
    canvas,
    geometry,
    alignment: opts.warpAlignment ?? null,
  };
}

/**
 * Una lectura OMR: desplaza cells al bubble-fit, muestrea con margen, guarda esa geometry.
 * Recovery solo si mejora el fit (no por más picks).
 */
export function gradeLetterCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number = LETTER_GRID_ROWS,
  opts?: { geometry?: CalifacilOmrScanGeometry }
): LetterGradeReadResult {
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const rows = Math.max(1, Math.min(LETTER_GRID_ROWS, rowCount));
  const base =
    opts?.geometry ??
    syncCalifacilOmrGeometryImageSize(
      buildAnswerSheetOmrGeometry(rows, cols, canvas.width, canvas.height),
      canvas.width,
      canvas.height
    );

  let geometry = optimizeAnswerSheetGeometryBubbleFit(canvas, base, rows);
  let fit = measureLetterGeometryBubbleFit(canvas, geometry, rows);
  let meta = readWithCellGeometry(canvas, geometry, cols, rows, null);

  if (fit < LETTER_GRADE_MIN_BUBBLE_FIT && !isAnswerSheetOmrMostlyBlank(meta, rows)) {
    const snapped = refineAnswerSheetGeometryToBubblePeaks(canvas, geometry, null, {
      preferInk: false,
      maxShiftRatio: 0.28,
    });
    const snappedFit = measureLetterGeometryBubbleFit(canvas, snapped, rows);
    if (snappedFit > fit + 0.02) {
      meta = readWithCellGeometry(canvas, snapped, cols, rows, meta);
      geometry = snapped;
      fit = snappedFit;
    }
  }

  return {
    picks: meta.picks.slice(0, rows),
    geometry: meta.geometry ?? geometry,
    meta: {
      ...meta,
      geometry: meta.geometry ?? geometry,
      reviewSourceCanvas: canvas,
    },
    bubbleFit: fit,
  };
}
