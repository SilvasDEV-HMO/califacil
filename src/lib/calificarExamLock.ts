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

async function listCalificarCompletedExamIdsFromRpc(): Promise<string[]> {
  const { data, error } = await supabase.rpc('list_calificar_completed_exam_ids');
  if (error) return [];
  const payload = data as { ok?: boolean; exam_ids?: string[] | null } | null;
  if (!payload?.ok || !Array.isArray(payload.exam_ids)) return [];
  return payload.exam_ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Fallback / refuerzo: un examen está completo si, en cada grupo donde ya hay
 * al menos una respuesta, todos los alumnos de ese grupo tienen respuestas.
 * Cubre desajustes examen↔grupo (p. ej. título «copia» vs alumnos del grupo original).
 */
async function listCalificarCompletedExamIdsClientSide(): Promise<string[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return [];

  const { data: exams, error: examsError } = await supabase
    .from('exams')
    .select('id, group_id')
    .eq('teacher_id', user.id)
    .eq('status', 'published');
  if (examsError || !exams?.length) return [];

  const examIds = exams.map((e) => e.id as string);
  const answerRows: { exam_id: string; student_id: string }[] = [];
  const chunkSize = 80;
  for (let i = 0; i < examIds.length; i += chunkSize) {
    const chunk = examIds.slice(i, i + chunkSize);
    const { data, error: answersError } = await supabase
      .from('answers')
      .select('exam_id, student_id')
      .in('exam_id', chunk);
    if (answersError) return [];
    for (const row of data ?? []) {
      answerRows.push({
        exam_id: row.exam_id as string,
        student_id: row.student_id as string,
      });
    }
  }
  if (!answerRows.length) return [];

  const gradedByExam = new Map<string, Set<string>>();
  const studentIds = new Set<string>();
  for (const row of answerRows) {
    const examId = row.exam_id as string;
    const studentId = row.student_id as string;
    if (!examId || !studentId) continue;
    studentIds.add(studentId);
    let set = gradedByExam.get(examId);
    if (!set) {
      set = new Set();
      gradedByExam.set(examId, set);
    }
    set.add(studentId);
  }
  if (studentIds.size === 0) return [];

  const studentIdList = [...studentIds];
  const gradedStudents: { id: string; group_id: string | null }[] = [];
  for (let i = 0; i < studentIdList.length; i += chunkSize) {
    const chunk = studentIdList.slice(i, i + chunkSize);
    const { data, error: studentsError } = await supabase
      .from('students')
      .select('id, group_id')
      .in('id', chunk);
    if (studentsError) return [];
    for (const s of data ?? []) {
      gradedStudents.push({
        id: s.id as string,
        group_id: (s.group_id as string | null) ?? null,
      });
    }
  }
  if (!gradedStudents.length) return [];

  const groupByStudent = new Map<string, string>();
  for (const s of gradedStudents) {
    if (!s.group_id) continue;
    groupByStudent.set(s.id, s.group_id);
  }
  const activeGroupsByExam = new Map<string, Set<string>>();
  for (const [examId, graded] of gradedByExam) {
    const groups = new Set<string>();
    for (const sid of graded) {
      const gid = groupByStudent.get(sid);
      if (gid) groups.add(gid);
    }
    if (groups.size > 0) activeGroupsByExam.set(examId, groups);
  }
  if (activeGroupsByExam.size === 0) return [];

  const allActiveGroupIds = [
    ...new Set([...activeGroupsByExam.values()].flatMap((g) => [...g])),
  ];
  const { data: roster, error: rosterError } = await supabase
    .from('students')
    .select('id, group_id')
    .in('group_id', allActiveGroupIds);
  if (rosterError || !roster?.length) return [];

  const rosterByGroup = new Map<string, string[]>();
  for (const s of roster) {
    const gid = s.group_id as string;
    const sid = s.id as string;
    const list = rosterByGroup.get(gid) ?? [];
    list.push(sid);
    rosterByGroup.set(gid, list);
  }

  const completed: string[] = [];
  for (const [examId, groups] of activeGroupsByExam) {
    const graded = gradedByExam.get(examId);
    if (!graded) continue;
    let ok = true;
    let expected = 0;
    for (const gid of groups) {
      const members = rosterByGroup.get(gid) ?? [];
      if (members.length === 0) continue;
      expected += members.length;
      for (const sid of members) {
        if (!graded.has(sid)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok && expected > 0) completed.push(examId);
  }
  return completed;
}

/** Exámenes con todos los alumnos del grupo ya calificados (ocultar en Calificar). */
export async function listCalificarCompletedExamIds(): Promise<string[]> {
  const [fromRpc, fromClient] = await Promise.all([
    listCalificarCompletedExamIdsFromRpc(),
    listCalificarCompletedExamIdsClientSide(),
  ]);
  return [...new Set([...fromRpc, ...fromClient])];
}

export { HEARTBEAT_MS, LIST_POLL_MS };
