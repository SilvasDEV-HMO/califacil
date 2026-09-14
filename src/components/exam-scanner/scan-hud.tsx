'use client';

import { type ReactNode, useRef } from 'react';
import { Camera, FileStack, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { runScannerAction, type ScannerActions } from '@/components/exam-scanner/scanner-actions';

type FlashMode = 'auto' | 'on' | 'off';

type Props = {
  flashMode: FlashMode;
  flashOn: boolean;
  flashSupported: boolean;
  captureReady: boolean;
  disabled?: boolean;
  actionsRef: React.MutableRefObject<ScannerActions>;
};

function HudButton({
  label,
  action,
  actionsRef,
  active,
  highlight,
  disabled,
  children,
  large,
}: {
  label: string;
  action: keyof ScannerActions;
  actionsRef: React.MutableRefObject<ScannerActions>;
  active?: boolean;
  highlight?: boolean;
  disabled?: boolean;
  children: ReactNode;
  large?: boolean;
}) {
  const lastTapRef = useRef(0);

  const activate = () => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastTapRef.current < 280) return;
    lastTapRef.current = now;
    runScannerAction(actionsRef.current, action);
  };

  return (
    <button
      type="button"
      data-scanner-action={action}
      className={cn(
        'exam-scanner-hud-btn flex min-h-[52px] min-w-[60px] flex-col items-center justify-center gap-1 rounded-xl px-3 py-2.5 text-[10px] font-semibold text-white',
        large && 'min-h-[58px] min-w-[80px] px-4',
        highlight
          ? 'bg-orange-500 text-white shadow-lg shadow-orange-950/40'
          : active
            ? 'bg-white/25'
            : 'bg-white/15',
        disabled ? 'opacity-50' : 'active:scale-95'
      )}
      aria-label={label}
      aria-disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        activate();
      }}
      onTouchEnd={(event) => {
        event.preventDefault();
        event.stopPropagation();
        activate();
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function ScanHud({
  flashMode,
  flashOn,
  flashSupported,
  captureReady,
  disabled = false,
  actionsRef,
}: Props) {
  return (
    <footer
      className="exam-scanner-hud fixed inset-x-0 bottom-0 z-[100010] flex justify-center"
      style={{
        paddingBottom: 'max(0.85rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="flex items-center gap-2 rounded-[1.4rem] border border-white/20 bg-black/70 px-2.5 py-2 shadow-2xl">
        <HudButton
          label="Cambiar examen"
          action="changeExam"
          actionsRef={actionsRef}
          disabled={disabled}
        >
          <FileStack className="h-5 w-5" strokeWidth={2} />
        </HudButton>
        <HudButton
          label="Capturar"
          action="capture"
          actionsRef={actionsRef}
          highlight={captureReady}
          disabled={disabled || !captureReady}
          large
        >
          <Camera className="h-6 w-6" strokeWidth={2.25} />
        </HudButton>
        <HudButton
          label="Flash"
          action="flash"
          actionsRef={actionsRef}
          active={flashOn || flashMode === 'on'}
          disabled={disabled}
        >
          <span className="relative">
            <Zap
              className={cn(
                'h-5 w-5',
                (flashOn || flashMode === 'on') && 'fill-orange-300 text-orange-300'
              )}
            />
            {flashMode === 'auto' ? (
              <span className="absolute -bottom-1 -right-1 text-[8px] font-bold">A</span>
            ) : null}
          </span>
        </HudButton>
      </div>
      {!flashSupported ? (
        <span className="sr-only">Flash no disponible en este dispositivo</span>
      ) : null}
    </footer>
  );
}
