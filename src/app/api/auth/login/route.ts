import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { ensureIthTeacherAccount } from '@/lib/ithTeacherProvision';
import { isCalifacilIthEmail, normalizeAuthEmail } from '@/lib/ithAuth';
import {
  assertLoginNotLocked,
  clientIpFromRequest,
  formatLoginLockMessage,
  getLoginThrottle,
  isInvalidLoginCredentials,
  recordLoginFailure,
  recordLoginSuccess,
  type LoginThrottleStatus,
} from '@/lib/loginIpThrottle';

export const runtime = 'nodejs';

type LoginBody = { email?: string; password?: string };

function jsonError(
  message: string,
  status: number,
  extra?: { throttle?: LoginThrottleStatus; hint?: string }
) {
  return NextResponse.json(
    {
      error: message,
      locked: extra?.throttle?.locked ?? false,
      retryAfterSeconds: extra?.throttle?.retryAfterSeconds ?? 0,
      attemptsLeft: extra?.throttle?.attemptsLeft,
      nextLockMinutes: extra?.throttle?.nextLockMinutes,
      hint: extra?.hint,
    },
    { status }
  );
}

function supabaseAuthServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function GET(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const throttle = await getLoginThrottle(ip);
    return NextResponse.json({
      locked: throttle.locked,
      retryAfterSeconds: throttle.retryAfterSeconds,
      attemptsLeft: throttle.attemptsLeft,
      nextLockMinutes: throttle.nextLockMinutes,
      message: throttle.locked ? formatLoginLockMessage(throttle) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo consultar el límite de login.';
    return jsonError(message, 503);
  }
}

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return jsonError('JSON inválido', 400);
  }

  const email = normalizeAuthEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return jsonError('Ingresa correo y contraseña.', 400);
  }

  const ip = clientIpFromRequest(request);

  try {
    await assertLoginNotLocked(ip);
  } catch (err) {
    const locked = err as Error & { status?: LoginThrottleStatus };
    if (locked.message === 'LOGIN_LOCKED' && locked.status) {
      return jsonError(formatLoginLockMessage(locked.status), 429, { throttle: locked.status });
    }
    /* Sin service_role válida el anti-fuerza bruta no corre; el login con anon sí. */
  }

  const auth = supabaseAuthServer();
  let { data, error } = await auth.auth.signInWithPassword({ email, password });

  if (
    error &&
    isCalifacilIthEmail(email) &&
    /confirm|verif/i.test(error.message || '')
  ) {
    const repaired = await ensureIthTeacherAccount({ email, password });
    if (!repaired.ok) {
      return jsonError(repaired.error, repaired.hint ? 503 : 400, { hint: repaired.hint });
    }
    ({ data, error } = await auth.auth.signInWithPassword({ email, password }));
  }

  if (error) {
    if (isInvalidLoginCredentials(error.message)) {
      try {
        const throttle = await recordLoginFailure(ip);
        if (throttle.locked) {
          return jsonError(formatLoginLockMessage(throttle), 429, { throttle });
        }
        return jsonError(
          `Usuario o contraseña incorrectos. Te quedan ${throttle.attemptsLeft} intento${throttle.attemptsLeft === 1 ? '' : 's'} antes de un bloqueo de ${throttle.nextLockMinutes} minutos.`,
          401,
          { throttle }
        );
      } catch (recordErr) {
        const message =
          recordErr instanceof Error ? recordErr.message : 'No se pudo registrar el intento fallido.';
        return jsonError('Usuario o contraseña incorrectos.', 401, { hint: message });
      }
    }
    return jsonError(error.message || 'No se pudo iniciar sesión.', 400);
  }

  const session = data.session;
  if (!session) {
    return jsonError('No se pudo crear la sesión.', 500);
  }

  try {
    await recordLoginSuccess(ip);
  } catch {
    /* El login ya fue válido; no bloquear por fallo al limpiar el contador. */
  }

  return NextResponse.json({
    ok: true,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user: { id: data.user?.id ?? null, email: data.user?.email ?? null },
  });
}
