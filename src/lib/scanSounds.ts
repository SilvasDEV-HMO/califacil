/**
 * Sonidos discretos para el escaneo en vivo (Web Audio API; no requiere archivos).
 * Muchos navegadores exigen gesto del usuario antes de reproducir: se reanuda el contexto al abrir cámara.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

/** Llamar tras interacción del usuario (p. ej. al abrir cámara) para desbloquear audio en iOS/Safari. */
export function resumeScanAudioContext(): void {
  const ctx = getCtx();
  if (ctx?.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
}

function beep(
  frequencyHz: number,
  durationMs: number,
  gain: number,
  when: number
): void {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequencyHz, when);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, when + durationMs / 1000);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + durationMs / 1000 + 0.02);
}

/** Pulso corto (opcional; p. ej. feedback puntual). */
export function playScanningPulse(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  beep(880, 45, 0.06, t);
}

let scanningHum: {
  ctx: AudioContext;
  osc: OscillatorNode;
  gain: GainNode;
} | null = null;

/**
 * Tono continuo muy bajo mientras la hoja aún no está completa (se llama en cada tick; es idempotente).
 */
export function startScanningHum(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (scanningHum) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(380, ctx.currentTime);
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.15);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start();
  scanningHum = { ctx, osc, gain: g };
}

export function stopScanningHum(): void {
  if (!scanningHum) return;
  const { ctx, osc, gain } = scanningHum;
  const t = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  } catch {
    gain.gain.setValueAtTime(0, t);
  }
  try {
    osc.stop(t + 0.14);
  } catch {
    /* ya detenido */
  }
  scanningHum = null;
}

/** Dos tonos ascendentes cuando la hoja tiene todas las respuestas leídas. */
export function playScanCompleteChime(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  beep(523.25, 90, 0.1, t);
  beep(659.25, 110, 0.11, t + 0.12);
}
