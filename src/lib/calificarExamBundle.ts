import { buildVirtualKeyMaps, type VirtualKeyMaps } from '@/lib/calificarGrading';
import { sortExamQuestions } from '@/lib/examQuestions';
import {
  buildCalifacilVirtualKey,
  CALIFACIL_PRINT_MAX_QUESTIONS,
  chunkQuestions,
  examSupportsCalifacilOmr,
  getCalifacilOmrSheetQuestions,
} from '@/lib/printExam';
import { isLenguaje45Exam } from '@/lib/omr/custom-45/read-sheet';
import { rafSharedGroupNamesFromExamTitle } from '@/lib/rafPdfExamMatch';
import { supabase } from '@/lib/supabase';
import type { Exam, ExamWithQuestions, Question, Student } from '@/types';

export type CalificarExamBundle = {
  examId: string;
  exam: ExamWithQuestions;
  questions: Question[];
  students: Student[];
  alreadyGraded: Set<string>;
  virtualKeyMaps: VirtualKeyMaps;
  virtualKeyIssues: string[];
  sheets: Question[][];
  supportsCalifacil: boolean;
  canGrade: boolean;
};

async function loadQuestions(examId: string): Promise<Question[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('exam_id', examId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return sortExamQuestions((data || []) as Question[]);
}

async function loadStudentsByGroupIds(groupIds: string[]): Promise<Student[]> {
  const unique = Array.from(new Set(groupIds.filter(Boolean)));
  if (unique.length === 0) return [];
  const pageSize = 1000;
  const loaded: Student[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .in('group_id', unique)
      .range(from, from + pageSize - 1);
    if (error) break;
    loaded.push(...((data || []) as Student[]));
    if (!data || data.length < pageSize) break;
  }
  const byId = new Map<string, Student>();
  for (const student of loaded) byId.set(student.id, student);
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Misma CURP (o mismo nombre si no hay CURP) en matutino y vespertino. */
export function rafStudentDedupeKey(student: Student): string {
  const curp = (student.control_number || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (curp.length >= 16) return `c:${curp}`;
  return `n:${(student.name || '').trim().toLowerCase()}`;
}

export function dedupeRafStudents(students: Student[], preferGroupIds: string[] = []): Student[] {
  const preferred = new Set(preferGroupIds.filter(Boolean));
  const byKey = new Map<string, Student>();
  for (const student of students) {
    const key = rafStudentDedupeKey(student);
    if (!key || key === 'n:') {
      byKey.set(`id:${student.id}`, student);
      continue;
    }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, student);
      continue;
    }
    if (preferred.has(student.group_id) && !preferred.has(prev.group_id)) {
      byKey.set(key, student);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function loadAnswersStudentIds(examIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  const unique = Array.from(new Set(examIds.filter(Boolean)));
  const pageSize = 1000;
  for (const examId of unique) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('answers')
        .select('student_id')
        .eq('exam_id', examId)
        .range(from, from + pageSize - 1);
      if (error) break;
      for (const row of data ?? []) ids.add(String(row.student_id));
      if (!data || data.length < pageSize) break;
    }
  }
  return ids;
}

async function loadSharedGroupIds(exam: Exam): Promise<string[]> {
  const { data: assignmentData } = await supabase
    .from('exam_group_assignments')
    .select('group_id')
    .eq('exam_id', exam.id);
  const assigned = (assignmentData || [])
    .map((row) => row.group_id as string)
    .filter(Boolean);
  const ids = assigned.length > 0 ? [...assigned] : exam.group_id ? [exam.group_id] : [];
  const names = rafSharedGroupNamesFromExamTitle(exam.title);
  if (names.length > 0 && exam.teacher_id) {
    const { data: groups } = await supabase
      .from('groups')
      .select('id')
      .eq('teacher_id', exam.teacher_id)
      .in('name', names);
    for (const row of groups || []) ids.push(String((row as { id: string }).id));
  }
  return Array.from(new Set(ids));
}

/** Roster matutino + vespertino del mismo CCT·grupo (el Excel no distingue turno). */
export async function loadStudentsForRafExam(exam: Exam): Promise<Student[]> {
  const groupIds = await loadSharedGroupIds(exam);
  const loaded = await loadStudentsByGroupIds(groupIds);
  return dedupeRafStudents(loaded, exam.group_id ? [exam.group_id] : groupIds.slice(0, 1));
}

/**
 * Solo este examen (1-A V no se da por calificado porque 1-A matutino ya tenga notas).
 */
export async function loadTakenStudentIdsForRafExam(exam: Exam): Promise<Set<string>> {
  return loadAnswersStudentIds([exam.id]);
}

export function buildCalificarExamBundle(
  exam: ExamWithQuestions,
  students: Student[],
  alreadyGraded: Set<string>,
  email: string | null | undefined
): CalificarExamBundle {
  const questions = exam.questions ?? [];
  const omrQuestions = getCalifacilOmrSheetQuestions(questions);
  const virtualKey = buildCalifacilVirtualKey(questions);
  const virtualKeyMaps = buildVirtualKeyMaps(virtualKey.rows);
  const supportsCalifacil = examSupportsCalifacilOmr(questions);
  const sheets =
    omrQuestions.length > 0
      ? chunkQuestions(
          omrQuestions,
          isLenguaje45Exam(email, exam.title, questions)
            ? omrQuestions.length
            : CALIFACIL_PRINT_MAX_QUESTIONS
        )
      : [];
  const mcTotal = questions.filter((q) => q.type === 'multiple_choice').length;
  const canGrade =
    supportsCalifacil &&
    virtualKey.issues.length === 0 &&
    Object.keys(virtualKeyMaps.byQuestionId).length === mcTotal &&
    mcTotal > 0;

  return {
    examId: exam.id,
    exam,
    questions,
    students,
    alreadyGraded,
    virtualKeyMaps,
    virtualKeyIssues: virtualKey.issues,
    sheets,
    supportsCalifacil,
    canGrade,
  };
}

export async function loadCalificarExamBundle(
  examRow: Exam,
  email: string | null | undefined
): Promise<CalificarExamBundle> {
  const [questions, students, alreadyGraded] = await Promise.all([
    loadQuestions(examRow.id),
    loadStudentsForRafExam(examRow),
    loadTakenStudentIdsForRafExam(examRow),
  ]);
  const exam: ExamWithQuestions = { ...examRow, questions };
  return buildCalificarExamBundle(exam, students, alreadyGraded, email);
}
