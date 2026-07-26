'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Crop,
  Loader2,
  Palette,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { cn, getGradeColor } from '@/lib/utils';
import {
  buildAnswerSheetGradingGeometryFromNormFrame,
  CALIFACIL_WARP_LETTER_HEIGHT,
  CALIFACIL_WARP_LETTER_WIDTH,
  califacilOmrOrangeFrameRect,
  califacilViewfinderNormRect,
  downscaleCanvasForOmrScan,
  refineAnswerSheetGeometryToBubblePeaks,
  refineWarpedCalifacilSheet,
  scanWarpedWithNormTableFrame,
  warpCalifacilSheetFromQuad,
  type CalifacilOmrScanGeometry,
  type OmrNormRect,
  type WarpAlignmentReport,
} from '@/lib/omrScan';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';

export type ScanReviewQuad = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
];

export type ScanReviewFilter = 'color' | 'grayscale' | 'bw';

export type MobileAlignPreview = {
  geometry: CalifacilOmrScanGeometry;
  picks: (number | null)[];
  expectedPicks: (number | null)[];
  previewCanvas: HTMLCanvasElement;
  previewUrl: string;
  score: { correct: number; total: number; pct: number };
};

type Props = {
  sourceCanvas: HTMLCanvasElement;
  frameQuad: ScanReviewQuad;
  initialWarped: HTMLCanvasElement;
  initialAlignment: WarpAlignmentReport | null;
  initialFilter?: ScanReviewFilter;
  rowCount: number;
  columnCount: number;
  alignPreview?: MobileAlignPreview | null;
  alignOrangeFrame?: OmrNormRect | null;
  scanning?: boolean;
  statusMessage?: string | null;
  onRetake: () => void;
  onPreviewAlignment: (warped: HTMLCanvasElement, alignment: WarpAlignmentReport | null) => void;
  onRealignOrangeFrame?: (frame: OmrNormRect) => void;
  onFinalizeGrade: () => void;
  onBackFromAlign: () => void;
  detectedControlNumber?: string | null;
  identifiedStudentName?: string | null;
};

function cloneQuad(quad: ScanReviewQuad): ScanReviewQuad {
  return quad.map((p) => ({ ...p })) as ScanReviewQuad;
}

function downscaleCanvas(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const sw = canvas.width;
  const sh = canvas.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  if (scale >= 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function useCanvasPreviewUrl(canvas: HTMLCanvasElement | null, maxSide: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!canvas) {
      setUrl(null);
      return;
    }
    const token = ++tokenRef.current;
    const preview = downscaleCanvas(canvas, maxSide);
    preview.toBlob(
      (blob) => {
        if (!blob || token !== tokenRef.current) return;
        const next = URL.createObjectURL(blob);
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return next;
        });
      },
      'image/jpeg',
      0.86
    );
    return () => {
      tokenRef.current += 1;
    };
  }, [canvas, maxSide, canvas?.width, canvas?.height]);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );

  return url;
}

function warpFromQuad(source: HTMLCanvasElement, quad: ScanReviewQuad): HTMLCanvasElement | null {
  return warpCalifacilSheetFromQuad(source, quad);
}

function applyFilterAndRotation(
  source: HTMLCanvasElement,
  filter: ScanReviewFilter,
  rotation: 0 | 90 | 180 | 270
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const srcW = source.width;
  const srcH = source.height;
  const rotated = rotation === 90 || rotation === 270;
  out.width = rotated ? srcH : srcW;
  out.height = rotated ? srcW : srcH;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.save();
  if (rotation === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else if (rotation === 270) {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  if (filter === 'color') return out;

  const id = ctx.getImageData(0, 0, out.width, out.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (filter === 'grayscale') {
      d[i] = d[i + 1] = d[i + 2] = lum;
    } else {
      const v = lum < 168 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

function displayQuadToSource(
  quad: ScanReviewQuad,
  displayW: number,
  displayH: number,
  sourceW: number,
  sourceH: number
): ScanReviewQuad {
  const sx = sourceW / Math.max(1, displayW);
  const sy = sourceH / Math.max(1, displayH);
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as ScanReviewQuad;
}

function sourceQuadToDisplay(
  quad: ScanReviewQuad,
  displayW: number,
  displayH: number,
  sourceW: number,
  sourceH: number
): ScanReviewQuad {
  const sx = displayW / Math.max(1, sourceW);
  const sy = displayH / Math.max(1, sourceH);
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as ScanReviewQuad;
}

function orangeFrameForGeometry(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): OmrNormRect | null {
  return (
    califacilOmrOrangeFrameRect(geometry, rowCount) ??
    califacilViewfinderNormRect(geometry.imageWidth, geometry.imageHeight)
  );
}

function clampOrangeFrame(frame: OmrNormRect): OmrNormRect {
  const minW = 0.1;
  const minH = 0.06;
  let { x, y, w, h } = frame;
  w = Math.max(minW, Math.min(1, w));
  h = Math.max(minH, Math.min(1, h));
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return { x, y, w, h };
}

function translateOrangeFrame(frame: OmrNormRect, dx: number, dy: number): OmrNormRect {
  return clampOrangeFrame({
    x: frame.x + dx,
    y: frame.y + dy,
    w: frame.w,
    h: frame.h,
  });
}

type OrangeFrameDrag =
  | { kind: 'corner'; corner: number; pointerId: number }
  | {
      kind: 'move';
      pointerId: number;
      startNormX: number;
      startNormY: number;
      originFrame: OmrNormRect;
    };

function updateOrangeFrameCorner(
  frame: OmrNormRect,
  corner: number,
  nx: number,
  ny: number
): OmrNormRect {
  const x0 = frame.x;
  const y0 = frame.y;
  const x1 = frame.x + frame.w;
  const y1 = frame.y + frame.h;
  let left = x0;
  let top = y0;
  let right = x1;
  let bottom = y1;
  if (corner === 0) {
    left = nx;
    top = ny;
  } else if (corner === 1) {
    right = nx;
    top = ny;
  } else if (corner === 2) {
    right = nx;
    bottom = ny;
  } else {
    left = nx;
    bottom = ny;
  }
  return clampOrangeFrame({
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    w: Math.abs(right - left),
    h: Math.abs(bottom - top),
  });
}

function normPointFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
  };
}

function scorePicksAgainstExpected(
  picks: (number | null)[],
  expected: (number | null)[]
): { correct: number; total: number; pct: number } {
  let correct = 0;
  let total = 0;
  const n = Math.min(picks.length, expected.length);
  for (let i = 0; i < n; i++) {
    const key = expected[i];
    if (key === null || key === undefined) continue;
    total++;
    if (picks[i] === key) correct++;
  }
  return { correct, total, pct: total > 0 ? Math.round((100 * correct) / total) : 0 };
}

export function MobileSheetScanReview({
  sourceCanvas,
  frameQuad,
  initialWarped,
  initialAlignment,
  initialFilter = 'color',
  rowCount,
  columnCount,
  alignPreview = null,
  alignOrangeFrame = null,
  scanning = false,
  statusMessage = null,
  onRetake,
  onPreviewAlignment,
  onRealignOrangeFrame,
  onFinalizeGrade,
  onBackFromAlign,
  detectedControlNumber = null,
  identifiedStudentName = null,
}: Props) {
  const [adjustMode, setAdjustMode] = useState(false);
  const [filter, setFilter] = useState<ScanReviewFilter>(initialFilter);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sourceQuad, setSourceQuad] = useState<ScanReviewQuad>(() => cloneQuad(frameQuad));
  const [warped, setWarped] = useState<HTMLCanvasElement>(initialWarped);
  const [alignment, setAlignment] = useState<WarpAlignmentReport | null>(initialAlignment);
  const adjustSurfaceRef = useRef<HTMLDivElement>(null);
  const alignSurfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ corner: number; pointerId: number } | null>(null);
  const orangeDragRef = useRef<OrangeFrameDrag | null>(null);
  const [displayQuad, setDisplayQuad] = useState<ScanReviewQuad>([] as unknown as ScanReviewQuad);
  const [orangeFrameNorm, setOrangeFrameNorm] = useState<OmrNormRect | null>(null);
  const [livePicks, setLivePicks] = useState<(number | null)[] | null>(null);
  const [liveScore, setLiveScore] = useState<MobileAlignPreview['score'] | null>(null);

  const filteredPreview = useMemo(
    () => applyFilterAndRotation(warped, filter, rotation),
    [warped, filter, rotation]
  );
  const previewUrl = useCanvasPreviewUrl(filteredPreview, 960);
  const sourceUrl = useCanvasPreviewUrl(adjustMode ? sourceCanvas : null, 1200);

  useEffect(() => {
    if (!alignPreview) {
      setOrangeFrameNorm(null);
      setLivePicks(null);
      setLiveScore(null);
      return;
    }
    setOrangeFrameNorm(
      alignOrangeFrame ?? orangeFrameForGeometry(alignPreview.geometry, rowCount)
    );
    setLivePicks([...alignPreview.picks]);
    setLiveScore(alignPreview.score);
  }, [alignPreview, alignOrangeFrame, rowCount]);

  useEffect(() => {
    if (!alignPreview?.previewCanvas || !orangeFrameNorm || scanning) return;
    const timer = window.setTimeout(() => {
      const scanCanvas = downscaleCanvasForOmrScan(alignPreview.previewCanvas, 960);
      const meta = scanWarpedWithNormTableFrame(
        scanCanvas,
        columnCount,
        rowCount,
        orangeFrameNorm
      );
      setLivePicks([...meta.picks]);
      setLiveScore(scorePicksAgainstExpected(meta.picks, alignPreview.expectedPicks));
    }, 45);
    return () => window.clearTimeout(timer);
  }, [alignPreview, orangeFrameNorm, columnCount, rowCount, scanning]);

  const autoPreviewFiredRef = useRef(false);
  useEffect(() => {
    if (alignPreview || adjustMode || autoPreviewFiredRef.current) return;
    autoPreviewFiredRef.current = true;
    onPreviewAlignment(filteredPreview, alignment);
  }, [alignPreview, adjustMode, filteredPreview, alignment, onPreviewAlignment]);

  const displayGeometry = useMemo(() => {
    if (!alignPreview || !orangeFrameNorm) return null;
    const scanCanvas = downscaleCanvasForOmrScan(alignPreview.previewCanvas, 1200);
    const base = buildAnswerSheetGradingGeometryFromNormFrame(
      orangeFrameNorm,
      rowCount,
      columnCount,
      scanCanvas.width,
      scanCanvas.height
    );
    return refineAnswerSheetGeometryToBubblePeaks(scanCanvas, base);
  }, [alignPreview, orangeFrameNorm, rowCount, columnCount]);

  const recomputeWarp = useCallback(
    (quad: ScanReviewQuad) => {
      const next = warpFromQuad(sourceCanvas, quad);
      if (!next) return;
      const refined = refineWarpedCalifacilSheet(next, { maxAllowedPx: 22, fast: true });
      setWarped(refined.canvas);
      setAlignment(refined.alignment);
    },
    [sourceCanvas]
  );

  useEffect(() => {
    const el = adjustSurfaceRef.current;
    if (!el || !adjustMode) return;
    const rect = el.getBoundingClientRect();
    setDisplayQuad(
      sourceQuadToDisplay(sourceQuad, rect.width, rect.height, sourceCanvas.width, sourceCanvas.height)
    );
  }, [adjustMode, sourceCanvas.height, sourceCanvas.width, sourceQuad]);

  const handlePointerDown = (corner: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { corner, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = adjustSurfaceRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setDisplayQuad((prev) => {
      const next = cloneQuad(prev.length === 4 ? prev : displayQuad);
      next[drag.corner] = { x, y };
      return next;
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = adjustSurfaceRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    dragRef.current = null;
    const rect = el.getBoundingClientRect();
    const nextDisplay = cloneQuad(displayQuad);
    nextDisplay[drag.corner] = {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    };
    const nextSource = displayQuadToSource(
      nextDisplay,
      rect.width,
      rect.height,
      sourceCanvas.width,
      sourceCanvas.height
    );
    setDisplayQuad(nextDisplay);
    setSourceQuad(nextSource);
    recomputeWarp(nextSource);
  };

  const handleCheck = () => {
    if (scanning && !alignPreview) return;
    if (alignPreview) {
      onFinalizeGrade();
      return;
    }
    onPreviewAlignment(filteredPreview, alignment);
  };

  const handleRetake = () => {
    onRetake();
  };

  const handleBackFromAlign = () => {
    onBackFromAlign();
  };

  const handleOrangeCornerPointerDown = (corner: number) => (e: React.PointerEvent) => {
    if (scanning) return;
    e.preventDefault();
    e.stopPropagation();
    orangeDragRef.current = { kind: 'corner', corner, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleOrangeFrameMovePointerDown = (e: React.PointerEvent) => {
    if (scanning || !orangeFrameNorm) return;
    e.preventDefault();
    e.stopPropagation();
    const el = alignSurfaceRef.current;
    if (!el) return;
    const p = normPointFromPointer(e.clientX, e.clientY, el.getBoundingClientRect());
    orangeDragRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startNormX: p.x,
      startNormY: p.y,
      originFrame: orangeFrameNorm,
    };
    el.setPointerCapture(e.pointerId);
  };

  const handleOrangePointerMove = (e: React.PointerEvent) => {
    const drag = orangeDragRef.current;
    const el = alignSurfaceRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el || !orangeFrameNorm) return;
    const rect = el.getBoundingClientRect();
    const p = normPointFromPointer(e.clientX, e.clientY, rect);
    if (drag.kind === 'corner') {
      setOrangeFrameNorm(updateOrangeFrameCorner(orangeFrameNorm, drag.corner, p.x, p.y));
      return;
    }
    setOrangeFrameNorm(
      translateOrangeFrame(
        drag.originFrame,
        p.x - drag.startNormX,
        p.y - drag.startNormY
      )
    );
  };

  const handleOrangePointerUp = (e: React.PointerEvent) => {
    const drag = orangeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !orangeFrameNorm) return;
    orangeDragRef.current = null;
    onRealignOrangeFrame?.(orangeFrameNorm);
  };

  const quadPoints = displayQuad.length === 4 ? displayQuad : [];
  const polyline =
    quadPoints.length === 4
      ? `${quadPoints[0].x},${quadPoints[0].y} ${quadPoints[1].x},${quadPoints[1].y} ${quadPoints[2].x},${quadPoints[2].y} ${quadPoints[3].x},${quadPoints[3].y}`
      : '';

  const orangeFrame = orangeFrameNorm;
  const geoW = displayGeometry
    ? Math.max(1, displayGeometry.imageWidth)
    : alignPreview
      ? Math.max(1, alignPreview.geometry.imageWidth)
      : 1;
  const geoH = displayGeometry
    ? Math.max(1, displayGeometry.imageHeight)
    : alignPreview
      ? Math.max(1, alignPreview.geometry.imageHeight)
      : 1;
  const overlayPicks = livePicks ?? alignPreview?.picks ?? [];
  const overlayScore = liveScore ?? alignPreview?.score;

  return (
    <div
      className="fixed inset-0 z-[260] flex animate-fade-in flex-col bg-[#1c1c1e] text-white"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="relative z-30 flex shrink-0 items-center justify-between px-3 py-2">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
          style={{ touchAction: 'manipulation' }}
          aria-label={alignPreview ? 'Volver a editar' : 'Volver a cámara'}
          onClick={alignPreview ? handleBackFromAlign : handleRetake}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {alignPreview ? (
          <p className="text-sm font-semibold text-white/90">Revisa la alineación</p>
        ) : (
          <button
            type="button"
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold active:bg-white/20"
            style={{ touchAction: 'manipulation' }}
            onClick={handleRetake}
          >
            Repetir
          </button>
        )}
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg disabled:opacity-60 active:scale-95 hover:bg-orange-600"
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          aria-label={alignPreview ? 'Calificar' : 'Ver lectura de respuestas'}
          disabled={scanning && !alignPreview}
          onClick={handleCheck}
        >
          {scanning ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Check className="h-5 w-5" strokeWidth={3} />
          )}
        </button>
      </div>

      {statusMessage ? (
        <p className="shrink-0 px-4 pb-2 text-center text-sm font-medium text-amber-200">
          {statusMessage}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden px-3 pb-2">
        {scanning && !alignPreview ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/80">
            <Loader2 className="h-10 w-10 animate-spin text-amber-300" />
            <p className="text-sm">{statusMessage ?? 'Procesando…'}</p>
          </div>
        ) : alignPreview ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div
              ref={alignSurfaceRef}
              className="relative mx-auto w-full max-w-md touch-none overflow-hidden rounded-lg bg-black/40 shadow-2xl"
              style={{ aspectRatio: `${geoW} / ${geoH}`, maxHeight: 'min(58dvh, 32rem)' }}
              onPointerMove={handleOrangePointerMove}
              onPointerUp={handleOrangePointerUp}
              onPointerCancel={handleOrangePointerUp}
            >
              {scanning ? (
                <div className="absolute inset-0 z-[5] flex items-center justify-center bg-black/40">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-300" />
                </div>
              ) : null}
              {alignPreview.previewUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={alignPreview.previewUrl}
                  alt="Lectura OMR sobre el escaneo"
                  className="pointer-events-none absolute inset-0 z-0 h-full w-full object-contain"
                  draggable={false}
                />
              ) : null}
              {displayGeometry ? (
                <div className="pointer-events-none absolute inset-0 z-[2]">
                  <CalifacilOmrReviewOverlay
                    geometry={displayGeometry}
                    picks={overlayPicks}
                    expectedPicks={alignPreview.expectedPicks}
                    expectedOpacity={0.45}
                    rowCount={rowCount}
                  />
                </div>
              ) : null}
              {orangeFrame ? (
                <>
                  <div
                    className="absolute z-[3] cursor-move rounded-md border-2 border-orange-400 bg-orange-400/5 touch-none"
                    style={{
                      left: `${orangeFrame.x * 100}%`,
                      top: `${orangeFrame.y * 100}%`,
                      width: `${orangeFrame.w * 100}%`,
                      height: `${orangeFrame.h * 100}%`,
                    }}
                    aria-hidden
                    onPointerDown={handleOrangeFrameMovePointerDown}
                  />
                  {(
                    [
                      [orangeFrame.x, orangeFrame.y],
                      [orangeFrame.x + orangeFrame.w, orangeFrame.y],
                      [orangeFrame.x + orangeFrame.w, orangeFrame.y + orangeFrame.h],
                      [orangeFrame.x, orangeFrame.y + orangeFrame.h],
                    ] as const
                  ).map(([nx, ny], i) => (
                    <button
                      key={i}
                      type="button"
                      className="absolute z-[4] h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-orange-500 shadow-lg active:scale-95"
                      style={{
                        left: `${nx * 100}%`,
                        top: `${ny * 100}%`,
                        touchAction: 'none',
                      }}
                      aria-label={`Esquina ${i + 1} del marco naranja`}
                      disabled={scanning}
                      onPointerDown={handleOrangeCornerPointerDown(i)}
                    />
                  ))}
                </>
              ) : null}
            </div>
            <div className="mt-3 w-full max-w-md rounded-xl bg-white/8 px-3 py-2 text-center ring-1 ring-white/10">
              {detectedControlNumber ? (
                <p className="text-[11px] text-white/75">
                  N.º de control: <span className="font-semibold text-white">{detectedControlNumber}</span>
                  {identifiedStudentName ? (
                    <span className="text-white/60"> · {identifiedStudentName}</span>
                  ) : null}
                </p>
              ) : null}
              {overlayScore ? (
                <p className="text-sm font-semibold">
                  <span className="tabular-nums">{overlayScore.correct}</span>
                  <span className="text-white/70"> / </span>
                  <span className="tabular-nums">{overlayScore.total}</span>
                  <span className="mx-2 text-white/50">·</span>
                  <span className={cn('tabular-nums', getGradeColor(overlayScore.pct))}>
                    {overlayScore.pct}%
                  </span>
                </p>
              ) : null}
              <p className="mt-1 text-[11px] leading-snug text-white/65">
                Arrastra el marco naranja hasta alinear los círculos naranjas con las burbujas de la clave · Verde =
                acierto · Rojo = error
              </p>
            </div>
          </div>
        ) : adjustMode ? (
          <div
            ref={adjustSurfaceRef}
            className="relative mx-auto h-full max-h-full w-full max-w-lg touch-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {sourceUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={sourceUrl}
                alt="Ajustar esquinas del documento"
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/60">
                Cargando…
              </div>
            )}
            {quadPoints.length === 4 ? (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                <polygon
                  points={polyline}
                  fill="rgba(255, 204, 0, 0.22)"
                  stroke="rgb(255, 193, 7)"
                  strokeWidth={2}
                />
              </svg>
            ) : null}
            {quadPoints.map((p, i) => (
              <button
                key={i}
                type="button"
                className="absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-orange-500 shadow-lg"
                style={{ left: p.x, top: p.y }}
                aria-label={`Esquina ${i + 1}`}
                onPointerDown={handlePointerDown(i)}
              />
            ))}
          </div>
        ) : previewUrl ? (
          <div className="flex h-full w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Vista previa del escaneo"
              className="max-h-full max-w-full rounded-lg shadow-2xl"
              draggable={false}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/70">
            Procesando escaneo…
          </div>
        )}
      </div>

      <div className="relative z-30 shrink-0 border-t border-white/10 bg-[#1c1c1e] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {alignPreview ? (
          <div className="mx-auto flex max-w-md gap-2 px-2">
            <button
              type="button"
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-semibold active:bg-white/15"
              style={{ touchAction: 'manipulation' }}
              onClick={handleBackFromAlign}
            >
              Ajustar de nuevo
            </button>
            <button
              type="button"
              className="flex-1 rounded-xl bg-orange-600 py-3 text-sm font-semibold text-white hover:bg-orange-700"
              style={{ touchAction: 'manipulation' }}
              disabled={scanning}
              onClick={onFinalizeGrade}
            >
              {scanning ? 'Calificando…' : 'Calificar'}
            </button>
          </div>
        ) : (
          <>
            <div className="mx-auto flex max-w-md items-stretch justify-around gap-1">
              <button
                type="button"
                className={cn(
                  'flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium',
                  adjustMode ? 'bg-amber-400/20 text-amber-200' : 'text-white/80'
                )}
                disabled={scanning}
                onClick={() => {
                  setAdjustMode((v) => !v);
                  setFilterMenuOpen(false);
                }}
              >
                <Crop className="h-6 w-6" />
                Ajustar
              </button>
              <div className="relative">
                <button
                  type="button"
                  className={cn(
                    'flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium',
                    filter !== 'color' ? 'bg-amber-400/20 text-amber-200' : 'text-white/80'
                  )}
                  disabled={scanning}
                  onClick={() => setFilterMenuOpen((v) => !v)}
                >
                  <Palette className="h-6 w-6" />
                  Filtros
                </button>
                {filterMenuOpen ? (
                  <div className="absolute bottom-full left-1/2 z-20 mb-2 w-36 -translate-x-1/2 rounded-xl border border-white/15 bg-[#2c2c2e] p-1 shadow-lg">
                    {(
                      [
                        ['color', 'Color'],
                        ['grayscale', 'Escala grises'],
                        ['bw', 'Blanco y negro'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={cn(
                          'block w-full rounded-lg px-3 py-2 text-left text-sm text-white',
                          filter === id ? 'bg-white/15 font-semibold' : 'hover:bg-white/10'
                        )}
                        onClick={() => {
                          setFilter(id);
                          setFilterMenuOpen(false);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-white/80"
                disabled={scanning}
                onClick={() => setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)}
              >
                <RotateCcw className="h-6 w-6" />
                Girar
              </button>
              <button
                type="button"
                className="flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-red-400"
                disabled={scanning}
                onClick={onRetake}
              >
                <Trash2 className="h-6 w-6" />
                Eliminar
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-white/50">
              {CALIFACIL_WARP_LETTER_WIDTH}×{CALIFACIL_WARP_LETTER_HEIGHT}px · Pulsa ✓ para ver las respuestas leídas
            </p>
          </>
        )}
      </div>
    </div>
  );
}
