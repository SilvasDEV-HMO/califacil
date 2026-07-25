import {
  buildCellsFromTableLines,
  califacilOmrTableFrameNormRect,
  detectFullCanvasTableGeometry,
  refineAnswerSheetGeometryToBubblePeaks,
  scaleCanvasToMaxSide,
  type CalifacilOmrScanGeometry,
  type OmrNormRect,
} from '@/lib/omrScan';
import {
  REFERENCE_GRADE_HEIGHT,
  REFERENCE_GRADE_MAX_SIDE,
  REFERENCE_GRADE_WIDTH,
} from '@/lib/omr/reference-grade-calibration';
import {
  hasReferenceGradeCalibration,
  isReferenceGradeExam,
  mergeReferenceColumnEdges,
  mergeReferenceRowLineYs,
  referenceTableFrameNorm,
  canvasMatchesReferenceGrade,
  canvasNearReferenceGrade,
  isReferenceGradeCanvasAnchor,
  scaleReferenceColEdges,
  scaleReferenceLineYs,
} from '@/lib/omr/reference-grade-merge';
import {
  computeHomographySrcToDst,
  warpCanvasWithHomography,
  type HomographyPoint,
} from '@/lib/omr/homography';

export {
  hasReferenceGradeCalibration,
  isReferenceGradeExam,
  mergeReferenceColumnEdges,
  mergeReferenceRowLineYs,
  referenceTableFrameNorm,
};

function normRectToQuad(
  rect: OmrNormRect,
  width: number,
  height: number
): [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint] {
  const x = rect.x * width;
  const y = rect.y * height;
  const w = rect.w * width;
  const h = rect.h * height;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function detectSourceTableFrame(
  canvas: HTMLCanvasElement,
  rowCount: number,
  columns: number
): OmrNormRect | null {
  const swept = detectFullCanvasTableGeometry(canvas, rowCount, columns);
  if (swept?.tableFrame) return swept.tableFrame;
  if (isReferenceGradeExam(rowCount, columns)) {
    return califacilOmrTableFrameNormRect(rowCount);
  }
  return null;
}

/** Desviación máxima normalizada entre marcos de tabla (0–1). */
function tableFrameDeviation(a: OmrNormRect, b: OmrNormRect): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.w - b.w),
    Math.abs(a.h - b.h)
  );
}

/**
 * Alinea la captura al canvas de referencia (homografía tabla→tabla).
 * Devuelve null si no hay calibración o no se puede alinear.
 */
export function alignCanvasToReferenceGrade(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number
): HTMLCanvasElement | null {
  if (!isReferenceGradeExam(rowCount, columns) || !hasReferenceGradeCalibration()) {
    return null;
  }
  if (typeof document === 'undefined') return null;

  const dstFrame = referenceTableFrameNorm();
  const srcFrame = detectSourceTableFrame(canvas, rowCount, columns);
  if (!srcFrame) {
    if (isReferenceGradeCanvasAnchor(canvas.width, canvas.height)) return canvas;
    return scaleCanvasToMaxSide(canvas, REFERENCE_GRADE_MAX_SIDE);
  }

  // Evita estirar media hoja (p. ej. solo filas 15–30) sobre el canvas de referencia.
  const expectedFrame = califacilOmrTableFrameNormRect(rowCount) ?? dstFrame;
  if (srcFrame.h < expectedFrame.h * 0.7 || srcFrame.w < expectedFrame.w * 0.7) {
    return null;
  }

  if (isReferenceGradeCanvasAnchor(canvas.width, canvas.height)) {
    return canvas;
  }

  const sizeMatches = canvasMatchesReferenceGrade(canvas.width, canvas.height);
  const frameAligned = tableFrameDeviation(srcFrame, dstFrame) < 0.012;
  if (sizeMatches && frameAligned) return canvas;

  if (frameAligned && Math.abs(canvas.width - REFERENCE_GRADE_WIDTH) / REFERENCE_GRADE_WIDTH < 0.08) {
    return scaleCanvasToMaxSide(canvas, REFERENCE_GRADE_MAX_SIDE);
  }

  const srcQuad = normRectToQuad(srcFrame, canvas.width, canvas.height);
  const dstQuad = normRectToQuad(dstFrame, REFERENCE_GRADE_WIDTH, REFERENCE_GRADE_HEIGHT);
  const h = computeHomographySrcToDst(srcQuad, dstQuad);
  if (!h) {
    return scaleCanvasToMaxSide(canvas, REFERENCE_GRADE_MAX_SIDE);
  }

  const warped = warpCanvasWithHomography(canvas, h, REFERENCE_GRADE_WIDTH, REFERENCE_GRADE_HEIGHT);
  return warped ?? scaleCanvasToMaxSide(canvas, REFERENCE_GRADE_MAX_SIDE);
}

/**
 * Geometría híbrida anclada al PDF de referencia, refinada sobre el canvas alineado.
 */
export function buildReferenceAnchoredGeometry(
  canvas: HTMLCanvasElement,
  rowCount: number,
  columns: number
): CalifacilOmrScanGeometry | null {
  if (!isReferenceGradeExam(rowCount, columns) || !hasReferenceGradeCalibration()) {
    return null;
  }

  const rows = rowCount;
  const cols = columns;
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);

  let lineYs = scaleReferenceLineYs(height);
  let colEdges = scaleReferenceColEdges(width);

  const swept = detectFullCanvasTableGeometry(canvas, rows, cols);
  if (swept?.geometry.cells.length === rows) {
    const detLineYs: number[] = [];
    for (let r = 0; r <= rows; r++) {
      if (r === 0) detLineYs.push(Math.round(swept.geometry.cells[0]![0]!.y * height));
      else if (r === rows) {
        const last = swept.geometry.cells[rows - 1]![0]!;
        detLineYs.push(Math.round((last.y + last.h) * height));
      } else detLineYs.push(Math.round(swept.geometry.cells[r]![0]!.y * height));
    }
    const detColEdges: number[] = [Math.round(swept.geometry.cells[0]![0]!.x * width)];
    for (let c = 0; c < cols; c++) {
      const cell = swept.geometry.cells[0]![c]!;
      detColEdges.push(Math.round((cell.x + cell.w) * width));
    }
    lineYs = mergeReferenceRowLineYs(detLineYs, height, rows);
    colEdges = mergeReferenceColumnEdges(detColEdges, width, cols);
  }

  let geometry = buildCellsFromTableLines(lineYs, colEdges, width, height, cols);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    const imageData =
      ctx.getImageData(0, 0, width, height).data;
    geometry = refineAnswerSheetGeometryToBubblePeaks(canvas, geometry, imageData, {
      preferInk: false,
    });
  }
  return geometry;
}

/** Alinea (si aplica) y devuelve canvas listo para lectura OMR de 30 filas. */
export function prepareReferenceGradeCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number
): HTMLCanvasElement {
  if (!isReferenceGradeExam(rowCount, columns)) return canvas;
  return alignCanvasToReferenceGrade(canvas, columns, rowCount) ?? canvas;
}
