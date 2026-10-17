/**
 * Yields que no se congelan cuando la pestaña está en segundo plano.
 * rAF / setTimeout largos se throttlean fuerte al minimizar; MessageChannel no.
 */

/** True si la pestaña no está visible (minimizada, otra app, otra pestaña). */
export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Cede el hilo un momento sin depender de requestAnimationFrame.
 * En segundo plano evita la espera de ~1s por frame del navegador.
 */
export function yieldMacrotask(): Promise<void> {
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
 * Para pintar spinner solo cuando la UI es visible.
 * En background: yield rápido (MessageChannel).
 * En foreground: un frame + micro-espera corta (sin doble rAF + 16ms fijos).
 */
export function yieldForBatchUi(forcePaint = false): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!forcePaint && isDocumentHidden()) {
    return yieldMacrotask();
  }
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      window.setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => {
      // Un solo frame basta; evita cascada rAF+rAF+16ms (~50ms+ por página).
      resolve();
    });
  });
}

/** Mantiene la pantalla despierta durante lotes largos (reduce throttling en móvil). */
export async function requestBatchWakeLock(): Promise<{ release: () => Promise<void> }> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const wakeApi = nav && 'wakeLock' in nav ? (nav as Navigator & {
    wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (t: string, fn: () => void) => void }> };
  }).wakeLock : null;

  if (!wakeApi) {
    return { release: async () => undefined };
  }

  let sentinel: { release: () => Promise<void> } | null = null;
  const acquire = async () => {
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
