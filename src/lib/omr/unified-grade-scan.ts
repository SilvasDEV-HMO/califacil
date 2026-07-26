import {
  scanCalifacilDesktopGradeDocument,
  scanCalifacilDesktopGradeDocumentAsync,
  scanWarpedGradeDocument,
  scanWarpedGradeDocumentAsync,
  scanCalifacilOmrSheetWithMeta,
  syncCalifacilOmrGeometryImageSize,
  attachAnswerSheetReviewBubbleOverlay,
  sanitizeAnswerSheetOmrMeta,
  downscaleCanvasForOmrScan,
  isAnswerSheetOmrMostlyBlank,
  buildLetterDisplayOverlayGeometry,
  type CalifacilOmrScanGeometry,
  type CalifacilScanOptions,
  type OmrScanMetaResult,
} from '@/lib/omrScan';
import {
  isUnifiedOmrEngineEnabled,
  runUnifiedOmrPipeline,
  unifiedResultToMeta,
  runStripFallbackFast,
} from '@/lib/omr/engine';
import {
  buildDesktopDisplayOverlayGeometry,
  isReferenceGradeCanvasAnchor,
  isReferenceGradeExam,
} from '@/lib/omr/reference-grade';

const OMR_GRADE_SCAN_MAX_SIDE = 1100;
const OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE = 1600;

/** Presupuesto móvil / desktop fast: ~70 iters. */
const MOBILE_FAST_OPTIMIZE_ITERS = 70;
const MOBILE_FAST_STAGNANT = 10;

function gradeScanCanvas(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  return downscaleCanvasForOmrScan(canvas, maxSide) ?? canvas;
}

function countResolvedPicks(meta: OmrScanMetaResult, rows: number): number {
  return meta.picks.slice(0, rows).filter((p) => p != null).length;
}

/**
 * Lectura débil: pocos picks, blank falso o sesgo de columna.
 * `activeRows` = preguntas reales (ignora filler de plantilla 30).
 */
export function isWeakMobileOmrMeta(
  meta: OmrScanMetaResult,
  rows: number,
  activeRows: number = rows
): boolean {
  const scored = Math.max(1, Math.min(rows, activeRows));
  const resolved = countResolvedPicks(meta, scored);
  if (isAnswerSheetOmrMostlyBlank(meta, scored)) return true;
  if (resolved < Math.ceil(scored * 0.4)) return true;
  if (meta.maxSameColumnCount > Math.max(4, Math.round(scored * 0.4))) return true;
  return false;
}

/**
 * Lectura suficientemente buena (señal UI). Ya no bloquea re-pipeline móvil:
 * tras scanWarpedGradeMobileAsync siempre se usa readingOverride.
 */
export function isStrongMobileOmrMeta(
  meta: OmrScanMetaResult,
  rows: number,
  activeRows: number = rows
): boolean {
  return !isWeakMobileOmrMeta(meta, rows, activeRows);
}

/** Fast path suficiente para no lanzar segundo pase pesado en desktop. */
function isDesktopFastPassEnough(
  meta: OmrScanMetaResult,
  rows: number,
  displayCanvas: HTMLCanvasElement,
  columns: number
): boolean {
  if (isAnswerSheetOmrMostlyBlank(meta, rows)) return true;
  const resolved = countResolvedPicks(meta, rows);
  if (resolved === 0) return true;
  // Foto/PDF: con ≥40% lecturas basta el pase rápido (evita «Leyendo…» eterno).
  if (resolved >= Math.ceil(rows * 0.4)) return true;
  if (isReferenceGradeExam(rows, columns) && isReferenceGradeCanvasAnchor(displayCanvas.width, displayCanvas.height)) {
    if (resolved >= Math.ceil(rows * 0.55)) return true;
  }
  return isStrongMobileOmrMeta(meta, rows);
}

function finalizeUnifiedDisplayMeta(
  displayCanvas: HTMLCanvasElement,
  meta: OmrScanMetaResult,
  rows: number,
  columns: number,
  opts?: { skipBubbleReattach?: boolean }
): OmrScanMetaResult {
  // Desktop 30×4 near/exact ref: overlay desde calibración (no plantilla carta).
  if (
    isReferenceGradeExam(rows, columns) &&
    isReferenceGradeCanvasAnchor(displayCanvas.width, displayCanvas.height)
  ) {
    const desktopGeom = buildDesktopDisplayOverlayGeometry(displayCanvas, columns, rows);
    if (desktopGeom) {
      return {
        ...meta,
        geometry: syncCalifacilOmrGeometryImageSize(
          desktopGeom,
          displayCanvas.width,
          displayCanvas.height
        ),
        reviewSourceCanvas: displayCanvas,
      };
    }
  }

  const geometry = meta.geometry
    ? syncCalifacilOmrGeometryImageSize(
        meta.geometry,
        displayCanvas.width,
        displayCanvas.height
      )
    : null;
  const hasSaneEngineBubbles =
    !!geometry?.bubbles &&
    geometry.bubbles.length >= rows &&
    geometry.bubbles.some((row) =>
      row?.some((b) => Number.isFinite(b.r) && b.r > 0.002 && b.r < 0.06)
    );

  if (opts?.skipBubbleReattach && hasSaneEngineBubbles) {
    return {
      ...meta,
      geometry,
      reviewSourceCanvas: displayCanvas,
    };
  }

  const withOverlay = attachAnswerSheetReviewBubbleOverlay(
    displayCanvas,
    { ...meta, geometry },
    columns,
    rows
  );
  return {
    ...withOverlay,
    geometry: withOverlay.geometry,
    reviewSourceCanvas: displayCanvas,
  };
}

/**
 * Elige entre pase unified y strip recovery.
 * Si un pase es blank y el otro tiene muchos picks/tinta fuerte, preferir el no-blank
 * (hojas llenas con geometría mediocre). Si ambos son sparse/débiles, preferir blank
 * para no inventar 1/30 en hoja vacía.
 */
export function pickBetterOmrMeta(
  a: OmrScanMetaResult,
  b: OmrScanMetaResult,
  rows: number
): OmrScanMetaResult {
  const blankA = isAnswerSheetOmrMostlyBlank(a, rows);
  const blankB = isAnswerSheetOmrMostlyBlank(b, rows);
  if (blankA !== blankB) {
    const nonBlank = blankA ? b : a;
    const resolved = countResolvedPicks(nonBlank, rows);
    const strongFilled = resolved >= Math.ceil(rows * 0.4);
    if (strongFilled) return nonBlank;
    return blankA ? a : b;
  }

  const ra = countResolvedPicks(a, rows);
  const rb = countResolvedPicks(b, rows);
  if (rb !== ra) return rb > ra ? b : a;
  if (b.maxSameColumnCount !== a.maxSameColumnCount) {
    return b.maxSameColumnCount < a.maxSameColumnCount ? b : a;
  }
  return a;
}

/**
 * Preview móvil: siempre carta (`displayCanvas`) + geometría letter para bolitas/nombre.
 * La lectura OMR sigue en `scanCanvas`; no pintar UI sobre ancla de referencia por tamaño.
 */
export function resolveMobileGradeDisplay(
  displayCanvas: HTMLCanvasElement,
  _scanCanvas: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  meta?: OmrScanMetaResult | null
): { previewCanvas: HTMLCanvasElement; geometry: CalifacilOmrScanGeometry } {
  const fromMeta =
    meta?.geometry?.bubbles && meta.geometry.bubbles.length >= Math.min(30, rowCount)
      ? syncCalifacilOmrGeometryImageSize(
          meta.geometry,
          displayCanvas.width,
          displayCanvas.height
        )
      : null;
  return {
    previewCanvas: displayCanvas,
    geometry:
      fromMeta ?? buildLetterDisplayOverlayGeometry(displayCanvas, columns, rowCount),
  };
}

export function scanDesktopGradeUnifiedOrLegacy(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): OmrScanMetaResult {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const fast = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: true,
      maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
      stagnantLimit: MOBILE_FAST_STAGNANT,
    });
    let meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(fast), rows, columns);
    meta = sanitizeAnswerSheetOmrMeta(meta, rows);
    if (isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      return meta;
    }
    // Recovery barato: strip fast (nunca fastMode:false → tiers desktop eternos).
    const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
    let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns);
    stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
    return pickBetterOmrMeta(meta, stripMeta, rows);
  }
  return scanCalifacilDesktopGradeDocument(displayCanvas, columns, rows);
}

export async function scanDesktopGradeUnifiedOrLegacyAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): Promise<OmrScanMetaResult> {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE);
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

  if (isUnifiedOmrEngineEnabled()) {
    const fast = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: true,
      maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
      stagnantLimit: MOBILE_FAST_STAGNANT,
    });
    let meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(fast), rows, columns);
    meta = sanitizeAnswerSheetOmrMeta(meta, rows);
    if (isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      return meta;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // Nunca fastMode:false aquí: dispara runDesktopGradeScanTiers y congela «Leyendo…».
    const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
    let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns);
    stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
    return pickBetterOmrMeta(meta, stripMeta, rows);
  }
  return scanCalifacilDesktopGradeDocumentAsync(displayCanvas, columns, rows);
}

export function scanWarpedGradeUnifiedOrLegacy(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): OmrScanMetaResult {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_GRADE_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: true,
      maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
      stagnantLimit: MOBILE_FAST_STAGNANT,
    });
    let meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(unified), rows, columns);
    meta = sanitizeAnswerSheetOmrMeta(meta, rows);
    if (isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      return meta;
    }
    const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
    let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns);
    stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
    return pickBetterOmrMeta(meta, stripMeta, rows);
  }
  return scanWarpedGradeDocument(displayCanvas, columns, rows);
}

export async function scanWarpedGradeUnifiedOrLegacyAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): Promise<OmrScanMetaResult> {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_GRADE_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
        return;
      }
      setTimeout(resolve, 0);
    });
    const fast = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: true,
      maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
      stagnantLimit: MOBILE_FAST_STAGNANT,
    });
    let meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(fast), rows, columns);
    meta = sanitizeAnswerSheetOmrMeta(meta, rows);
    if (isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      return meta;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
    let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns);
    stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
    return pickBetterOmrMeta(meta, stripMeta, rows);
  }
  return scanWarpedGradeDocumentAsync(displayCanvas, columns, rows);
}

/**
 * Perfil móvil: ~70 iters + strip fast solo si la lectura es débil.
 * Sin segundo pase de 160/320 iters (evita «Calificando…» eterno).
 * Clave del examen (expectedPicks) se aplica en el popup, no aquí.
 * `activeRows` = preguntas reales cuando la rejilla es plantilla fija 30.
 */
export async function scanWarpedGradeMobileAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number,
  opts?: { activeRows?: number }
): Promise<OmrScanMetaResult> {
  const activeRows = opts?.activeRows ?? rows;
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_GRADE_SCAN_MAX_SIDE);
  if (!isUnifiedOmrEngineEnabled()) {
    return scanWarpedGradeDocumentAsync(displayCanvas, columns, rows);
  }

  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

  const unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
    fastMode: true,
    maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
    stagnantLimit: MOBILE_FAST_STAGNANT,
  });
  let meta = finalizeUnifiedDisplayMeta(
    displayCanvas,
    unifiedResultToMeta(unified),
    rows,
    columns,
    { skipBubbleReattach: true }
  );
  meta = sanitizeAnswerSheetOmrMeta(meta, rows);

  if (!isWeakMobileOmrMeta(meta, rows, activeRows)) {
    return meta;
  }

  // Recovery barato: solo strip live sweeps (sin optimize 160/320).
  const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
  let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns, {
    skipBubbleReattach: true,
  });
  stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
  return pickBetterOmrMeta(meta, stripMeta, activeRows);
}

export function scanLiveOmrUnifiedOrLegacy(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: CalifacilScanOptions
): OmrScanMetaResult {
  if (isUnifiedOmrEngineEnabled() && opts?.preserveInputCanvas && source instanceof HTMLCanvasElement) {
    const rows = opts.rowCount ?? 30;
    const unified = runUnifiedOmrPipeline(source, columns, rows, { fastMode: true });
    return sanitizeAnswerSheetOmrMeta(
      { ...unifiedResultToMeta(unified), reviewSourceCanvas: source },
      rows
    );
  }
  return scanCalifacilOmrSheetWithMeta(source, columns, opts);
}
