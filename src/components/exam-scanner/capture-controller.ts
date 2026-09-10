export const CAPTURE_STABLE_TICKS_REQUIRED = 2;
/** Ticks consecutivos con hoja lista (~50 ms) antes del disparo automático. */
export const MOBILE_CAPTURE_STABLE_TICKS_REQUIRED = 1;

export type AutoCaptureGate = {
  autoShutterEnabled: boolean;
  captureBusy: boolean;
  stableTicks: number;
  requiredTicks?: number;
};

/** Indica si se debe disparar la captura automática (sin efectos secundarios). */
export function shouldTriggerAutoCapture({
  autoShutterEnabled,
  captureBusy,
  stableTicks,
  requiredTicks = CAPTURE_STABLE_TICKS_REQUIRED,
}: AutoCaptureGate): boolean {
  return autoShutterEnabled && !captureBusy && stableTicks >= requiredTicks;
}

export function mobileCaptureMinResolvedRows(omrRowCount: number): number {
  return Math.max(5, Math.ceil(omrRowCount * 0.55));
}
