'use client';

import { cn } from '@/lib/utils';
import type { DocumentDetectionPhase } from '@/components/exam-scanner/types';

type Props = {
  examTitle: string;
  statusLabel: string;
  stableProgress: number;
  phase: DocumentDetectionPhase;
  className?: string;
  onTapCapture?: () => void;
  fiducialCount?: number;
  stripAligned?: boolean;
  captureReady?: boolean;
};

export function StatusCard({
  examTitle,
  statusLabel,
  stableProgress,
  phase,
  className,
  onTapCapture,
  fiducialCount = 0,
  stripAligned = false,
  captureReady = false,
}: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, stableProgress)) * 100);
  const showBar = phase === 'searching' || phase === 'stable';

  if (!onTapCapture) {
    return (
      <div className={cn('exam-scanner-status w-full min-w-0', className)}>
        <StatusCardBody
          examTitle={examTitle}
          statusLabel={statusLabel}
          pct={pct}
          showBar={showBar}
          phase={phase}
          fiducialCount={fiducialCount}
          stripAligned={stripAligned}
          captureReady={captureReady}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-scanner-action="capture"
      className={cn(
        'exam-scanner-status w-full min-w-0 text-left active:scale-[0.99]',
        !captureReady && 'opacity-90',
        className
      )}
      disabled={!captureReady}
      onClick={(event) => {
        if (!captureReady) return;
        event.preventDefault();
        event.stopPropagation();
        onTapCapture();
      }}
      onTouchEnd={(event) => {
        if (!captureReady) return;
        event.preventDefault();
        event.stopPropagation();
        onTapCapture();
      }}
    >
      <StatusCardBody
        examTitle={examTitle}
        statusLabel={statusLabel}
        pct={pct}
        showBar={showBar}
        phase={phase}
        showCaptureHint
        fiducialCount={fiducialCount}
        stripAligned={stripAligned}
        captureReady={captureReady}
      />
    </button>
  );
}

function StatusCardBody({
  examTitle,
  statusLabel,
  pct,
  showBar,
  phase,
  showCaptureHint,
  fiducialCount = 0,
  stripAligned = false,
  captureReady = false,
}: {
  examTitle: string;
  statusLabel: string;
  pct: number;
  showBar: boolean;
  phase: DocumentDetectionPhase;
  showCaptureHint?: boolean;
  fiducialCount?: number;
  stripAligned?: boolean;
  captureReady?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-3.5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md sm:px-4 sm:py-3',
        phase === 'stable' || phase === 'capturing'
          ? 'border-orange-400/40 bg-white/92'
          : phase === 'searching'
            ? 'border-orange-400/35 bg-black/55'
            : 'border-red-400/35 bg-black/55'
      )}
    >
      <p
        className={cn(
          'truncate text-[10px] font-semibold uppercase tracking-[0.14em] sm:text-[11px]',
          phase === 'stable' || phase === 'capturing' ? 'text-gray-500' : 'text-white/70'
        )}
      >
        {examTitle}
      </p>
      <p
        className={cn(
          'mt-0.5 text-[14px] font-medium leading-snug sm:text-[15px]',
          phase === 'stable' || phase === 'capturing' ? 'text-gray-900' : 'text-white'
        )}
      >
        {statusLabel}
      </p>
      <p
        className={cn(
          'mt-1 text-[11px] font-medium tabular-nums',
          phase === 'stable' || phase === 'capturing' ? 'text-gray-500' : 'text-white/75'
        )}
      >
        Cuadros negros: {fiducialCount}/4
        {stripAligned ? ' · Franjas OK' : ''}
        {captureReady && fiducialCount >= 3 ? ' · Listo' : ''}
      </p>
      {showBar && pct > 4 ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/15">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-200 ease-out',
              phase === 'stable' ? 'bg-orange-500' : 'bg-orange-400'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {showCaptureHint ? (
        <p
          className={cn(
            'mt-1.5 text-[11px] font-semibold',
            captureReady ? 'text-orange-600' : 'text-gray-400'
          )}
        >
          {captureReady ? 'Toca para capturar' : stripAligned ? '3 esquinas + franjas laterales' : 'Alinea la hoja en el marco naranja'}
        </p>
      ) : null}
    </div>
  );
}
