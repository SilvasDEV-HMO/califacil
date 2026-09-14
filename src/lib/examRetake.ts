import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VoidedAttemptRow } from '@/lib/examRetake.types';
import { isUsableSupabaseServiceRoleKey } from '@/lib/supabaseServiceRole';

export type { VoidedAttemptRow } from '@/lib/examRetake.types';

export type GrantExamRetakeResult =
  | { ok: true }
  | { ok: false; error: string; hint?: string };

export type ListVoidedAttemptsResult =
  | { ok: true; attempts: VoidedAttemptRow[] }
  | { ok: false; error: string; hint?: string };

export function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !isUsableSupabaseServiceRoleKey(key)) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapRpcGrantError(code: string | undefined): GrantExamRetakeResult {
  switch (code) {
    case 'not_voided':
      return { ok: false, error: 'Este intento ya no está anulado.' };
    case 'not_found':
      return { ok: false, error: 'No se encontró el intento del alumno.' };
    case 'not_allowed':
      return {
        ok: false,
        error: 'No tienes permiso para otorgar otra oportunidad en este examen.',
      };
    default:
      return { ok: false, error: code || 'No se pudo otorgar la segunda oportunidad.' };
  }
}

async function listVoidedViaServiceRpc(
  admin: SupabaseClient,
  examId: string,
  teacherId: string
): Promise<ListVoidedAttemptsResult> {
  const { data, error } = await admin.rpc('list_voided_attempts_for_teacher_exam', {
    p_exam_id: examId,
    p_teacher_id: teacherId,
  });

  if (error) {
    if (/function|does not exist/i.test(error.message)) {
      return {
        ok: false,
        error: 'Falta la función de exámenes anulados en Supabase.',
        hint: 'Ejecuta la migración 20260620110000_list_voided_attempts_service_rpc.sql en el SQL Editor.',
      };
    }
    return { ok: false, error: error.message };
  }

  const payload = data as { ok?: boolean; attempts?: VoidedAttemptRow[]; error?: string } | null;
  if (payload?.ok) {
    return { ok: true, attempts: payload.attempts ?? [] };
  }
  if (payload?.error === 'not_found') {
    return { ok: false, error: 'Examen no encontrado' };
  }
  return {
    ok: false,
    error: payload?.error || 'No se pudieron cargar los exámenes anulados.',
  };
}

async function listVoidedViaTeacherRpc(
  userScopedSupabase: SupabaseClient,
  examId: string
): Promise<ListVoidedAttemptsResult> {
  const { data, error } = await userScopedSupabase.rpc('teacher_list_voided_attempts', {
    p_exam_id: examId,
  });

  if (error) {
    if (/function|does not exist/i.test(error.message)) {
      return {
        ok: false,
        error: 'Falta configurar la lista de exámenes anulados en Supabase.',
        hint: 'Ejecuta la migración 20260606110000_exam_attempt_events_retake.sql en el SQL Editor.',
      };
    }
    return { ok: false, error: error.message };
  }

  const payload = data as { ok?: boolean; attempts?: VoidedAttemptRow[]; error?: string } | null;
  if (payload?.ok) {
    return { ok: true, attempts: payload.attempts ?? [] };
  }

  if (payload?.error === 'not_allowed' || payload?.error === 'not_authenticated') {
    return {
      ok: false,
      error: 'No se pudo verificar tu sesión para listar exámenes anulados.',
      hint: 'Configura SUPABASE_SERVICE_ROLE_KEY en Vercel (clave service_role de Supabase).',
    };
  }

  return {
    ok: false,
    error: payload?.error || 'No se pudieron cargar los exámenes anulados.',
  };
}

async function grantExamRetakeWithAdmin(
  admin: SupabaseClient,
  examId: string,
  studentId: string
): Promise<GrantExamRetakeResult> {
  const { data: attempt, error: attemptErr } = await admin
    .from('exam_attempts')
    .select('id, state')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (attemptErr) return { ok: false, error: attemptErr.message };
  if (!attempt) return { ok: false, error: 'No se encontró el intento del alumno.' };
  if (attempt.state !== 'voided') {
    return { ok: false, error: 'Este intento ya no está anulado.' };
  }

  const { error: answersErr } = await admin
    .from('answers')
    .delete()
    .eq('exam_id', examId)
    .eq('student_id', studentId);
  if (answersErr) return { ok: false, error: answersErr.message };

  const { error: deleteErr } = await admin.from('exam_attempts').delete().eq('id', attempt.id);
  if (deleteErr) return { ok: false, error: deleteErr.message };

  return { ok: true };
}

export async function listVoidedExamAttempts(
  userScopedSupabase: SupabaseClient,
  examId: string,
  teacherId: string
): Promise<ListVoidedAttemptsResult> {
  const { data: ownedExam, error: ownedErr } = await userScopedSupabase
    .from('exams')
    .select('id')
    .eq('id', examId)
    .eq('teacher_id', teacherId)
    .maybeSingle();

  if (ownedErr) return { ok: false, error: ownedErr.message };
  if (!ownedExam) return { ok: false, error: 'Examen no encontrado' };

  const admin = createServiceRoleClient();
  if (admin) {
    const serviceResult = await listVoidedViaServiceRpc(admin, examId, teacherId);
    if (serviceResult.ok || !/function|does not exist/i.test(serviceResult.error ?? '')) {
      return serviceResult;
    }
  }

  const rpcResult = await listVoidedViaTeacherRpc(userScopedSupabase, examId);
  if (rpcResult.ok) return rpcResult;

  if (!admin) {
    return {
      ok: false,
      error: 'Falta configurar el acceso del servidor a Supabase.',
      hint:
        'En Vercel → Environment Variables agrega SUPABASE_SERVICE_ROLE_KEY con la clave service_role (Supabase → Settings → API). No uses la anon key.',
    };
  }

  return rpcResult;
}

export async function grantExamRetake(
  userScopedSupabase: SupabaseClient,
  examId: string,
  studentId: string
): Promise<GrantExamRetakeResult> {
  const { data, error } = await userScopedSupabase.rpc('teacher_grant_exam_retake', {
    p_exam_id: examId,
    p_student_id: studentId,
  });

  if (!error) {
    const payload = data as { ok?: boolean; error?: string } | null;
    if (payload?.ok) return { ok: true };
    if (payload?.error && payload.error !== 'not_allowed') {
      return mapRpcGrantError(payload.error);
    }
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    if (error?.message && /function|does not exist/i.test(error.message)) {
      return {
        ok: false,
        error: 'Falta configurar la segunda oportunidad en Supabase.',
        hint: 'Ejecuta la migración 20260606110000_exam_attempt_events_retake.sql en el SQL Editor.',
      };
    }
    const rpcError = mapRpcGrantError((data as { error?: string } | null)?.error);
    return {
      ok: false,
      error: error?.message || (rpcError.ok ? 'No se pudo otorgar la segunda oportunidad.' : rpcError.error),
      hint: 'Configura SUPABASE_SERVICE_ROLE_KEY en Vercel con la clave service_role de Supabase.',
    };
  }

  return grantExamRetakeWithAdmin(admin, examId, studentId);
}
