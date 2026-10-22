'use client';

import { useSyncExternalStore } from 'react';

export type CalificarBatchProgress = {
  running: boolean;
  status: string;
};

const empty: CalificarBatchProgress = { running: false, status: '' };

let snapshot: CalificarBatchProgress = empty;
const listeners = new Set<() => void>();
let originalDocumentTitle: string | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export function publishCalificarBatchProgress(next: Partial<CalificarBatchProgress>) {
  const running = next.running ?? snapshot.running;
  const status = next.status ?? snapshot.status;
  if (running === snapshot.running && status === snapshot.status) return;
  snapshot = { running, status };
  emit();
  if (typeof document === 'undefined') return;
  if (running) {
    if (originalDocumentTitle == null) originalDocumentTitle = document.title;
    const short = status.trim().slice(0, 80);
    document.title = short ? `Calificando · ${short}` : 'Calificando…';
  } else if (originalDocumentTitle != null) {
    document.title = originalDocumentTitle;
    originalDocumentTitle = null;
  }
}

export function getCalificarBatchProgress(): CalificarBatchProgress {
  return snapshot;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useCalificarBatchProgress(): CalificarBatchProgress {
  return useSyncExternalStore(subscribe, getCalificarBatchProgress, getCalificarBatchProgress);
}
