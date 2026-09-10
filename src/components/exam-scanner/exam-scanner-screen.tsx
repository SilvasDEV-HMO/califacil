'use client';

import { useMemo, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CameraView } from '@/components/exam-scanner/camera-view';
import { OverlayRenderer } from '@/components/exam-scanner/overlay-renderer';
import { StatusCard } from '@/components/exam-scanner/status-card';
import { ScanHud } from '@/components/exam-scanner/scan-hud';
import { CaptureFlash } from '@/components/exam-scanner/capture-flash';
import { CameraPermissionGate } from '@/components/exam-scanner/camera-permission-gate';
import {
  deriveDetectionPhase,
  deriveStatusLabel,
} from '@/components/exam-scanner/document-detector';
import type { ViewfinderGuideRectPx, ViewportPoint } from '@/components/exam-scanner/types';
import {
  EXAM_PSEUDO_FULLSCREEN_CLASS,
  type ExamFullscreenMode,
} from '@/lib/examFullscreen';
import { runScannerAction, type ScannerActions } from '@/components/exam-scanner/scanner-actions';

type FlashMode = 'auto' | 'on' | 'off';

export type CameraPermissionPhase = 'pending' | 'requesting' | 'denied' | 'granted';

export type ExamScannerScreenProps = {
  shellRef?: RefObject<HTMLDivElement | null>;
  viewportRef?: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  actionsRef: MutableRefObject<ScannerActions>;
  cameraOpen: boolean;
  cameraPermissionPhase?: CameraPermissionPhase;
  onRequestCamera?: () => void;
  scanBusy: boolean;
  shutterFlash: boolean;
  examTitle: string;
  documentPolygon: ViewportPoint[] | null;
  guideRect: ViewfinderGuideRectPx | null;
  aligned: boolean;
  stableProgress: number;
  lowLight?: boolean;
  cameraFullscreenMode?: ExamFullscreenMode;
  flashMode: FlashMode;
  flashOn: boolean;
  flashSupported: boolean;
  onRetryCamera: () => void;
  onVideoMount?: (node: HTMLVideoElement | null) => void;
  captureReady?: boolean;
  fiducialCount?: number;
  fiducialCorners?: [boolean, boolean, boolean, boolean];
  stripAligned?: boolean;
  autoShutterEnabled?: boolean;
  scanPreviewUrl?: string | null;
  scanPreviewOverlay?: ReactNode;
  scanPreviewOrangeFrame?: { x: number; y: number; w: number; h: number } | null;
  scanStatusLabel?: string;
};

export function ExamScannerScreen({
  shellRef,
  viewportRef,
  videoRef,
  actionsRef,
  cameraOpen,
  cameraPermissionPhase = 'granted',
  onRequestCamera,
  scanBusy,
  shutterFlash,
  examTitle,
  documentPolygon,
  guideRect,
  aligned,
  stableProgress,
  lowLight,
  cameraFullscreenMode = 'none',
  flashMode,
  flashOn,
  flashSupported,
  onRetryCamera,
  onVideoMount,
  captureReady = false,
  fiducialCount = 0,
  fiducialCorners = [false, false, false, false],
  stripAligned = false,
  autoShutterEnabled = true,
  scanPreviewUrl = null,
  scanPreviewOverlay = null,
  scanPreviewOrangeFrame = null,
  scanStatusLabel = 'Leyendo respuestas…',
}: ExamScannerScreenProps) {
  const documentVisible = documentPolygon !== null && documentPolygon.length === 4;
  const showingScan = Boolean(scanPreviewUrl);
  const showPermissionGate = !cameraOpen && cameraPermissionPhase !== 'granted';

  const phase = useMemo(
    () =>
      deriveDetectionPhase({
        documentVisible,
        aligned,
        stableProgress,
        scanBusy,
        lowLight,
      }),
    [documentVisible, aligned, stableProgress, scanBusy, lowLight]
  );

  const statusLabel = useMemo(
    () => deriveStatusLabel(phase, stableProgress),
    [phase, stableProgress]
  );

  const progress = scanBusy ? 1 : stableProgress;

  // Sin zoom CSS: el transform rompe el mapeo marco naranja → píxeles del sensor.
  const cameraZoomStyle = useMemo(
    () =>
      ({
        transform: 'translate3d(0,0,0) scale(1)',
        willChange: 'auto',
      }) as const,
    []
  );

  if (showPermissionGate) {
    return (
      <div
        ref={shellRef as RefObject<HTMLDivElement> | undefined}
        className={cn(
          'exam-scanner-root fixed inset-0 z-[100000] overflow-hidden',
          cameraFullscreenMode === 'pseudo' && EXAM_PSEUDO_FULLSCREEN_CLASS
        )}
      >
        <CameraPermissionGate
          examTitle={examTitle}
          denied={cameraPermissionPhase === 'denied'}
          requesting={cameraPermissionPhase === 'requesting'}
          onRequest={() => onRequestCamera?.()}
          onClose={() => runScannerAction(actionsRef.current, 'close')}
        />
      </div>
    );
  }

  return (
    <div
      ref={shellRef as RefObject<HTMLDivElement> | undefined}
      className={cn(
        'exam-scanner-root fixed inset-0 z-[100000] overflow-hidden bg-black text-white',
        cameraFullscreenMode === 'pseudo' && EXAM_PSEUDO_FULLSCREEN_CLASS
      )}
    >
      {!cameraOpen ? (
        <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 p-6">
          <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          <p className="text-sm text-white/75">Abriendo cámara…</p>
          <Button type="button" variant="secondary" className="w-full max-w-xs" onClick={onRetryCamera}>
            Reintentar cámara
          </Button>
        </div>
      ) : (
        <>
          <div className={cn('absolute inset-0 overflow-hidden', showingScan && 'invisible')}>
            <div
              ref={viewportRef as RefObject<HTMLDivElement> | undefined}
              className="absolute inset-0"
              style={cameraZoomStyle}
            >
              <CameraView videoRef={videoRef} onVideoMount={onVideoMount} />
              <OverlayRenderer
                phase={phase}
                documentPolygon={documentPolygon}
                guideRect={guideRect}
                stableProgress={progress}
                fiducialCorners={fiducialCorners}
                stripAligned={stripAligned}
              />
            </div>
          </div>

          {showingScan ? (
            <div className="absolute inset-0 z-[100004] flex flex-col bg-orange-50/95">
              <div className="relative min-h-0 flex-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={scanPreviewUrl!}
                  alt=""
                  className="absolute inset-0 h-full w-full object-contain"
                />
                {scanPreviewOverlay ? (
                  <div className="pointer-events-none absolute inset-0 z-[2]">{scanPreviewOverlay}</div>
                ) : null}
              </div>
              <div className="shrink-0 border-t border-orange-100 bg-white/95 px-4 py-3 backdrop-blur-md">
                <div className="flex items-center justify-center gap-2.5">
                  <Loader2
                    className="h-5 w-5 animate-spin text-orange-600 motion-reduce:animate-none"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-gray-800">{scanStatusLabel}</p>
                </div>
              </div>
            </div>
          ) : null}

          <header
            className="exam-scanner-topbar fixed inset-x-0 top-0 z-[100008] flex items-start gap-2.5 px-3"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
          >
            <button
              type="button"
              data-scanner-action="close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md active:scale-95"
              aria-label="Cerrar escáner"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runScannerAction(actionsRef.current, 'close');
              }}
              onTouchEnd={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runScannerAction(actionsRef.current, 'close');
              }}
            >
              <X className="h-5 w-5" strokeWidth={2.5} />
            </button>
            {!showingScan ? (
              <div className="min-w-0 flex-1">
                <StatusCard
                  examTitle={examTitle}
                  statusLabel={statusLabel}
                  stableProgress={progress}
                  phase={phase}
                  fiducialCount={fiducialCount}
                  stripAligned={stripAligned}
                  captureReady={captureReady}
                  autoShutterEnabled={autoShutterEnabled}
                  onTapCapture={
                    captureReady && !scanBusy
                      ? () => runScannerAction(actionsRef.current, 'capture')
                      : undefined
                  }
                />
              </div>
            ) : (
              <div className="min-w-0 flex-1 rounded-2xl bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-md">
                <p className="truncate text-xs font-medium uppercase tracking-wide text-gray-500">
                  {examTitle}
                </p>
                <p className="truncate text-sm font-semibold text-gray-900">{scanStatusLabel}</p>
              </div>
            )}
          </header>

          {!showingScan ? (
            <ScanHud
              flashMode={flashMode}
              flashOn={flashOn}
              flashSupported={flashSupported}
              captureReady={captureReady}
              disabled={scanBusy}
              actionsRef={actionsRef}
            />
          ) : null}

          <CaptureFlash active={shutterFlash} />

          {scanBusy && !showingScan ? (
            <div
              className="pointer-events-none fixed inset-0 z-[100005] flex items-center justify-center bg-orange-50/90"
              aria-live="polite"
            >
              <div className="rounded-2xl bg-white px-5 py-4 text-center shadow-xl">
                <Loader2
                  className="mx-auto h-9 w-9 animate-spin text-orange-600 motion-reduce:animate-none [animation-duration:650ms]"
                  aria-hidden
                />
                <p className="mt-2 text-sm font-semibold text-gray-900">{scanStatusLabel}</p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
