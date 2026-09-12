import { preprocessForSheetDetection } from '@/lib/omr/preprocess';
import { prepareReferenceGradeCanvas } from '@/lib/omr/reference-grade';
import {
  cropCanvasToPrintedBubbleTable,
  detectCircleGridGeometry,
} from '@/lib/omr/engine/detect-circles-grid';
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
  measureRoiSheetFillRatio,
  type MobileGuideRoiCapture,
  type Point,
} from '@/lib/omrScan';

/** Misma resolución que el PDF rasterizado en calificar (referencia visual + OMR). */
export const CALIFACIL_GRADE_DOCUMENT_MAX_SIDE = 1600;

export type NormalizeGradeDocumentResult = {
  /** Canvas de lectura OMR (puede estar alineado a referencia 30×4). null si foto sin hoja. */
  canvas: HTMLCanvasElement | null;
  /** Hoja carta sola para preview/UI (sin mesa). Si falta, usar `canvas`. */
  displayCanvas: HTMLCanvasElement | null;
  alignment: WarpAlignmentReport | null;
  /** true si se enderezó o reorientó respecto al original */
  normalized: boolean;
  /** false solo en fotos sin warp aceptable (no degradar a mesa completa). */
  sheetDetected: boolean;
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
    /**
     * Tras recorte al marco naranja: aceptar carta + franjas aunque falte 1 fiducial
     * (márgenes del guía / brillo).
     */
    softAccept?: boolean;
  }
): MobileWarpPipelineResult {
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;
  const fallbackMaxErrorPx = maxErrorPx + 8;
  const softAccept = opts?.softAccept === true;

  const isAcceptable = (warped: HTMLCanvasElement): boolean => {
    if (isMobileWarpedAnswerSheetAcceptable(warped)) return true;
    if (!softAccept) return false;
    if (!isCalifacilWarpedLetterCanvas(warped)) return false;
    if (hasCalifacilAlignStrips(warped)) return true;
    return countCalifacilCornerMarkers(warped) >= 2;
  };

  const tryAccept = (
    warped: HTMLCanvasElement | null,
    alignment: WarpAlignmentReport | null,
    source: MobileWarpPipelineResult['source']
  ): MobileWarpPipelineResult | null => {
    if (!warped || !isAcceptable(warped)) return null;
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

/**
 * Warp de foto aceptable: Acceptable (3–4 esquinas) gana sin veto de fill.
 * Fill solo como soft-check cuando no es Acceptable (evita mesa a aspect carta).
 * Exportado para que móvil califique solo con la misma barra que desktop foto.
 */
export function isPhotoSheetWarpAcceptable(canvas: HTMLCanvasElement): boolean {
  if (isMobileWarpedAnswerSheetAcceptable(canvas)) return true;
  const softCorners =
    isCalifacilWarpedLetterCanvas(canvas) &&
    hasCalifacilAlignStrips(canvas) &&
    countCalifacilCornerMarkers(canvas) >= 3;
  if (!softCorners) return false;
  const stripQuad = detectAnswerSheetQuadViaAlignStrips(canvas);
  if (stripQuad) {
    return measureRoiSheetFillRatio(stripQuad, canvas.width, canvas.height) >= 0.62;
  }
  return countCalifacilCornerMarkers(canvas) >= 4;
}

/**
 * Escaneo/PDF plano: la hoja llena el marco (sin mesa).
 * Escaneos 3:4 (aspect letter) sí pueden ser flat si strips + fill alto.
 */
function isLikelyFlatCalifacilDocument(
  canvas: HTMLCanvasElement,
  columns: number,
  opts?: { flatDocument?: boolean }
): boolean {
  if (opts?.flatDocument) return true;
  if (!isCalifacilExamSheetLikely(canvas, columns)) return false;
  if (!hasCalifacilAlignStrips(canvas)) return false;
  const aspect = canvas.width / Math.max(1, canvas.height);
  if (!(aspect > 0.62 && aspect < 0.92)) return false;

  const stripQuad = detectAnswerSheetQuadViaAlignStrips(canvas);
  if (stripQuad) {
    const fill = measureRoiSheetFillRatio(stripQuad, canvas.width, canvas.height);
    // Cabecera + márgenes de escáner: la tabla no llena toda la página.
    if (fill < 0.45) return false;
    return true;
  }
  // A4/carta con franjas y rejilla, aunque el quad de franjas no cierre.
  return true;
}

/** Clasifica subidas desktop para enrutar normalización y escaneo OMR. */
export function classifyDesktopUploadCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  opts?: { isServerRenderedPdfPage?: boolean; preWarped?: boolean }
): DesktopUploadClass {
  if (opts?.isServerRenderedPdfPage) return 'pdf';
  // NUNCA usar solo aspect ratio carta (isCalifacilWarpedLetterCanvas):
  // una foto 3:4 con mesa se clasificaba como warpedPhoto y se saltaba el warp real.
  if (
    opts?.preWarped ||
    isMobileWarpedAnswerSheetReady(canvas) ||
    isMobileWarpedAnswerSheetAcceptable(canvas)
  ) {
    return 'warpedPhoto';
  }
  if (isLikelyFlatCalifacilDocument(canvas, columns)) return 'flatScan';
  return 'photoCrop';
}

/**
 * Endereza y escala cualquier captura al mismo formato que un PDF de hoja CaliFacil
 * (carta, ~1600 px de lado mayor, fiduciales alineados) para lectura OMR uniforme.
 * Fotos: si no hay hoja sola warpeada → sheetDetected false (no devolver mesa).
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

  const finishOk = (
    canvas: HTMLCanvasElement,
    alignment: WarpAlignmentReport | null,
    normalized: boolean
  ): NormalizeGradeDocumentResult => {
    const display = scaleCanvasToMaxSide(canvas, maxSide);
    // Un solo canvas carta (sin prepareReferenceGrade): preview = OMR = overlay.
    return {
      canvas: display,
      displayCanvas: display,
      alignment,
      normalized,
      sheetDetected: true,
    };
  };

  const finishFail = (): NormalizeGradeDocumentResult => ({
    canvas: null,
    displayCanvas: null,
    alignment: null,
    normalized: false,
    sheetDetected: false,
  });

  const tryPhotoDoc = (
    warped: HTMLCanvasElement,
    alignment: WarpAlignmentReport | null,
    normalized: boolean
  ): NormalizeGradeDocumentResult | null => {
    const doc = prepareMobileGradeDocumentCanvas(warped, alignment, { fast: true });
    if (isPhotoSheetWarpAcceptable(doc)) {
      return finishOk(doc, alignment ?? measureWarpedFiducialAlignment(doc, maxErrorPx), normalized);
    }
    if (isPhotoSheetWarpAcceptable(warped)) {
      const cropped =
        prepareMobileScannedDocumentCanvasFast(warped, { skipPrintCrop: false }) ?? warped;
      // Exigir Acceptable o soft fill; no aceptar solo por aspect carta.
      if (isPhotoSheetWarpAcceptable(cropped)) {
        return finishOk(
          cropped,
          alignment ?? measureWarpedFiducialAlignment(cropped, maxErrorPx),
          normalized
        );
      }
    }
    return null;
  };

  const base = captureImageFullFrame(source, { maxSide: Math.max(maxSide, 2400) }) ?? source;
  const uploadClass =
    opts?.uploadClass ?? classifyDesktopUploadCanvas(base, columns);
  const rowCount = Math.max(2, Math.min(30, Math.round(opts?.rowCount ?? 30)));
  const useFlatPath =
    uploadClass === 'pdf' ||
    uploadClass === 'flatScan' ||
    (opts?.flatDocument === true &&
      isLikelyFlatCalifacilDocument(base, columns, { flatDocument: true }));

  const tryPrintedTableAsFlat = (
    canvas: HTMLCanvasElement
  ): NormalizeGradeDocumentResult | null => {
    const tableCrop = cropCanvasToPrintedBubbleTable(canvas);
    const grid = detectCircleGridGeometry(tableCrop, columns, rowCount);
    if (grid && grid.bubbleFit >= 0.5) {
      return finishOk(tableCrop, null, tableCrop !== canvas);
    }
    return null;
  };

  // PDF / escaneo plano: no auto-orientar ni warpear (congela la UI y tuerce la hoja).
  if (useFlatPath) {
    if (uploadClass === 'flatScan' || uploadClass === 'pdf') {
      return finishOk(base, null, Math.max(base.width, base.height) > maxSide * 1.08);
    }

    // flatDocument sin clasificar como PDF/escaneo: orientar y warpear si hace falta.
    const oriented =
      autoOrientCalifacilSheet(base, columns, {
        useGuideCrop: false,
        allowTiltSweep: true,
      }) ?? base;

    const stripQuadOriented = detectAnswerSheetQuadViaAlignStrips(oriented);
    const fillOriented = stripQuadOriented
      ? measureRoiSheetFillRatio(stripQuadOriented, oriented.width, oriented.height)
      : 0;
    const cornersOriented = countCalifacilCornerMarkers(oriented);
    const stripsOriented = hasCalifacilAlignStrips(oriented);
    const dubiousFlat =
      cornersOriented < 3 ||
      !stripsOriented ||
      fillOriented < 0.72 ||
      !isLikelyFlatCalifacilDocument(oriented, columns);

    if (dubiousFlat || !isPhotoSheetWarpAcceptable(oriented)) {
      const fastWarp = warpCalifacilMobileCaptureFast(oriented, { maxErrorPx });
      if (fastWarp.warped) {
        const ok = tryPhotoDoc(fastWarp.warped, fastWarp.alignment, true);
        if (ok) return ok;
      }
      const fullWarp = warpCalifacilMobileCapture(oriented, { maxErrorPx });
      if (fullWarp.warped) {
        const ok = tryPhotoDoc(fullWarp.warped, fullWarp.alignment, true);
        if (ok) return ok;
      }
      if (isPhotoSheetWarpAcceptable(oriented) || isLikelyFlatCalifacilDocument(oriented, columns)) {
        return finishOk(oriented, null, oriented !== base);
      }
      return finishFail();
    }
    return finishOk(oriented, null, oriented !== base);
  }

  // Foto / recorte de tabla (móvil): si hay rejilla de bolitas, no warpear a carta.
  if (uploadClass === 'photoCrop') {
    const tableFlat = tryPrintedTableAsFlat(base);
    if (tableFlat) return tableFlat;
  }
  if (
    hasCalifacilAlignStrips(base) &&
    isCalifacilExamSheetLikely(base, columns) &&
    isCalifacilWarpedLetterCanvas(base)
  ) {
    return finishOk(base, null, Math.max(base.width, base.height) > maxSide * 1.08);
  }

  if (isPhotoSheetWarpAcceptable(base)) {
    const ok = tryPhotoDoc(base, null, Math.max(base.width, base.height) > maxSide * 1.08);
    if (ok) return ok;
  }

  const fastWarp = warpCalifacilMobileCaptureFast(base, { maxErrorPx });
  if (fastWarp.warped) {
    const ok = tryPhotoDoc(fastWarp.warped, fastWarp.alignment, true);
    if (ok) return ok;
  }

  // Fallback más completo antes de rechazar (fotos con perspectiva/luz media).
  const fullWarp = warpCalifacilMobileCapture(base, { maxErrorPx });
  if (fullWarp.warped) {
    const ok = tryPhotoDoc(fullWarp.warped, fullWarp.alignment, true);
    if (ok) return ok;
  }

  const corner = warpCalifacilSheetFromCornerMarkers(base);
  if (corner) {
    const refined = refineWarpedCalifacilSheet(corner, { fast: true });
    const alignment = measureWarpedFiducialAlignment(refined.canvas, maxErrorPx);
    const ok = tryPhotoDoc(refined.canvas, alignment, true);
    if (ok) return ok;
  }

  const oriented = autoOrientCalifacilSheet(base, columns, {
    useGuideCrop: false,
    allowTiltSweep: false,
  });
  if (oriented && oriented !== base) {
    if (isPhotoSheetWarpAcceptable(oriented)) {
      const ok = tryPhotoDoc(oriented, null, true);
      if (ok) return ok;
    }
    const orientedWarp = warpCalifacilMobileCaptureFast(oriented, { maxErrorPx });
    if (orientedWarp.warped) {
      const ok = tryPhotoDoc(orientedWarp.warped, orientedWarp.alignment, true);
      if (ok) return ok;
    }
    const orientedFull = warpCalifacilMobileCapture(oriented, { maxErrorPx });
    if (orientedFull.warped) {
      const ok = tryPhotoDoc(orientedFull.warped, orientedFull.alignment, true);
      if (ok) return ok;
    }
    const orientedCorner = warpCalifacilSheetFromCornerMarkers(oriented);
    if (orientedCorner) {
      const refined = refineWarpedCalifacilSheet(orientedCorner, { fast: true });
      const alignment = measureWarpedFiducialAlignment(refined.canvas, maxErrorPx);
      const ok = tryPhotoDoc(refined.canvas, alignment, true);
      if (ok) return ok;
    }
  }
  return finishFail();
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
  /** Móvil: conservar carta completa 850×1100 (sin crop a franjas). */
  skipPrintCrop?: boolean;
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
      ? prepareMobileScannedDocumentCanvasFast(canvas, {
          skipPrintCrop: opts?.skipPrintCrop ?? false,
        }) ?? canvas
      : canvas;
  // Carta móvil / unificado: scan === display (sin canvas de referencia aparte).
  if (opts?.skipReferenceAlign || opts?.skipPrintCrop) {
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
