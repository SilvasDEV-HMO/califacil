import 'server-only';

import { createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/examRetake';

export const LOGIN_FAILS_BEFORE_LOCK = 3;
export const LOGIN_LOCK_STEP_MINUTES = 10;

export type LoginThrottleStatus = {
  locked: boolean;
  retryAfterSeconds: number;
  attemptsLeft: number;
  nextLockMinutes: number;
  lockRound: number;
};

type ThrottleRow = {
  ip_hash: string;
  fail_count: number;
  lock_round: number;
  locked_until: string | null;
  updated_at: string;
};

function hashIp(ip: string): string {
  return createHash('sha256').update(`califacil-login-v1:${ip}`).digest('hex');
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  return 'unknown';
}

function emptyStatus(): LoginThrottleStatus {
  return {
    locked: false,
    retryAfterSeconds: 0,
    attemptsLeft: LOGIN_FAILS_BEFORE_LOCK,
    nextLockMinutes: LOGIN_LOCK_STEP_MINUTES,
    lockRound: 0,
  };
}

function statusFromRow(row: ThrottleRow, now: Date): LoginThrottleStatus {
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
  const locked = Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
  const retryAfterSeconds = locked
    ? Math.max(1, Math.ceil((lockedUntil!.getTime() - now.getTime()) / 1000))
    : 0;
  const failCount = locked ? 0 : row.fail_count;
  const nextLockMinutes = (row.lock_round + 1) * LOGIN_LOCK_STEP_MINUTES;
  return {
    locked,
    retryAfterSeconds,
    attemptsLeft: Math.max(0, LOGIN_FAILS_BEFORE_LOCK - failCount),
    nextLockMinutes,
    lockRound: row.lock_round,
  };
}

async function loadRow(ipHash: string): Promise<ThrottleRow | null> {
  const admin = createServiceRoleClient();
  if (!admin) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY para el límite de login.');
  }
  const { data, error } = await admin
    .from('login_ip_throttle')
    .select('ip_hash,fail_count,lock_round,locked_until,updated_at')
    .eq('ip_hash', ipHash)
    .maybeSingle();
  if (error) throw error;
  return (data as ThrottleRow | null) ?? null;
}

async function saveRow(row: Omit<ThrottleRow, 'updated_at'>): Promise<ThrottleRow> {
  const admin = createServiceRoleClient();
  if (!admin) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY para el límite de login.');
  }
  const payload = { ...row, updated_at: new Date().toISOString() };
  const { data, error } = await admin
    .from('login_ip_throttle')
    .upsert(payload, { onConflict: 'ip_hash' })
    .select('ip_hash,fail_count,lock_round,locked_until,updated_at')
    .single();
  if (error) throw error;
  return data as ThrottleRow;
}

export async function getLoginThrottle(ip: string): Promise<LoginThrottleStatus> {
  const row = await loadRow(hashIp(ip));
  if (!row) return emptyStatus();
  return statusFromRow(row, new Date());
}

export async function assertLoginNotLocked(ip: string): Promise<LoginThrottleStatus> {
  const status = await getLoginThrottle(ip);
  if (status.locked) {
    const err = new Error('LOGIN_LOCKED') as Error & { status: LoginThrottleStatus };
    err.status = status;
    throw err;
  }
  return status;
}

export async function recordLoginFailure(ip: string): Promise<LoginThrottleStatus> {
  const ipHash = hashIp(ip);
  const now = new Date();
  const existing = await loadRow(ipHash);
  if (existing) {
    const current = statusFromRow(existing, now);
    if (current.locked) return current;
  }

  const failCount = (existing?.fail_count ?? 0) + 1;
  let lockRound = existing?.lock_round ?? 0;
  let lockedUntil: string | null = null;
  let storedFailCount = failCount;

  if (failCount >= LOGIN_FAILS_BEFORE_LOCK) {
    lockRound += 1;
    storedFailCount = 0;
    lockedUntil = new Date(
      now.getTime() + lockRound * LOGIN_LOCK_STEP_MINUTES * 60 * 1000
    ).toISOString();
  }

  const saved = await saveRow({
    ip_hash: ipHash,
    fail_count: storedFailCount,
    lock_round: lockRound,
    locked_until: lockedUntil,
  });
  return statusFromRow(saved, now);
}

export async function recordLoginSuccess(ip: string): Promise<void> {
  const ipHash = hashIp(ip);
  const existing = await loadRow(ipHash);
  if (!existing) return;
  await saveRow({
    ip_hash: ipHash,
    fail_count: 0,
    lock_round: 0,
    locked_until: null,
  });
}

export function isInvalidLoginCredentials(message: string | undefined | null): boolean {
  const t = (message ?? '').toLowerCase();
  return (
    t.includes('invalid login') ||
    t.includes('invalid credentials') ||
    t.includes('invalid email or password') ||
    t.includes('usuario o contraseña')
  );
}

export function formatLoginLockMessage(status: LoginThrottleStatus): string {
  const totalSec = status.retryAfterSeconds;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const wait =
    minutes > 0
      ? `${minutes} minuto${minutes === 1 ? '' : 's'}${seconds > 0 ? ` y ${seconds} segundo${seconds === 1 ? '' : 's'}` : ''}`
      : `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  return `Demasiados intentos fallidos desde esta red. Espera ${wait} para volver a intentar.`;
}
