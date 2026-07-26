import { preprocessForSheetDetection } from '@/lib/omr/preprocess';
import { prepareReferenceGradeCanvas } from '@/lib/omr/reference-grade';
import type { WarpAlignmentReport } from '@/lib/omrScan';
import {
  MAX_WARP_ALIGNMENT_ERROR_PX,
  autoOrientCalifacilSheet,
  captureImageFullFrame,
  countCalifacilCornerMarkers,
  detectAnswerSheetQuadViaAlignStrips,
  detectCalifacilSheetCornerQuadRobust,
  isCalifacilExamSheetLikely,
  isCalifacilWarpedLetterCanvas,
  hasCalifacilAlignStrips,
  isMobileWarpedAnswerSheetAcceptable,
  isMobileWarpedAnswerSheetReady,
  mapRoiQuadToFrame,
  measureWarpedFiducialAlignment,
  prepareMobileGradeDocumentCanvas,
  prepareMobileScannedDocumentCanvasFast,
  refineWarpedCalifacilSheet,
  scaleCanvasToMaxSide,
  scaleQuadToCanvas,
  warpAndValidateCalifacilSheet,
  warpCalifacilSheetFromCornerMarkers,
  type MobileGuideRoiCapture,
  type Point,
} from '@/lib/omrScan';

/** Misma resolución que el PDF rasterizado en calificar (referencia visual + OMR). */
export const CALIFACIL_GRADE_DOCUMENT_MAX_SIDE = 1600;

export type NormalizeGradeDocumentResult = {
  canvas: HTMLCanvasElement;
  alignment: WarpAlignmentReport | null;
  /** true si se enderezó o reorientó respecto al original */
  normalized: boolean;
};

export type RoiQuad = [Point, Point, Point, Point];

export type MobileWarpPipelineResult = {
  warped: HTMLCanvasElement | null;
  alignment: WarpAlignmentReport | null;
  /** Origen del cuadrilátero ganador (diagnóstico). */
  source: 'roi' | 'full_res' | 'corner_markers' | 'strips' | 'none';
};

function alignmentScore(alignment: WarpAlignmentReport | null): number {
  if (!alignment) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(alignment.maxErrorPx)) return Number.POSITIVE_INFINITY;
  return alignment.maxErrorPx;
}

function warpCandidateScore(
  warped: HTMLCanvasElement | null,
  alignment: WarpAlignmentReport | null
): number {
  if (!warped || !isCalifacilWarpedLetterCanvas(warped)) return Number.POSITIVE_INFINITY;
  const corners = countCalifacilCornerMarkers(warped);
  const align = alignmentScore(alignment);
  if (corners < 2) return align + 400;
  if (!isMobileWarpedAnswerSheetAcceptable(warped)) return align + 120;
  return align - corners * 3;
}

function finalizeWarpCandidate(
  warped: HTMLCanvasElement | null,
  alignment: WarpAlignmentReport | null,
  maxAllowedPx: number,
  fast = false
): { warped: HTMLCanvasElement | null; alignment: WarpAlignmentReport | null } {
  if (!warped) return { warped: null, alignment };
  const refined = refineWarpedCalifacilSheet(warped, { maxAllowedPx, fast });
  return { warped: refined.canvas, alignment: refined.alignment };
}

/**
 * Warp rápido para captura móvil: un solo camino, sin barrido full-res.
 * Estilo ZipGrade: foto → documento enderezado en <1 s.
 * Solo devuelve warped Acceptable (4 esquinas, o 3 + franjas) — evita doble rechazo al calificar.
 */
export function warpCalifacilMobileCaptureFast(
  fullCanvas: HTMLCanvasElement,
  opts?: {
    /** Quad ya en coordenadas del fotograma completo. */
    frameQuad?: RoiQuad | null;
    roiQuad?: RoiQuad | null;
    roiCapture?: MobileGuideRoiCapture | null;
    maxErrorPx?: number;
  }
): MobileWarpPipelineResult {
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;
  const fallbackMaxErrorPx = maxErrorPx + 8;

  const tryAccept = (
    warped: HTMLCanvasElement | null,
    alignment: WarpAlignmentReport | null,
    source: MobileWarpPipelineResult['source']
  ): MobileWarpPipelineResult | null => {
    if (!warped || !isMobileWarpedAnswerSheetAcceptable(warped)) return null;
    return { warped, alignment, source };
  };

  if (opts?.frameQuad) {
    const frameWarp = warpAndValidateCalifacilSheet(fullCanvas, opts.frameQuad, maxErrorPx, {
      fast: true,
    });
    const ok = tryAccept(frameWarp.warped, frameWarp.alignment, 'full_res');
    if (ok) return ok;
  }

  const roiQuad = opts?.roiQuad;
  const roiCapture = opts?.roiCapture;
  if (roiQuad && roiCapture) {
    const roiW = roiCapture.roiCanvas.width;
    const roiH = roiCapture.roiCanvas.height;
    const frameQuad = mapRoiQuadToFrame(roiQuad, roiCapture.roiRect, roiW, roiH);
    const scaledQuad = scaleQuadToCanvas(
      frameQuad,
      roiCapture.frameW,
      roiCapture.frameH,
      fullCanvas.width,
      fullCanvas.height
    );
    const roiWarp = warpAndValidateCalifacilSheet(fullCanvas, scaledQuad, maxErrorPx, {
      fast: true,
    });
    const ok = tryAccept(roiWarp.warped, roiWarp.alignment, 'roi');
    if (ok) return ok;
  }

  const preprocessed = preprocessForSheetDetection(fullCanvas);
  for (const target of [preprocessed, fullCanvas].filter(Boolean) as HTMLCanvasElement[]) {
    const stripQuad = detectAnswerSheetQuadViaAlignStrips(target);
    if (!stripQuad) continue;
    const stripWarp = warpAndValidateCalifacilSheet(fullCanvas, stripQuad, maxErrorPx, {
      fast: true,
    });
    const ok = tryAccept(stripWarp.warped, stripWarp.alignment, 'strips');
    if (ok) return ok;
  }

  const cornerWarped = warpCalifacilSheetFromCornerMarkers(fullCanvas);
  if (cornerWarped) {
    const finalized = finalizeWarpCandidate(
      cornerWarped,
      measureWarpedFiducialAlignment(cornerWarped, fallbackMaxErrorPx),
      fallbackMaxErrorPx,
      true
    );
    const ok = tryAccept(finalized.warped, finalized.alignment, 'corner_markers');
    if (ok) return ok;
  }

  return { warped: null, alignment: null, source: 'none' };
}

/**
 * Pipeline móvil: franjas negras + ROI + detección full-res + fiduciales.
 */
export function warpCalifacilMobileCapture(
  fullCanvas: HTMLCanvasElement,
  opts?: {
    /** Quad ya en coordenadas del fotograma completo (mismo canvas que se warpea). */
    frameQuad?: RoiQuad | null;
    roiQuad?: RoiQuad | null;
    roiCapture?: MobileGuideRoiCapture | null;
    maxErrorPx?: number;
    fallbackMaxErrorPx?: number;
  }
): MobileWarpPipelineResult {
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;
  const fallbackMaxErrorPx = opts?.fallbackMaxErrorPx ?? maxErrorPx + 6;

  let best: MobileWarpPipelineResult = {
    warped: null,
    alignment: null,
    source: 'none',
  };
  let bestScore = Number.POSITIVE_INFINITY;

  const consider = (
    warped: HTMLCanvasElement | null,
    alignment: WarpAlignmentReport | null,
    source: MobileWarpPipelineResult['source'],
    allowPx: number
  ) => {
    const finalized = finalizeWarpCandidate(warped, alignment, allowPx);
    const score = warpCandidateScore(finalized.warped, finalized.alignment);
    if (finalized.warped && score < bestScore) {
      bestScore = score;
      best = { ...finalized, source };
    }
  };

  const preprocessed = preprocessForSheetDetection(fullCanvas);
  const detectTargets: HTMLCanvasElement[] = preprocessed
    ? [preprocessed, fullCanvas]
    : [fullCanvas];

  if (opts?.frameQuad) {
    const frameWarp = warpAndValidateCalifacilSheet(fullCanvas, opts.frameQuad, maxErrorPx);
    consider(frameWarp.warped, frameWarp.alignment, 'full_res', maxErrorPx);
  }

  const roiQuad = opts?.roiQuad;
  const roiCapture = opts?.roiCapture;
  if (roiQuad && roiCapture) {
    const roiW = roiCapture.roiCanvas.width;
    const roiH = roiCapture.roiCanvas.height;
    const frameQuad = mapRoiQuadToFrame(roiQuad, roiCapture.roiRect, roiW, roiH);
    const scaledQuad = scaleQuadToCanvas(
      frameQuad,
      roiCapture.frameW,
      roiCapture.frameH,
      fullCanvas.width,
      fullCanvas.height
    );
    const roiWarp = warpAndValidateCalifacilSheet(fullCanvas, scaledQuad, maxErrorPx);
    consider(roiWarp.warped, roiWarp.alignment, 'roi', maxErrorPx);
  }

  for (const target of detectTargets) {
    const stripQuad = detectAnswerSheetQuadViaAlignStrips(target);
    if (!stripQuad) continue;
    const stripWarp = warpAndValidateCalifacilSheet(fullCanvas, stripQuad, maxErrorPx);
    consider(stripWarp.warped, stripWarp.alignment, 'strips', maxErrorPx);
  }

  for (const target of detectTargets) {
    const quad = detectCalifacilSheetCornerQuadRobust(target, { skipPreprocess: true });
    if (!quad) continue;
    const fullWarp = warpAndValidateCalifacilSheet(fullCanvas, quad, maxErrorPx);
    consider(fullWarp.warped, fullWarp.alignment, 'full_res', maxErrorPx);
    if (best.warped && isMobileWarpedAnswerSheetAcceptable(best.warped) && best.alignment?.ok) {
      break;
    }
  }

  const cornerWarped = warpCalifacilSheetFromCornerMarkers(fullCanvas);
  if (cornerWarped) {
    const cornerRefined = refineWarpedCalifacilSheet(cornerWarped, {
      maxAllowedPx: fallbackMaxErrorPx,
    });
    consider(cornerRefined.canvas, cornerRefined.alignment, 'corner_markers', fallbackMaxErrorPx);
  }

  return best;
}

export type DesktopUploadClass = 'pdf' | 'flatScan' | 'photoCrop' | 'warpedPhoto';

function isLikelyFlatCalifacilDocument(
  canvas: HTMLCanvasElement,
  columns: number,
  opts?: { flatDocument?: boolean }
): boolean {
  if (opts?.flatDocument) return true;
  if (isCalifacilWarpedLetterCanvas(canvas)) return false;
  if (!isCalifacilExamSheetLikely(canvas, columns)) return false;
  if (!hasCalifacilAlignStrips(canvas)) return false;
  const aspect = canvas.width / Math.max(1, canvas.height);
  return aspect > 0.68 && aspect < 0.88;
}

/** Clasifica subidas desktop para enrutar normalización y escaneo OMR. */
export function classifyDesktopUploadCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  opts?: { isServerRenderedPdfPage?: boolean; preWarped?: boolean }
): DesktopUploadClass {
  if (opts?.isServerRenderedPdfPage) return 'pdf';
  if (opts?.preWarped || isCalifacilWarpedLetterCanvas(canvas) || isMobileWarpedAnswerSheetReady(canvas)) {
    return 'warpedPhoto';
  }
  if (isLikelyFlatCalifacilDocument(canvas, columns)) return 'flatScan';
  return 'photoCrop';
}

/**
 * Endereza y escala cualquier captura al mismo formato que un PDF de hoja CaliFacil
 * (carta, ~1600 px de lado mayor, fiduciales alineados) para lectura OMR uniforme.
 */
export function normalizeCalifacilGradeDocumentCanvas(
  source: HTMLCanvasElement,
  columns: number,
  opts?: {
    maxSide?: number;
    maxErrorPx?: number;
    flatDocument?: boolean;
    uploadClass?: DesktopUploadClass;
    rowCount?: number;
  }
): NormalizeGradeDocumentResult {
  const maxSide = opts?.maxSide ?? CALIFACIL_GRADE_DOCUMENT_MAX_SIDE;
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;

  const finish = (
    canvas: HTMLCanvasElement,
    alignment: WarpAlignmentReport | null,
    normalized: boolean
  ): NormalizeGradeDocumentResult => {
    let out = scaleCanvasToMaxSide(canvas, maxSide);
    const shouldReferenceAlign = opts?.rowCount != null && opts.rowCount > 0;
    if (shouldReferenceAlign) {
      out = prepareReferenceGradeCanvas(out, columns, opts.rowCount!);
    }
    return { canvas: out, alignment, normalized };
  };

  const base = captureImageFullFrame(source, { maxSide: Math.max(maxSide, 2400) }) ?? source;
  const uploadClass =
    opts?.uploadClass ?? classifyDesktopUploadCanvas(base, columns);
  const useFlatPath =
    uploadClass === 'pdf' ||
    uploadClass === 'flatScan' ||
    isLikelyFlatCalifacilDocument(base, columns, {
      flatDocument: opts?.flatDocument,
    });

  if (useFlatPath) {
    return finish(base, null, false);
  }

  if (isMobileWarpedAnswerSheetAcceptable(base)) {
    const doc = prepareMobileGradeDocumentCanvas(base, null);
    return finish(
      doc,
      measureWarpedFiducialAlignment(doc, maxErrorPx),
      Math.max(base.width, base.height) > maxSide * 1.08
    );
  }

  for (const attempt of [
    () => warpCalifacilMobileCaptureFast(base, { maxErrorPx }),
    () =>
      warpCalifacilMobileCapture(base, {
        maxErrorPx,
        fallbackMaxErrorPx: maxErrorPx + 12,
      }),
  ]) {
    const result = attempt();
    if (result.warped && isMobileWarpedAnswerSheetAcceptable(result.warped)) {
      const doc = prepareMobileGradeDocumentCanvas(result.warped, result.alignment);
      return finish(doc, result.alignment, true);
    }
  }

  if (isCalifacilExamSheetLikely(base, columns)) {
    const corner = warpCalifacilSheetFromCornerMarkers(base);
    if (corner && countCalifacilCornerMarkers(corner) >= 3) {
      const alignment = measureWarpedFiducialAlignment(corner, maxErrorPx);
      const doc = prepareMobileGradeDocumentCanvas(corner, alignment);
      return finish(doc, alignment, true);
    }
    return finish(base, null, false);
  }

  const oriented = autoOrientCalifacilSheet(base, columns, {
    useGuideCrop: false,
    allowTiltSweep: true,
  });
  if (oriented && isCalifacilExamSheetLikely(oriented, columns)) {
    return finish(oriented, null, true);
  }

  return finish(base, null, false);
}

export type CalifacilGradeScanCanvases = {
  /** Carta warpeada (cabecera + nombre + tabla) para preview, crop de nombre y bolitas. */
  displayCanvas: HTMLCanvasElement;
  /** Canvas de lectura OMR (referencia 30×4 si aplica). */
  scanCanvas: HTMLCanvasElement;
};

type PrepareGradeScanOpts = {
  preWarped?: boolean;
  warpAlignment?: WarpAlignmentReport | null;
  /**
   * Solo preview/debug: crop impresión sin alineación a referencia 30×4.
   */
  skipReferenceAlign?: boolean;
};

/**
 * Separa presentación (carta) vs lectura (referencia).
 * El UI nunca debe usar scanCanvas para nombre/bolitas: ratios carta ≠ referencia.
 */
export function prepareCalifacilGradeScanCanvases(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  opts?: PrepareGradeScanOpts
): CalifacilGradeScanCanvases {
  const displayCanvas =
    opts?.preWarped || opts?.skipReferenceAlign
      ? prepareMobileScannedDocumentCanvasFast(canvas, { skipPrintCrop: false }) ?? canvas
      : canvas;
  if (opts?.skipReferenceAlign) {
    return { displayCanvas, scanCanvas: displayCanvas };
  }
  const scanCanvas = prepareReferenceGradeCanvas(displayCanvas, columns, rowCount);
  return { displayCanvas, scanCanvas };
}

/**
 * Prepara cualquier captura (cámara, galería, PDF, escaneo) al mismo espacio de referencia
 * antes de leer burbujas OMR.
 *
 * Móvil preWarped: carta 850×1100 refinada + recorte a marco de impresión (sin crop a bbox
 * de bolitas: así todas las capturas quedan orientadas igual, 4 esquinas fijas).
 * Preferir `prepareCalifacilGradeScanCanvases` cuando también se necesita el canvas carta.
 */
export function prepareCalifacilGradeScanCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  opts?: PrepareGradeScanOpts
): HTMLCanvasElement {
  return prepareCalifacilGradeScanCanvases(canvas, columns, rowCount, opts).scanCanvas;
}

/**
 * True si la hoja warpeada tiene esquinas/fiduciales suficientes para calificar
 * con orientación carta estable.
 */
export function isMobileLetterGradeCanvasReady(canvas: HTMLCanvasElement): boolean {
  if (!isCalifacilWarpedLetterCanvas(canvas)) return false;
  return isMobileWarpedAnswerSheetAcceptable(canvas);
}
