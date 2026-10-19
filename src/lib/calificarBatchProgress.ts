'use client';

import { useSyncExternalStore } from 'react';

export type CalificarBatchProgress = {
  running: boolean;
  status: string;
};

const empty: CalificarBatchProgress = { running: false, status: '' };

let snapshot: CalificarBatchProgress = empty;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function publishCalificarBatchProgress(next: Partial<CalificarBatchProgress>) {
  const running = next.running ?? snapshot.running;
  const status = next.status ?? snapshot.status;
  if (running === snapshot.running && status === snapshot.status) return;
  snapshot = { running, status };
  emit();
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
