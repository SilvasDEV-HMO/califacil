import { CALIFACIL_VISION_POLICY } from '@/lib/califacilVisionPolicy';
import {
  mapOmrPicksToMcDraftDetailed,
} from '@/lib/calificarGrading';
import {
  autoOrientCalifacilSheet,
  califacilImageToJpegDataUrl,
  isAnswerSheetOmrMostlyBlank,
  prepareCalifacilScanInput,
  scanWarpedMobileCaptureSheetFast,
  type OmrScanMetaResult,
  type WarpAlignmentReport,
} from '@/lib/omrScan';
import {
  scanDesktopGradeUnifiedOrLegacyAsync,
  scanLiveOmrUnifiedOrLegacy,
  scanWarpedGradeMobileAsync,
  scanWarpedGradeUnifiedOrLegacyAsync,
} from '@/lib/omr/unified-grade-scan';
import { prepareCalifacilGradeScanCanvas } from '@/lib/omr/pipeline';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import type { Question } from '@/types';

export const CALIFACIL_MIN_AUTO_READ_RATIO = 0.9;
export const CALIFACIL_AMBIGUOUS_ROW_WARN_RATIO = 0.35;

/** Clasificación explícita de subida en desktop para enrutar el escaneo OMR. */
export type DesktopUploadKind = 'pdf' | 'flatDocument' | 'flatScan' | 'photoCrop' | 'warpedPhoto';

export type CalifacilOmrReadingInput = {
  source: HTMLImageElement | HTMLCanvasElement;
  oriented: HTMLImageElement | HTMLCanvasElement;
  chunk: Question[];
  examId: string;
  omrCols: number;
  omrRowCount: number;
  chunkQuestionOffset: number;
  preWarped: boolean;
  isMobileCamera: boolean;
  isMobile: boolean;
  fallbackFile?: File;
  /** Solo desktop: PDF, imagen plana o foto enderezada con warp. */
  uploadKind?: DesktopUploadKind;
  /** PDF y documentos planos no usan visión asistida. */
  disableVisionAssist?: boolean;
  skipReviewUi?: boolean;
  sheetStrict: boolean;
  preserveCapturedFrame: boolean;
  includeWarpAlignment?: boolean;
  warpAlignment?: WarpAlignmentReport | null;
  liveLockedAnswers: Record<string, string>;
};

export type CalifacilOmrReadingResult = {
  meta: OmrScanMetaResult;
  raw: (number | null)[];
  mapped: ReturnType<typeof mapOmrPicksToMcDraftDetailed> & {
    draft: Record<string, string>;
    unresolvedCount: number;
    resolvedCount: number;
  };
  mergedDraft: Record<string, string>;
  mergedResolved: number;
  picksInChunk: (number | null)[];
  activeScanSource: HTMLImageElement | HTMLCanvasElement;
  warpAlignment: WarpAlignmentReport | null;
  mostlyBlank: boolean;
  minResolved: number;
  ambiguousIdx: number[];
  insufficientForReview: boolean;
  updatedLiveLocks: Record<string, string>;
};

function collectDesktopVisionRowIndices(
  meta: OmrScanMetaResult,
  chunkLen: number
): number[] {
  const indices: number[] = [];
  const colA = meta.picks.filter((p) => p === 0).length;
  const suspiciousA = colA >= 6;
  const sameCol = (meta.maxSameColumnCount ?? 0) >= 8;

  for (let i = 0; i < chunkLen; i++) {
    const row = meta.rows[i];
    const pick = meta.picks[i] ?? null;
    if (!row || pick === null || row.ambiguous) {
      indices.push(i);
      continue;
    }
    if (suspiciousA && pick === 0) indices.push(i);
  }

  if (sameCol && !indices.length) {
    for (let i = 0; i < chunkLen; i++) indices.push(i);
  }

  const resolved = meta.picks.filter((p) => p !== null).length;
  if (resolved < chunkLen) {
    for (let i = 0; i < chunkLen; i++) {
      if (meta.picks[i] === null && !indices.includes(i)) indices.push(i);
    }
  }

  return Array.from(new Set(indices)).sort((a, b) => a - b);
}

function desktopUploadSkipsVision(uploadKind?: DesktopUploadKind): boolean {
  return (
    uploadKind === 'pdf' ||
    uploadKind === 'flatDocument' ||
    uploadKind === 'flatScan'
  );
}

async function fetchVisionOmr(payload: {
  examId: string;
  imageBase64: string;
  rows: { questionId: string; globalNumber: number; options: string[] }[];
  omrColumnCount: number;
  focusNumbers: number[];
}) {
  const headers = await dashboardAuthJsonHeaders();
  const controller = new AbortController();
  const timeoutMs = 9000;
  const timeoutId =
    typeof window !== 'undefined' ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    return await fetch('/api/calificar/vision-omr', {
      method: 'POST',
      headers: { ...headers },
      credentials: 'include',
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    if (typeof window !== 'undefined') window.clearTimeout(timeoutId);
  }
}

function mapRawToDraftDetailed(raw: (number | null)[], chunk: Question[]) {
  const mapped = mapOmrPicksToMcDraftDetailed(chunk, raw);
  return {
    ...mapped,
    draft: mapped.draft,
    unresolvedCount: mapped.unresolvedCount,
    resolvedCount: mapped.resolvedCount,
  };
}

async function applyVisionSelections(
  raw: (number | null)[],
  chunk: Question[],
  indices: number[],
  selections: Record<string, string> | undefined
): Promise<void> {
  if (!selections) return;
  for (const i of indices) {
    const q = chunk[i];
    if (!q) continue;
    const text = (selections[q.id] ?? '').trim();
    const opts = q.options ?? [];
    if (text && opts.includes(text)) {
      raw[i] = opts.indexOf(text);
    }
  }
}

/**
 * Pipeline compartido desktop/móvil: scan OMR + recovery + visión asistida → picks/draft enriquecidos.
 * CalifacilOmrReviewOverlay solo consume el resultado; no califica por sí mismo.
 */
export async function runCalifacilOmrReadingPipeline(
  input: CalifacilOmrReadingInput
): Promise<CalifacilOmrReadingResult> {
  const {
    source,
    oriented,
    chunk,
    examId,
    omrCols,
    omrRowCount,
    chunkQuestionOffset,
    preWarped,
    isMobileCamera,
    isMobile,
    fallbackFile,
    uploadKind,
    disableVisionAssist,
    sheetStrict,
    preserveCapturedFrame,
  } = input;

  const useFixedTemplate =
    preWarped && isMobileCamera ? true : isMobileCamera ? sheetStrict : Boolean(fallbackFile);

  const useDocumentScan =
    uploadKind === 'pdf' ||
    uploadKind === 'flatDocument' ||
    uploadKind === 'flatScan' ||
    (isMobile && Boolean(fallbackFile) && !isMobileCamera);
  const useWarpedScan =
    uploadKind === 'warpedPhoto' ||
    uploadKind === 'photoCrop' ||
    (isMobile && preWarped && !fallbackFile);

  const resolveScanCanvas = (
    input: HTMLImageElement | HTMLCanvasElement
  ): HTMLCanvasElement | null => {
    if (input instanceof HTMLCanvasElement) return input;
    return prepareCalifacilScanInput(input, { useGuideCrop: false });
  };

  const prepareGradeCanvas = (canvas: HTMLCanvasElement): HTMLCanvasElement =>
    prepareCalifacilGradeScanCanvas(canvas, omrCols, omrRowCount, {
      preWarped: preWarped || useWarpedScan,
      warpAlignment: input.warpAlignment ?? null,
    });

  let scanCanvas = resolveScanCanvas(oriented);
  if (scanCanvas) {
    scanCanvas = prepareGradeCanvas(scanCanvas);
  }
  let activeScanSource: HTMLImageElement | HTMLCanvasElement = scanCanvas ?? oriented;
  let meta: OmrScanMetaResult;
  const useMobileFastPath =
    Boolean(isMobileCamera && preWarped && scanCanvas) ||
    Boolean(isMobile && preWarped && scanCanvas && !fallbackFile);

  if (useMobileFastPath && scanCanvas) {
    // Cámara móvil: un solo perfil rápido (nunca 320 iters).
    meta = await scanWarpedGradeMobileAsync(scanCanvas, omrCols, omrRowCount, {
      activeRows: chunk.length,
    });
  } else if (useWarpedScan && scanCanvas) {
    meta = await scanWarpedGradeUnifiedOrLegacyAsync(scanCanvas, omrCols, omrRowCount);
  } else if (useDocumentScan && scanCanvas) {
    meta = await scanDesktopGradeUnifiedOrLegacyAsync(scanCanvas, omrCols, omrRowCount);
  } else if (scanCanvas && isMobile) {
    meta = await scanWarpedGradeMobileAsync(scanCanvas, omrCols, omrRowCount, {
      activeRows: chunk.length,
    });
  } else {
    meta = scanLiveOmrUnifiedOrLegacy(activeScanSource, omrCols, {
      skipGuideCrop: true,
      geometryMode:
        isMobileCamera
          ? 'auto'
          : fallbackFile
            ? 'fullSheet'
            : isMobile
              ? 'fullSheet'
              : 'auto',
      preserveInputCanvas: isMobileCamera ? false : preserveCapturedFrame,
      fixedTemplateAnchor: useFixedTemplate,
      answerSheetTemplateOnly: false,
      rowCount: omrRowCount,
      includeWarpAlignment: Boolean(input.includeWarpAlignment) || Boolean(input.warpAlignment),
    });
  }

  const warpAlignment = input.warpAlignment ?? meta.warpAlignment ?? null;

  let raw = [...meta.picks];
  let mapped = mapRawToDraftDetailed(raw, chunk);
  const minResolved = Math.max(1, Math.ceil(chunk.length * CALIFACIL_MIN_AUTO_READ_RATIO));
  let mostlyBlank = isAnswerSheetOmrMostlyBlank(meta, chunk.length);

  if (mostlyBlank) {
    raw = raw.map(() => null);
    mapped = mapRawToDraftDetailed(raw, chunk);
  }

  if (isMobile && mapped.resolvedCount < minResolved && !(preWarped && isMobileCamera)) {
    const recoverySource =
      autoOrientCalifacilSheet(source, omrCols, {
        useGuideCrop: false,
        allowTiltSweep: true,
      }) ?? oriented;

    const recoveryCanvas = resolveScanCanvas(recoverySource);
    if (recoveryCanvas) {
      const preparedRecovery = prepareGradeCanvas(recoveryCanvas);
      // Móvil: recovery también en perfil rápido (no 320 iters).
      const recoveryMeta = await scanWarpedGradeMobileAsync(
        preparedRecovery,
        omrCols,
        omrRowCount,
        { activeRows: chunk.length }
      );
      const recoveryRaw = [...recoveryMeta.picks];
      const recoveryMapped = mapRawToDraftDetailed(recoveryRaw, chunk);

      if (recoveryMapped.resolvedCount > mapped.resolvedCount) {
        meta = recoveryMeta;
        raw = recoveryRaw;
        mapped = recoveryMapped;
        activeScanSource = preparedRecovery;
        mostlyBlank = isAnswerSheetOmrMostlyBlank(meta, chunk.length);
        if (mostlyBlank) {
          raw = raw.map(() => null);
          mapped = mapRawToDraftDetailed(raw, chunk);
        }
      }
    }
  }

  const shouldRunDesktopRecovery =
    !isMobile &&
    !isMobileCamera &&
    !mostlyBlank &&
    mapped.resolvedCount < minResolved &&
    scanCanvas &&
    mapped.resolvedCount < Math.max(1, Math.ceil(omrRowCount * 0.45)) &&
    uploadKind !== 'pdf' &&
    uploadKind !== 'flatDocument' &&
    uploadKind !== 'flatScan';

  if (shouldRunDesktopRecovery) {
    let recoveryMeta: OmrScanMetaResult | null = null;
    const desktopScanCanvas = scanCanvas;
    if (uploadKind === 'warpedPhoto') {
      if (desktopScanCanvas) {
        recoveryMeta = scanWarpedMobileCaptureSheetFast(desktopScanCanvas, omrCols, omrRowCount);
      }
    } else {
      const recoverySource =
        autoOrientCalifacilSheet(source, omrCols, {
          useGuideCrop: false,
          allowTiltSweep: true,
        }) ?? oriented;
      const recoveryCanvas = resolveScanCanvas(recoverySource);
      if (recoveryCanvas) {
        recoveryMeta = await scanDesktopGradeUnifiedOrLegacyAsync(
          recoveryCanvas,
          omrCols,
          omrRowCount
        );
        activeScanSource = recoveryCanvas;
      }
    }
    if (recoveryMeta) {
      const recoveryRaw = [...recoveryMeta.picks];
      const recoveryMapped = mapRawToDraftDetailed(recoveryRaw, chunk);
      if (recoveryMapped.resolvedCount > mapped.resolvedCount) {
        meta = recoveryMeta;
        raw = recoveryRaw;
        mapped = recoveryMapped;
        mostlyBlank = isAnswerSheetOmrMostlyBlank(meta, chunk.length);
        if (mostlyBlank) {
          raw = raw.map(() => null);
          mapped = mapRawToDraftDetailed(raw, chunk);
        }
      }
    }
  }

  const visionDisabled = Boolean(disableVisionAssist);

  const ambiguousIdx = meta.rows
    .map((r, i) => (i < chunk.length && r.ambiguous ? i : -1))
    .filter((i) => i >= 0);

  const picksBeforeVision = raw.slice(0, chunk.length);
  const allSameCol =
    chunk.length > 1 &&
    picksBeforeVision.every((p, i) => i === 0 || p === picksBeforeVision[0]) &&
    picksBeforeVision[0] !== null &&
    picksBeforeVision.every((p) => p !== null);

  const visionImageSource = oriented;

  if (
    !mostlyBlank &&
    !isMobileCamera &&
    !isMobile &&
    examId &&
    !visionDisabled &&
    !desktopUploadSkipsVision(uploadKind)
  ) {
    const desktopVisionRows = collectDesktopVisionRowIndices(meta, chunk.length);
    if (desktopVisionRows.length > 0) {
      const rowsPayload = desktopVisionRows.map((i) => ({
        questionId: chunk[i]!.id,
        globalNumber: chunkQuestionOffset + i + 1,
        options: chunk[i]!.options ?? [],
      }));
      try {
        const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
        const res = await fetchVisionOmr({
          examId,
          imageBase64,
          rows: rowsPayload,
          omrColumnCount: omrCols,
          focusNumbers: rowsPayload.map((r) => r.globalNumber),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          selections?: Record<string, string>;
        };
        if (res.ok) {
          await applyVisionSelections(raw, chunk, desktopVisionRows, payload.selections);
        }
      } catch {
        /* mantener lectura local */
      }
    }
  }

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onAmbiguousRows &&
    ambiguousIdx.length > 0 &&
    examId &&
    !visionDisabled
  ) {
    const rowsPayload = ambiguousIdx.map((i) => ({
      questionId: chunk[i]!.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: chunk[i]!.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok) {
        await applyVisionSelections(raw, chunk, ambiguousIdx, payload.selections);
      }
    } catch {
      /* mantener lectura local */
    }
  }

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onManySameColumnAlign &&
    examId &&
    chunk.length >= 8 &&
    meta.maxSameColumnCount >= 8 &&
    !allSameCol &&
    !visionDisabled
  ) {
    const rowsPayload = chunk.map((q, i) => ({
      questionId: q.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: q.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok && payload.selections) {
        for (let i = 0; i < chunk.length; i++) {
          await applyVisionSelections(raw, chunk, [i], payload.selections);
        }
      }
    } catch {
      /* mantener lectura local */
    }
  }

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onAllSameColumn &&
    allSameCol &&
    examId &&
    !ambiguousIdx.length &&
    !visionDisabled
  ) {
    const rowsPayload = chunk.map((q, i) => ({
      questionId: q.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: q.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok && payload.selections) {
        for (let i = 0; i < chunk.length; i++) {
          await applyVisionSelections(raw, chunk, [i], payload.selections);
        }
      }
    } catch {
      /* mantener lectura local */
    }
  }

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onFinalizeEveryRow &&
    examId &&
    chunk.length > 0 &&
    !visionDisabled
  ) {
    const rowsPayload = chunk.map((q, i) => ({
      questionId: q.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: q.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok && payload.selections) {
        for (let i = 0; i < chunk.length; i++) {
          await applyVisionSelections(raw, chunk, [i], payload.selections);
        }
      }
    } catch {
      /* mantener OMR local */
    }
  }

  const resolvedRatio = chunk.length > 0 ? mapped.resolvedCount / chunk.length : 0;
  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onLowResolvedRatio &&
    examId &&
    chunk.length > 0 &&
    !visionDisabled &&
    resolvedRatio > 0 &&
    resolvedRatio < CALIFACIL_VISION_POLICY.lowResolvedRatioThreshold
  ) {
    const rowsPayload = chunk.map((q, i) => ({
      questionId: q.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: q.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok && payload.selections) {
        for (let i = 0; i < chunk.length; i++) {
          await applyVisionSelections(raw, chunk, [i], payload.selections);
        }
      }
    } catch {
      /* mantener OMR local */
    }
  }

  mapped = mapRawToDraftDetailed(raw, chunk);
  const picksInChunk = raw.slice(0, chunk.length);

  const locks = { ...input.liveLockedAnswers };
  const mergedDraft: Record<string, string> = {};
  let mergedResolved = 0;
  for (const q of chunk) {
    const locked = locks[q.id]?.trim();
    if (locked) {
      mergedDraft[q.id] = locked;
      mergedResolved++;
    } else {
      const v = mapped.draft[q.id]?.trim() ?? '';
      mergedDraft[q.id] = v;
      if (v) {
        locks[q.id] = v;
        mergedResolved++;
      }
    }
  }

  const updatedLiveLocks: Record<string, string> = {};
  for (const q of chunk) {
    const v = mapped.draft[q.id]?.trim() ?? '';
    if (v) updatedLiveLocks[q.id] = v;
  }

  const detectedBubbleCount =
    meta.geometry?.bubbles?.flat().filter((b) => b.r > 0).length ?? 0;
  const hasStrongGeometry =
    detectedBubbleCount >= omrRowCount * omrCols * 0.85;
  const geometryConverged = meta.geometry?.quality?.convergence?.converged === true;
  const partialDesktopOk =
    !isMobileCamera &&
    !isMobile &&
    (mergedResolved >= Math.max(1, Math.ceil(chunk.length * 0.9)) ||
      (hasStrongGeometry &&
        geometryConverged &&
        mergedResolved >= Math.max(1, Math.ceil(chunk.length * 0.5))));

  const insufficientForReview =
    !mostlyBlank && mergedResolved < minResolved && !isMobileCamera && !partialDesktopOk;

  return {
    meta,
    raw,
    mapped,
    mergedDraft,
    mergedResolved,
    picksInChunk,
    activeScanSource,
    warpAlignment,
    mostlyBlank,
    minResolved,
    ambiguousIdx,
    insufficientForReview,
    updatedLiveLocks,
  };
}

/** Lectura ya resuelta (p. ej. ZipGrade) sin repetir el pipeline CaliFacil completo. */
export function buildCalifacilOmrReadingOverride(
  meta: OmrScanMetaResult,
  chunk: Question[],
  activeScanSource: HTMLImageElement | HTMLCanvasElement,
  liveLockedAnswers: Record<string, string>,
  warpAlignment: WarpAlignmentReport | null = null
): CalifacilOmrReadingResult {
  const resolvedBefore = meta.picks.slice(0, chunk.length).filter((p) => p != null).length;
  // Clave del examen se aplica después; aquí solo no borrar lecturas útiles.
  const mostlyBlank =
    isAnswerSheetOmrMostlyBlank(meta, chunk.length) && resolvedBefore < 3;
  const sanitized = mostlyBlank
    ? {
        ...meta,
        picks: Array(chunk.length).fill(null) as (number | null)[],
        rows: meta.rows.slice(0, chunk.length).map((r) => ({
          ...r,
          pick: null,
          ambiguous: false,
        })),
        maxSameColumnCount: 0,
        needsVisionAssist: false,
      }
    : meta;
  const raw = [...sanitized.picks];
  const mapped = mapRawToDraftDetailed(raw, chunk);
  const minResolved = Math.max(1, Math.ceil(chunk.length * CALIFACIL_MIN_AUTO_READ_RATIO));

  const ambiguousIdx = sanitized.rows
    .map((r, i) => (i < chunk.length && r.ambiguous ? i : -1))
    .filter((i) => i >= 0);

  const locks = { ...liveLockedAnswers };
  const mergedDraft: Record<string, string> = {};
  let mergedResolved = 0;
  for (const q of chunk) {
    const locked = locks[q.id]?.trim();
    if (locked) {
      mergedDraft[q.id] = locked;
      mergedResolved++;
    } else {
      const v = mapped.draft[q.id]?.trim() ?? '';
      mergedDraft[q.id] = v;
      if (v) {
        locks[q.id] = v;
        mergedResolved++;
      }
    }
  }

  const updatedLiveLocks: Record<string, string> = {};
  for (const q of chunk) {
    const v = mapped.draft[q.id]?.trim() ?? '';
    if (v) updatedLiveLocks[q.id] = v;
  }

  return {
    meta: sanitized,
    raw,
    mapped,
    mergedDraft,
    mergedResolved,
    picksInChunk: raw.slice(0, chunk.length),
    activeScanSource,
    warpAlignment,
    mostlyBlank,
    minResolved,
    ambiguousIdx,
    insufficientForReview: !mostlyBlank && mergedResolved < minResolved,
    updatedLiveLocks,
  };
}
