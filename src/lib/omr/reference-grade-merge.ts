import type { OmrNormRect } from '@/lib/omrScan';
import {
  REFERENCE_COL_EDGES,
  REFERENCE_GRADE_COLUMN_COUNT,
  REFERENCE_GRADE_HEIGHT,
  REFERENCE_GRADE_ROW_COUNT,
  REFERENCE_GRADE_WIDTH,
  REFERENCE_QNUM_WIDTH_RATIO,
  REFERENCE_ROW_LINE_YS,
  REFERENCE_TABLE_FRAME_NORM,
} from '@/lib/omr/reference-grade-calibration';

export function isReferenceGradeExam(rowCount: number, columns: number): boolean {
  return (
    rowCount === REFERENCE_GRADE_ROW_COUNT && columns === REFERENCE_GRADE_COLUMN_COUNT
  );
}

export function hasReferenceGradeCalibration(): boolean {
  return (
    REFERENCE_ROW_LINE_YS.length === REFERENCE_GRADE_ROW_COUNT + 1 &&
    REFERENCE_COL_EDGES.length === REFERENCE_GRADE_COLUMN_COUNT + 1 &&
    REFERENCE_GRADE_WIDTH > 0 &&
    REFERENCE_GRADE_HEIGHT > 0
  );
}

export function referenceTableFrameNorm(): OmrNormRect {
  return REFERENCE_TABLE_FRAME_NORM;
}

/** true si el canvas ya está en el tamaño del PDF de referencia (±4%). */
export function canvasMatchesReferenceGrade(width: number, height: number): boolean {
  const wOk = Math.abs(width - REFERENCE_GRADE_WIDTH) <= REFERENCE_GRADE_WIDTH * 0.04;
  const hOk = Math.abs(height - REFERENCE_GRADE_HEIGHT) <= REFERENCE_GRADE_HEIGHT * 0.04;
  return wOk && hOk;
}

/** Escaneos/PDFs rasterizados cercanos a referencia (±12% ancho) — sin homografía. */
export function canvasNearReferenceGrade(width: number, height: number): boolean {
  const wOk = Math.abs(width - REFERENCE_GRADE_WIDTH) <= REFERENCE_GRADE_WIDTH * 0.12;
  const hOk = Math.abs(height - REFERENCE_GRADE_HEIGHT) <= REFERENCE_GRADE_HEIGHT * 0.06;
  return wOk && hOk;
}

export function isReferenceGradeCanvasAnchor(width: number, height: number): boolean {
  return canvasMatchesReferenceGrade(width, height) || canvasNearReferenceGrade(width, height);
}

export function scaleReferenceLineYs(canvasHeight: number): number[] {
  const scale = canvasHeight / REFERENCE_GRADE_HEIGHT;
  return REFERENCE_ROW_LINE_YS.map((y) => Math.round(y * scale));
}

export function scaleReferenceColEdges(canvasWidth: number): number[] {
  const scale = canvasWidth / REFERENCE_GRADE_WIDTH;
  return REFERENCE_COL_EDGES.map((x) => Math.round(x * scale));
}

/** Mezcla líneas detectadas con la referencia (prioridad a lo detectado en overlay). */
export function mergeReferenceRowLineYs(
  detected: number[] | null,
  canvasHeight: number,
  rowCount: number
): number[] {
  const reference = scaleReferenceLineYs(canvasHeight);
  if (reference.length !== rowCount + 1) return reference;
  if (!detected || detected.length !== rowCount + 1) return reference;

  const rowH = (reference[rowCount]! - reference[0]!) / rowCount;
  const threshold = Math.max(4, rowH * 0.35);

  return detected.map((y, i) => {
    const refY = reference[i]!;
    const dev = Math.abs(y - refY);
    // Más peso a la rejilla real del PDF/escaneo (corrige desfase UP residual).
    if (dev <= threshold) return Math.round(y * 0.62 + refY * 0.38);
    return refY;
  });
}

/** Mezcla bordes de columna detectados con la referencia calibrada. */
export function mergeReferenceColumnEdges(
  detected: number[] | null,
  canvasWidth: number,
  columns: number
): number[] {
  const reference = scaleReferenceColEdges(canvasWidth);
  if (reference.length !== columns + 1) return reference;
  if (!detected || detected.length !== columns + 1) return reference;

  const cellW = (reference[columns]! - reference[0]!) / columns;
  const threshold = Math.max(5, cellW * 0.38);

  return detected.map((x, i) => {
    const refX = reference[i]!;
    const dev = Math.abs(x - refX);
    if (dev <= threshold) return Math.round(x * 0.58 + refX * 0.42);
    return refX;
  });
}

export { REFERENCE_QNUM_WIDTH_RATIO };
