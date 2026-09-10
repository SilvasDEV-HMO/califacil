/**
 * Un solo camino carta → geometría → lectura para Calificar (móvil + desktop).
 * Preview, OMR y overlay comparten el mismo canvas y la misma geometry.
 */
import {
  buildLetterDisplayOverlayGeometry,
  isAnswerSheetOmrMostlyBlank,
  prepareMobileScannedDocumentCanvasFast,
  rereadOmrPicksOnGeometry,
  scoreAnswerSheetGeometryBubbleFit,
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
};

const LETTER_GRID_ROWS = 30;

function canvasImageData(canvas: HTMLCanvasElement): ImageData | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

/**
 * Prepara carta warpeada para calificar: un canvas (sin split display/scan).
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
  const canvas =
    opts.preWarped === true
      ? prepareMobileScannedDocumentCanvasFast(source, { skipPrintCrop: true }) ?? source
      : source;
  const geometry = buildLetterDisplayOverlayGeometry(canvas, columns, rowCount, {
    skipSnap: false,
    maxShiftRatio: 0.22,
  });
  return {
    canvas,
    geometry,
    alignment: opts.warpAlignment ?? null,
  };
}

/**
 * Una lectura OMR sobre LetterCanvas con geometría de plantilla 30 filas.
 * Si el bubble-fit es malo, un solo reread con snap más agresivo (no cadena de sanitizes).
 */
export function gradeLetterCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number = LETTER_GRID_ROWS,
  opts?: { geometry?: CalifacilOmrScanGeometry }
): LetterGradeReadResult {
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const rows = Math.max(1, Math.min(LETTER_GRID_ROWS, rowCount));
  let geometry =
    opts?.geometry ??
    buildLetterDisplayOverlayGeometry(canvas, cols, rows, {
      skipSnap: false,
      maxShiftRatio: 0.22,
    });

  let meta = rereadOmrPicksOnGeometry(canvas, geometry, cols, rows, null);

  const img = canvasImageData(canvas);
  if (img) {
    const fit = scoreAnswerSheetGeometryBubbleFit(
      img.data,
      img.width,
      img.height,
      geometry,
      rows
    );
    if (fit < 0.55 && !isAnswerSheetOmrMostlyBlank(meta, rows)) {
      const recoveredGeom = buildLetterDisplayOverlayGeometry(canvas, cols, rows, {
        skipSnap: false,
        maxShiftRatio: 0.28,
      });
      const recovered = rereadOmrPicksOnGeometry(canvas, recoveredGeom, cols, rows, meta);
      const a = meta.picks.filter((p) => p != null).length;
      const b = recovered.picks.filter((p) => p != null).length;
      if (b >= a) {
        meta = recovered;
        geometry = recoveredGeom;
      }
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
  };
}
