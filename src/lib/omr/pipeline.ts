import { preprocessForSheetDetection } from '@/lib/omr/preprocess';
import { prepareReferenceGradeCanvas } from '@/lib/omr/reference-grade';
import type { WarpAlignmentReport } from '@/lib/omrScan';
import {
  MAX_WARP_ALIGNMENT_ERROR_PX,
  CALIFACIL_WARP_LETTER_HEIGHT,
  autoOrientCalifacilSheet,
  captureImageFullFrame,
  countCalifacilCornerMarkers,
  detectAnswerSheetQuadViaAlignStrips,
  detectCalifacilSheetCornerQuadRobust,
  detectCalifacilQuadFromCornerMarkers,
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
  warpCalifacilSheetFromQuad,
  califacilWarpLetterPixelSize,
  scaleCanvasToExactSize,
  measureRoiSheetFillRatio,
  type MobileGuideRoiCapture,
  type Point,
} from '@/lib/omrScan';
import {
  canvasMatchesReferenceGrade,
  canvasNearReferenceGrade,
} from '@/lib/omr/reference-grade-merge';

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

export function isReferenceGradeLetterCanvas(canvas: HTMLCanvasElement): boolean {
  return (
    canvasMatchesReferenceGrade(canvas.width, canvas.height) ||
    canvasNearReferenceGrade(canvas.width, canvas.height)
  );
}

export type MobileWarpPipelineResult = {
  warped: HTMLCanvasElement | null;
  alignment: WarpAlignmentReport | null;
  /** Origen del cuadrilátero ganador (diagnóstico). */
  source: 'roi' | 'full_res' | 'corner_markers' | 'strips' | 'none';
};

/** Carta lista para OMR: fiduciales en sitio, o 3–4 cuadritos + franjas. El tamaño solo no basta. */
export function isCanonicalGradeCanvasReady(
  canvas: HTMLCanvasElement,
  alignment: WarpAlignmentReport | null
): boolean {
  if (alignment?.ok) return true;
  if (isMobileWarpedAnswerSheetAcceptable(canvas)) return true;
  return (
    isCalifacilWarpedLetterCanvas(canvas) &&
    hasCalifacilAlignStrips(canvas) &&
    countCalifacilCornerMarkers(canvas) >= 3
  );
}

/**
 * Cualquier origen (PNG, JPG, cámara, PDF raster) → 4 cuadritos negros → canvas de referencia.
 * No califica la foto cruda. Solo omite warp si los fiduciales ya están en las posiciones impresas.
 */
export function prepareCanonicalCalifacilLetterCanvas(
  source: HTMLCanvasElement,
  opts?: {
    frameQuad?: RoiQuad | null;
    maxErrorPx?: number;
    fast?: boolean;
  }
): { canvas: HTMLCanvasElement; alignment: WarpAlignmentReport } | null {
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;
  const fast = opts?.fast !== false;
  const expected = califacilWarpLetterPixelSize();
  const finishCanonical = (
    canvas: HTMLCanvasElement,
    alignment: WarpAlignmentReport
  ): { canvas: HTMLCanvasElement; alignment: WarpAlignmentReport } | null => {
    const sized =
      canvas.width === expected.width && canvas.height === expected.height
        ? canvas
        : isReferenceGradeLetterCanvas(canvas)
          ? canvas
          : scaleCanvasToExactSize(canvas, expected.width, expected.height);
    const aligned =
      sized === canvas ? alignment : measureWarpedFiducialAlignment(sized, maxErrorPx);
    const letterSized =
      isReferenceGradeLetterCanvas(sized) ||
      (sized.width === expected.width && sized.height === expected.height);
    if (!letterSized) return null;
    if (!isCanonicalGradeCanvasReady(sized, aligned)) return null;
    return { canvas: sized, alignment: aligned };
  };

  const base =
    Math.max(source.width, source.height) < 1400
      ? scaleCanvasToMaxSide(source, expected.height)
      : source;

  // Presupuesto relativo: raster PDF ~1127×1600 puede estar a ~15 px; una foto torcida, a cientos.
  const parkedBudget = Math.max(
    maxErrorPx,
    Math.round(Math.min(base.width, base.height) * 0.02)
  );
  const parked = measureWarpedFiducialAlignment(base, parkedBudget);
  if (parked.ok) {
    return finishCanonical(base, parked);
  }

  const warpSrc = opts?.frameQuad ? source : base;
  let quad: RoiQuad | null = detectCalifacilQuadFromCornerMarkers(warpSrc);
  if (!quad && opts?.frameQuad && countCalifacilCornerMarkers(warpSrc) >= 3) {
    quad = opts.frameQuad;
  }
  if (!quad) {
    const strips = detectAnswerSheetQuadViaAlignStrips(warpSrc);
    if (strips && countCalifacilCornerMarkers(warpSrc) >= 3) {
      quad = strips;
    }
  }
  if (!quad) return null;

  // PDF/escáner plano: la hoja YA es la página (cuadritos en las esquinas, poco sesgo).
  // Warpear a 1230×1600 inventa homografía y tira el golden a 15/30.
  // Foto con mesa/fondo: el quad no llena la página → sí warpear.
  const fill = measureRoiSheetFillRatio(quad, warpSrc.width, warpSrc.height);
  const skewPx = Math.max(
    Math.abs(quad[0].y - quad[1].y),
    Math.abs(quad[3].y - quad[2].y),
    Math.abs(quad[0].x - quad[3].x),
    Math.abs(quad[1].x - quad[2].x)
  );
  const skewOk = skewPx <= Math.max(14, Math.min(warpSrc.width, warpSrc.height) * 0.02);
  if (fill >= 0.82 && skewOk && isReferenceGradeLetterCanvas(warpSrc)) {
    return { canvas: warpSrc, alignment: parked };
  }

  const result = warpAndValidateCalifacilSheet(warpSrc, quad, maxErrorPx, { fast });
  if (!result.warped) return null;
  const alignment = result.alignment ?? measureWarpedFiducialAlignment(result.warped, maxErrorPx);
  return finishCanonical(result.warped, alignment);
}

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

  const canonical = prepareCanonicalCalifacilLetterCanvas(fullCanvas, {
    frameQuad: opts?.frameQuad,
    maxErrorPx,
    fast: true,
  });
  if (canonical) {
    return {
      warped: canonical.canvas,
      alignment: canonical.alignment,
      source: opts?.frameQuad ? 'full_res' : 'corner_markers',
    };
  }

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
  const aspect = canvas.width / Math.max(1, canvas.height);
  if (!(aspect > 0.62 && aspect < 0.92)) return false;
  if (!hasCalifacilAlignStrips(canvas)) {
    return isCalifacilExamSheetLikely(canvas, columns);
  }
  const stripQuad = detectAnswerSheetQuadViaAlignStrips(canvas);
  if (stripQuad) {
    const fill = measureRoiSheetFillRatio(stripQuad, canvas.width, canvas.height);
    if (fill < 0.45) return false;
  }
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
    const letterLike =
      Math.abs(canvas.width / Math.max(1, canvas.height) - 8.5 / 11) < 0.04 &&
      canvas.height >= CALIFACIL_WARP_LETTER_HEIGHT * 0.9;
    const display = letterLike ? canvas : scaleCanvasToMaxSide(canvas, maxSide);
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
  void opts?.uploadClass;
  void opts?.flatDocument;
  void opts?.rowCount;

  const canonical = prepareCanonicalCalifacilLetterCanvas(base, { maxErrorPx, fast: true });
  if (canonical) {
    return finishOk(canonical.canvas, canonical.alignment, true);
  }

  const oriented =
    autoOrientCalifacilSheet(base, columns, {
      useGuideCrop: false,
      allowTiltSweep: false,
    }) ?? base;
  if (oriented !== base) {
    const orientedCanonical = prepareCanonicalCalifacilLetterCanvas(oriented, {
      maxErrorPx,
      fast: true,
    });
    if (orientedCanonical) {
      return finishOk(orientedCanonical.canvas, orientedCanonical.alignment, true);
    }
  }

  const fastWarp = warpCalifacilMobileCaptureFast(base, { maxErrorPx });
  if (fastWarp.warped) {
    const ok = tryPhotoDoc(fastWarp.warped, fastWarp.alignment, true);
    if (ok) return ok;
  }

  const fullWarp = warpCalifacilMobileCapture(base, { maxErrorPx });
  if (fullWarp.warped) {
    const ok = tryPhotoDoc(fullWarp.warped, fullWarp.alignment, true);
    if (ok) return ok;
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
