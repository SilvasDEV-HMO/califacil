import {
  scanCalifacilDesktopGradeDocument,
  scanCalifacilDesktopGradeDocumentAsync,
  scanWarpedGradeDocument,
  scanWarpedGradeDocumentAsync,
  scanCalifacilOmrSheetWithMeta,
  syncCalifacilOmrGeometryImageSize,
  sanitizeAnswerSheetOmrMeta,
  downscaleCanvasForOmrScan,
  isAnswerSheetOmrMostlyBlank,
  buildLetterDisplayOverlayGeometry,
  rereadOmrPicksOnGeometry,
  scanWarpedWithBestTableFrame,
  scanWarpedWithBestTableFrameAsync,
  hasCalifacilAlignStrips,
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

function hasSaneOverlayBubbles(
  geometry: CalifacilOmrScanGeometry | null | undefined,
  rows: number
): boolean {
  if (!geometry?.bubbles || geometry.bubbles.length < rows) return false;
  return geometry.bubbles.some((row) =>
    row?.some((b) => Number.isFinite(b.r) && b.r > 0.002 && b.r < 0.06)
  );
}

function engineGeometryMatchesDisplay(
  displayCanvas: HTMLCanvasElement,
  meta?: OmrScanMetaResult | null
): boolean {
  const reviewSource = meta?.reviewSourceCanvas;
  const readMatchesDisplay =
    reviewSource == null ||
    (reviewSource instanceof HTMLCanvasElement &&
      Math.abs(reviewSource.width - displayCanvas.width) <= 2 &&
      Math.abs(reviewSource.height - displayCanvas.height) <= 2);
  const engineGeom = meta?.geometry;
  return (
    readMatchesDisplay &&
    Boolean(engineGeom?.cells?.length) &&
    (engineGeom!.imageWidth == null ||
      Math.abs((engineGeom!.imageWidth ?? displayCanvas.width) - displayCanvas.width) <= 2) &&
    (engineGeom!.imageHeight == null ||
      Math.abs((engineGeom!.imageHeight ?? displayCanvas.height) - displayCanvas.height) <= 2)
  );
}

/**
 * Overlay único desktop/móvil: anillos del canvas mostrado (referencia si aplica, si no plantilla carta).
 */
export function buildDisplayOverlayGeometry(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  opts?: { skipSnap?: boolean; maxShiftRatio?: number }
): CalifacilOmrScanGeometry {
  const rows = Math.max(1, rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  if (
    isReferenceGradeExam(rows, cols) &&
    isReferenceGradeCanvasAnchor(canvas.width, canvas.height)
  ) {
    const desktop = buildDesktopDisplayOverlayGeometry(canvas, cols, rows);
    if (desktop) return desktop;
  }
  return buildLetterDisplayOverlayGeometry(canvas, cols, rows, {
    skipSnap: opts?.skipSnap,
    maxShiftRatio: opts?.maxShiftRatio ?? 0.22,
  });
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
  // Colapso a una columna en hoja incompleta = tabla desalineada (no tumba exámenes casi llenos all-A).
  const sameColCap = Math.max(5, Math.round(scored * 0.55));
  if (meta.maxSameColumnCount > sameColCap && resolved < Math.ceil(scored * 0.9)) {
    return true;
  }
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
  if (isWeakMobileOmrMeta(meta, rows, activeRows)) return false;
  const scored = Math.max(1, Math.min(rows, activeRows));
  const resolved = countResolvedPicks(meta, scored);
  // Exigir señal coherente (≥40%) y sin sesgo fuerte de columna.
  return resolved >= Math.ceil(scored * 0.4);
}

/** Fast path suficiente para no lanzar segundo pase pesado en desktop. */
function isDesktopFastPassEnough(
  meta: OmrScanMetaResult,
  rows: number,
  displayCanvas: HTMLCanvasElement,
  columns: number
): boolean {
  // Blank real por tinta: no hace falta recovery.
  if (isAnswerSheetOmrMostlyBlank(meta, rows)) return true;
  const resolved = countResolvedPicks(meta, rows);
  // 0 picks con tinta/ruido no es "enough": hay que intentar strip recovery.
  if (resolved === 0) return false;
  // No conservar inventos medianos: si es débil/sesgado, intentar recovery.
  if (isWeakMobileOmrMeta(meta, rows)) return false;
  // Foto/PDF: con ≥40% lecturas fuertes basta el pase rápido.
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
  const geometry = meta.geometry
    ? syncCalifacilOmrGeometryImageSize(
        meta.geometry,
        displayCanvas.width,
        displayCanvas.height
      )
    : null;

  let kept: OmrScanMetaResult = { ...meta, geometry, reviewSourceCanvas: displayCanvas };
  if (geometry?.cells?.length) {
    const keptReread = rereadOmrPicksOnGeometry(
      displayCanvas,
      geometry,
      columns,
      rows,
      kept
    );
    kept = pickBetterOmrMeta(kept, keptReread, rows);
  }

  if (opts?.skipBubbleReattach) {
    return kept;
  }
  const displayGeom = buildDisplayOverlayGeometry(displayCanvas, columns, rows);
  const withGeom: OmrScanMetaResult = {
    ...meta,
    geometry: syncCalifacilOmrGeometryImageSize(
      displayGeom,
      displayCanvas.width,
      displayCanvas.height
    ),
    reviewSourceCanvas: displayCanvas,
  };
  const overlayReread = rereadOmrPicksOnGeometry(
    displayCanvas,
    withGeom.geometry!,
    columns,
    rows,
    withGeom
  );
  const overlayFinal = pickBetterOmrMeta(withGeom, overlayReread, rows);

  const hasSaneEngineBubbles = hasSaneOverlayBubbles(geometry, rows);
  if (hasSaneEngineBubbles && engineGeometryMatchesDisplay(displayCanvas, meta)) {
    const engineReread = rereadOmrPicksOnGeometry(displayCanvas, geometry!, columns, rows, kept);
    const engineBest = pickBetterOmrMeta(kept, engineReread, rows);
    if (opts?.skipBubbleReattach || !isWeakMobileOmrMeta(engineBest, rows)) {
      return engineBest;
    }
  }

  return pickBetterOmrMeta(kept, overlayFinal, rows);
}

/**
 * Recovery: relee sobre la geometría de overlay que ve el usuario.
 * Aceptar si ≥40% resolved.
 */
export function rereadOmrWithDisplayOverlayGeometry(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  baseMeta?: OmrScanMetaResult | null
): OmrScanMetaResult {
  const rows = Math.max(1, rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const geom = buildDisplayOverlayGeometry(canvas, cols, rows);
  return rereadOmrPicksOnGeometry(canvas, geom, cols, rows, baseMeta);
}

/** True si la meta tiene lectura usable (≥40% resolved, no mostly-blank). */
export function isUsableOmrRecoveryMeta(
  meta: OmrScanMetaResult,
  rows: number
): boolean {
  if (isAnswerSheetOmrMostlyBlank(meta, rows)) return false;
  const resolved = countResolvedPicks(meta, rows);
  return resolved >= Math.ceil(rows * 0.4);
}

/**
 * Elige entre pase unified y strip recovery.
 * Preferir blank solo si el otro pase no tiene tinta fuerte; no preferir “menos picks”
 * cuando el otro tiene mediana de tinta claramente mayor (hoja llena mal alineada).
 */
export function pickBetterOmrMeta(
  a: OmrScanMetaResult,
  b: OmrScanMetaResult,
  rows: number
): OmrScanMetaResult {
  const inkScore = (meta: OmrScanMetaResult): number => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < rows; i++) {
      const row = meta.rows[i];
      if (!row) continue;
      const fracs = row.inkFractions ?? [];
      const maxInk = fracs.length > 0 ? Math.max(...fracs) : 0;
      if (meta.picks[i] != null || maxInk > 0) {
        sum += maxInk;
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  };

  const blankA = isAnswerSheetOmrMostlyBlank(a, rows);
  const blankB = isAnswerSheetOmrMostlyBlank(b, rows);
  if (blankA !== blankB) {
    const nonBlank = blankA ? b : a;
    const blank = blankA ? a : b;
    if (isStrongMobileOmrMeta(nonBlank, rows)) return nonBlank;
    // Tinta fuerte en el no-blank: preferirlo aunque no llegue a “strong” por conteo.
    if (inkScore(nonBlank) >= 0.22) return nonBlank;
    return blank;
  }

  const weakA = isWeakMobileOmrMeta(a, rows);
  const weakB = isWeakMobileOmrMeta(b, rows);
  if (weakA !== weakB) return weakA ? b : a;

  const ra = countResolvedPicks(a, rows);
  const rb = countResolvedPicks(b, rows);
  const ia = inkScore(a);
  const ib = inkScore(b);
  // Ambos débiles: preferir más tinta (lectura real parcial), no menos picks.
  if (weakA && weakB) {
    if (Math.abs(ib - ia) > 0.04) return ib > ia ? b : a;
    if (rb !== ra) return rb > ra ? b : a;
  } else if (rb !== ra) {
    return rb > ra ? b : a;
  }
  if (b.maxSameColumnCount !== a.maxSameColumnCount) {
    return b.maxSameColumnCount < a.maxSameColumnCount ? b : a;
  }
  return a;
}

/**
 * Preview: misma geometría que la lectura cuando coincide el canvas.
 * Si no, overlay unificado (referencia o carta) + snap a anillos.
 */
export function resolveMobileGradeDisplay(
  displayCanvas: HTMLCanvasElement,
  _scanCanvas: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  meta?: OmrScanMetaResult | null
): { previewCanvas: HTMLCanvasElement; geometry: CalifacilOmrScanGeometry } {
  const engineGeom = meta?.geometry;
  if (engineGeometryMatchesDisplay(displayCanvas, meta) && engineGeom) {
    return {
      previewCanvas: displayCanvas,
      geometry: syncCalifacilOmrGeometryImageSize(
        engineGeom,
        displayCanvas.width,
        displayCanvas.height
      ),
    };
  }

  return {
    previewCanvas: displayCanvas,
    geometry: buildDisplayOverlayGeometry(displayCanvas, columns, rowCount),
  };
}

function recoverDesktopTableFrame(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number,
  meta: OmrScanMetaResult
): OmrScanMetaResult {
  const tableRaw = scanWarpedWithBestTableFrame(displayCanvas, columns, rows, { fast: true });
  let tableMeta = finalizeUnifiedDisplayMeta(displayCanvas, tableRaw.meta, rows, columns);
  tableMeta = sanitizeAnswerSheetOmrMeta(tableMeta, rows);
  return pickBetterOmrMeta(meta, tableMeta, rows);
}

async function recoverDesktopTableFrameAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number,
  meta: OmrScanMetaResult
): Promise<OmrScanMetaResult> {
  const tableRaw = await scanWarpedWithBestTableFrameAsync(displayCanvas, columns, rows, {
    fast: true,
  });
  let tableMeta = finalizeUnifiedDisplayMeta(displayCanvas, tableRaw.meta, rows, columns);
  tableMeta = sanitizeAnswerSheetOmrMeta(tableMeta, rows);
  return pickBetterOmrMeta(meta, tableMeta, rows);
}

function scanDesktopFlatDocument(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): OmrScanMetaResult {
  const tableRaw = scanWarpedWithBestTableFrame(displayCanvas, columns, rows, { fast: true });
  let meta = finalizeUnifiedDisplayMeta(displayCanvas, tableRaw.meta, rows, columns, {
    skipBubbleReattach: true,
  });
  return sanitizeAnswerSheetOmrMeta(meta, rows);
}

async function scanDesktopFlatDocumentAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): Promise<OmrScanMetaResult> {
  const tableRaw = await scanWarpedWithBestTableFrameAsync(displayCanvas, columns, rows, {
    fast: true,
  });
  let meta = finalizeUnifiedDisplayMeta(displayCanvas, tableRaw.meta, rows, columns, {
    skipBubbleReattach: true,
  });
  return sanitizeAnswerSheetOmrMeta(meta, rows);
}

export function scanDesktopGradeUnifiedOrLegacy(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number,
  opts?: { tableFrameOnly?: boolean }
): OmrScanMetaResult {
  if (opts?.tableFrameOnly || hasCalifacilAlignStrips(displayCanvas)) {
    const tableMeta = scanDesktopFlatDocument(displayCanvas, columns, rows);
    if (opts?.tableFrameOnly || isDesktopFastPassEnough(tableMeta, rows, displayCanvas, columns)) {
      return tableMeta;
    }
  }
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const fast = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: true,
      maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
      stagnantLimit: MOBILE_FAST_STAGNANT,
    });
    let meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(fast), rows, columns);
    meta = sanitizeAnswerSheetOmrMeta(meta, rows);
    if (!isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
      let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns);
      stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
      meta = pickBetterOmrMeta(meta, stripMeta, rows);
    }
    if (isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      return meta;
    }
    return recoverDesktopTableFrame(displayCanvas, columns, rows, meta);
  }
  return scanCalifacilDesktopGradeDocument(displayCanvas, columns, rows);
}

export async function scanDesktopGradeUnifiedOrLegacyAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number,
  opts?: { tableFrameOnly?: boolean }
): Promise<OmrScanMetaResult> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

  if (opts?.tableFrameOnly || hasCalifacilAlignStrips(displayCanvas)) {
    const tableMeta = await scanDesktopFlatDocumentAsync(displayCanvas, columns, rows);
    if (opts?.tableFrameOnly || isDesktopFastPassEnough(tableMeta, rows, displayCanvas, columns)) {
      return tableMeta;
    }
  }

  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const fast = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: true,
      maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
      stagnantLimit: MOBILE_FAST_STAGNANT,
    });
    let meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(fast), rows, columns);
    meta = sanitizeAnswerSheetOmrMeta(meta, rows);
    if (!isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
      let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns);
      stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
      meta = pickBetterOmrMeta(meta, stripMeta, rows);
    }
    if (isDesktopFastPassEnough(meta, rows, displayCanvas, columns)) {
      return meta;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return recoverDesktopTableFrameAsync(displayCanvas, columns, rows, meta);
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
 * `letterCanvas` = carta warpeada para retry si el canvas de referencia sale débil.
 */
export async function scanWarpedGradeMobileAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number,
  opts?: { activeRows?: number; letterCanvas?: HTMLCanvasElement }
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
  // Sanitizar con preguntas reales (no plantilla 30) para no blankear hojas parciales.
  meta = sanitizeAnswerSheetOmrMeta(meta, activeRows);

  if (!isWeakMobileOmrMeta(meta, rows, activeRows)) {
    return meta;
  }

  // Recovery barato: solo strip live sweeps (sin optimize 160/320).
  const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
  let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns, {
    skipBubbleReattach: true,
  });
  stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, activeRows);
  meta = pickBetterOmrMeta(meta, stripMeta, activeRows);

  // Si sigue débil y hay carta distinta del canvas de lectura, reintentar OMR en carta.
  const letter = opts?.letterCanvas;
  if (
    letter &&
    letter !== displayCanvas &&
    isWeakMobileOmrMeta(meta, rows, activeRows)
  ) {
    const letterScan = gradeScanCanvas(letter, OMR_GRADE_SCAN_MAX_SIDE);
    const letterUnified = runUnifiedOmrPipeline(letterScan, columns, rows, {
      fastMode: true,
      maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
      stagnantLimit: MOBILE_FAST_STAGNANT,
    });
    let letterMeta = finalizeUnifiedDisplayMeta(
      letter,
      unifiedResultToMeta(letterUnified),
      rows,
      columns,
      { skipBubbleReattach: true }
    );
    letterMeta = sanitizeAnswerSheetOmrMeta(letterMeta, activeRows);
    if (isWeakMobileOmrMeta(letterMeta, rows, activeRows)) {
      const letterStrip = runStripFallbackFast(letter, columns, rows);
      let letterStripMeta = finalizeUnifiedDisplayMeta(letter, letterStrip, rows, columns, {
        skipBubbleReattach: true,
      });
      letterStripMeta = sanitizeAnswerSheetOmrMeta(letterStripMeta, activeRows);
      letterMeta = pickBetterOmrMeta(letterMeta, letterStripMeta, activeRows);
    }
    meta = pickBetterOmrMeta(meta, letterMeta, activeRows);
  }

  return meta;
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
