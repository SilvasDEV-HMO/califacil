import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { supabase as supabaseBrowser } from '@/lib/supabase';

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'http://127.0.0.1:54321';
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  '00000000-0000-0000-0000-000000000000';

/**
 * Cliente Supabase que actúa como el usuario del Bearer token (RLS del maestro).
 */
export function createSupabaseRouteClient(request: NextRequest) {
  const auth = request.headers.get('Authorization')?.trim();
  return createClient(url, anonKey, {
    global: {
      headers: auth ? { Authorization: auth } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** Sesión válida; la propiedad del recurso (p. ej. exam.teacher_id) define permisos. */
export async function requireSessionUser(request: NextRequest): Promise<
  | { user: { id: string }; supabase: ReturnType<typeof createSupabaseRouteClient> }
  | { response: NextResponse }
> {
  const auth = request.headers.get('Authorization')?.trim();
  if (!auth?.startsWith('Bearer ')) {
    return { response: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) };
  }

  const supabase = createSupabaseRouteClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Sesión inválida' }, { status: 401 }) };
  }

  return { user: { id: user.id }, supabase };
}

/** Headers para fetch desde el dashboard con la sesión actual. */
export async function dashboardAuthJsonHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}
