import { supabase } from '@/lib/supabase';

const CLIENT_STORAGE_KEY = 'califacil.calificar.client_id';
const HEARTBEAT_MS = 15_000;
const LIST_POLL_MS = 12_000;

export type CalificarLockAcquireResult = {
  ok: boolean;
  error?: string;
  fresh?: boolean;
  resume?: boolean;
  stolen?: boolean;
  holder_label?: string | null;
  last_heartbeat_at?: string;
};

export type CalificarActiveLock = {
  exam_id: string;
  holder_client_id: string;
  holder_label: string | null;
  last_heartbeat_at: string;
};

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Id estable por pestaña (sessionStorage): cada persona/pestaña es un “cliente”. */
export function getOrCreateCalificarClientId(): string {
  if (typeof window === 'undefined') return randomUuid();
  try {
    const existing = sessionStorage.getItem(CLIENT_STORAGE_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id = randomUuid();
    sessionStorage.setItem(CLIENT_STORAGE_KEY, id);
    return id;
  } catch {
    return randomUuid();
  }
}

export function calificarClientLabel(): string {
  if (typeof navigator === 'undefined') return 'Sesión';
  const ua = navigator.userAgent || '';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return 'Navegador';
}

export async function acquireCalificarExamLock(
  examId: string,
  clientId: string,
  label?: string
): Promise<CalificarLockAcquireResult> {
  const { data, error } = await supabase.rpc('acquire_calificar_exam_lock', {
    p_exam_id: examId,
    p_client_id: clientId,
    p_label: label ?? calificarClientLabel(),
  });
  if (error) {
    return { ok: false, error: error.message || 'rpc_error' };
  }
  return (data ?? { ok: false, error: 'empty' }) as CalificarLockAcquireResult;
}

export async function heartbeatCalificarExamLock(
  examId: string,
  clientId: string
): Promise<CalificarLockAcquireResult> {
  const { data, error } = await supabase.rpc('heartbeat_calificar_exam_lock', {
    p_exam_id: examId,
    p_client_id: clientId,
  });
  if (error) {
    return { ok: false, error: error.message || 'rpc_error' };
  }
  return (data ?? { ok: false, error: 'empty' }) as CalificarLockAcquireResult;
}

export async function releaseCalificarExamLock(
  examId: string,
  clientId: string
): Promise<void> {
  try {
    await supabase.rpc('release_calificar_exam_lock', {
      p_exam_id: examId,
      p_client_id: clientId,
    });
  } catch {
    /* best-effort */
  }
}

export async function listActiveCalificarExamLocks(): Promise<CalificarActiveLock[]> {
  const { data, error } = await supabase.rpc('list_active_calificar_exam_locks');
  if (error) return [];
  const payload = data as { ok?: boolean; locks?: CalificarActiveLock[] } | null;
  if (!payload?.ok || !Array.isArray(payload.locks)) return [];
  return payload.locks;
}

export { HEARTBEAT_MS, LIST_POLL_MS };
