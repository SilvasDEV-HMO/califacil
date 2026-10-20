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

async function loadStudentsForExam(exam: Exam): Promise<Student[]> {
  const { data: assignmentData } = await supabase
    .from('exam_group_assignments')
    .select('group_id')
    .eq('exam_id', exam.id);
  const assigned = (assignmentData || [])
    .map((row) => row.group_id as string)
    .filter(Boolean);
  const examGroupIds = assigned.length > 0 ? assigned : exam.group_id ? [exam.group_id] : [];
  if (examGroupIds.length === 0) return [];

  const pageSize = 1000;
  const loaded: Student[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .in('group_id', examGroupIds)
      .range(from, from + pageSize - 1);
    if (error) break;
    loaded.push(...((data || []) as Student[]));
    if (!data || data.length < pageSize) break;
  }
  return loaded.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function loadAlreadyGraded(examId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;
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
  return ids;
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
    loadStudentsForExam(examRow),
    loadAlreadyGraded(examRow.id),
  ]);
  const exam: ExamWithQuestions = { ...examRow, questions };
  return buildCalificarExamBundle(exam, students, alreadyGraded, email);
}
