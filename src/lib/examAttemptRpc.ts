import { supabase } from '@/lib/supabase';

export type AttemptGetResult = {
  ok?: boolean;
  error?: string;
  state?: 'none' | 'voided' | 'submitted' | 'in_progress' | 'unknown';
  void_reason?: string | null;
  resume?: boolean;
  other_device?: boolean;
};

export type AttemptStartResult = {
  ok?: boolean;
  error?: string;
  void_reason?: string | null;
  fresh?: boolean;
  resume?: boolean;
};

export async function rpcGetStudentExamAttempt(
  examId: string,
  studentId: string,
  clientSession: string | null
): Promise<AttemptGetResult> {
  const { data, error } = await supabase.rpc('get_student_exam_attempt', {
    p_exam_id: examId,
    p_student_id: studentId,
    p_session: clientSession,
  });
  if (error) throw error;
  return (data ?? {}) as AttemptGetResult;
}

export async function rpcStartStudentExamAttempt(
  examId: string,
  studentId: string,
  clientSession: string
): Promise<AttemptStartResult> {
  const { data, error } = await supabase.rpc('start_student_exam_attempt', {
    p_exam_id: examId,
    p_student_id: studentId,
    p_session: clientSession,
  });
  if (error) throw error;
  return (data ?? {}) as AttemptStartResult;
}

export async function rpcVoidStudentExamAttempt(
  examId: string,
  studentId: string,
  clientSession: string,
  reason: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('void_student_exam_attempt', {
    p_exam_id: examId,
    p_student_id: studentId,
    p_session: clientSession,
    p_reason: reason,
  });
  if (error) {
    console.error(error);
    return false;
  }
  return Boolean((data as { ok?: boolean })?.ok);
}

export async function rpcCompleteStudentExamAttempt(
  examId: string,
  studentId: string,
  clientSession: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('complete_student_exam_attempt', {
    p_exam_id: examId,
    p_student_id: studentId,
    p_session: clientSession,
  });
  if (error) throw error;
  return Boolean((data as { ok?: boolean })?.ok);
}

/** Respuestas ya guardadas para (examen, alumno). -1 = no permitido (RPC no aplicada o examen inválido). */
export async function rpcStudentAnswerCount(examId: string, studentId: string): Promise<number> {
  const { data, error } = await supabase.rpc('student_answer_count', {
    p_exam_id: examId,
    p_student_id: studentId,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data);
}
