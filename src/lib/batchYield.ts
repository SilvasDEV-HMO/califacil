/**
 * Yields que no se congelan cuando la pestaña está en segundo plano.
 * rAF / setTimeout largos se throttlean fuerte al minimizar; MessageChannel no.
 * Chrome congela pestañas minimizadas salvo que haya audio o un worker activo.
 */

/** True si la pestaña no está visible (minimizada, otra app, otra pestaña). */
export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

let keepAliveWorker: Worker | null = null;
let keepAliveWaiters: Array<() => void> = [];

function flushKeepAliveWaiters() {
  const q = keepAliveWaiters;
  keepAliveWaiters = [];
  for (const resolve of q) resolve();
}

function yieldViaChannelOrTimeout(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => resolve();
      port2.postMessage(null);
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

/**
 * Cede el hilo un momento sin depender de requestAnimationFrame.
 * En segundo plano evita la espera de ~1s por frame del navegador.
 */
export function yieldMacrotask(): Promise<void> {
  if (keepAliveWorker) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      keepAliveWaiters.push(finish);
      window.setTimeout(finish, 80);
    });
  }
  return yieldViaChannelOrTimeout();
}

/**
 * Para pintar spinner solo cuando la UI es visible.
 * En background: yield rápido (MessageChannel).
 * En foreground: un frame + micro-espera corta (sin doble rAF + 16ms fijos).
 */
export function yieldForBatchUi(_forcePaint = false): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  // Nunca rAF con pestaña oculta: el navegador lo baja a ~1 fps y el lote se congela.
  if (isDocumentHidden()) {
    return yieldMacrotask();
  }
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      window.setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function startSilentAudioKeepAlive(): () => void {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return () => undefined;
  }
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  try {
    ctx = new AudioContext();
    const buffer = ctx.createBuffer(1, Math.max(1, ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 64) {
      data[i] = (Math.random() - 0.5) * 0.00008;
    }
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.0004;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    void ctx.resume();
  } catch {
    ctx = null;
    source = null;
  }
  const resume = () => {
    void ctx?.resume();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', resume);
  }
  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', resume);
    }
    try {
      source?.stop();
    } catch {
      /* ignore */
    }
    void ctx?.close();
    ctx = null;
    source = null;
  };
}

function startKeepAliveWorker(): () => void {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    return () => undefined;
  }
  try {
    const blob = new Blob(
      [
        `setInterval(function () { postMessage(1); }, 40);`,
      ],
      { type: 'text/javascript' }
    );
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    keepAliveWorker = worker;
    worker.onmessage = () => {
      flushKeepAliveWaiters();
    };
    return () => {
      keepAliveWorker = null;
      flushKeepAliveWaiters();
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    keepAliveWorker = null;
    return () => undefined;
  }
}

/**
 * Mantiene el lote vivo con pestaña minimizada: audio casi inaudible (Chrome no
 * congela pestañas con audio), worker de pulso y wake lock de pantalla.
 */
export async function requestBatchWakeLock(): Promise<{ release: () => Promise<void> }> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const wakeApi = nav && 'wakeLock' in nav ? (nav as Navigator & {
    wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (t: string, fn: () => void) => void }> };
  }).wakeLock : null;

  const stopAudio = startSilentAudioKeepAlive();
  const stopWorker = startKeepAliveWorker();

  let sentinel: { release: () => Promise<void> } | null = null;
  const acquire = async () => {
    if (!wakeApi) return;
    try {
      sentinel = await wakeApi.request('screen');
    } catch {
      sentinel = null;
    }
  };
  await acquire();

  const onVisible = () => {
    if (document.visibilityState === 'visible') void acquire();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  return {
    release: async () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      stopWorker();
      stopAudio();
      try {
        await sentinel?.release();
      } catch {
        /* ignore */
      }
      sentinel = null;
    },
  };
}

/** Ejecuta async sobre ítems con concurrencia limitada (orden de resultados = orden de entrada). */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const results = new Array<R>(n);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, n));

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= n) return;
        results[i] = await fn(items[i]!, i);
      }
    })
  );
  return results;
}
