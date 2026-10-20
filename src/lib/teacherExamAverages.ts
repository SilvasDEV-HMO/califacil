import { supabase } from '@/lib/supabase';
import { calculatePercentage } from '@/lib/utils';
import type { Exam } from '@/types';

export type ExamGroupAverage = {
  groupId: string;
  groupName: string;
  average: number;
  studentsCount: number;
};

export type ExamAverageSummaryRow = {
  examId: string;
  examTitle: string;
  createdAt: string;
  groupAverages: ExamGroupAverage[];
  overallAverage: number;
  totalStudents: number;
};

type StudentAnswerRow = {
  exam_id: string;
  student_id: string;
  score: number | null;
};

type StudentRow = {
  id: string;
  name: string;
  group_id: string;
};

type ExamGroupAssignmentRow = {
  exam_id: string;
  group_id: string;
};

/** Keep PostgREST GET URLs under browser limits (~2k–8k). ~80 UUIDs is safe. */
const EXAM_ID_CHUNK = 80;
const STUDENT_ID_CHUNK = 200;
const PAGE_SIZE = 1000;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function fetchAnswersForExams(examIds: string[]): Promise<StudentAnswerRow[]> {
  const viaRpc = await fetchStudentPointsViaRpc(examIds);
  if (viaRpc) return viaRpc;

  const answers: StudentAnswerRow[] = [];
  for (let i = 0; i < examIds.length; i += EXAM_ID_CHUNK) {
    const examSlice = examIds.slice(i, i + EXAM_ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: answersData, error: answersError } = await supabase
        .from('answers')
        .select('exam_id,student_id,score')
        .in('exam_id', examSlice)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (answersError) throw answersError;
      const batch = (answersData || []) as StudentAnswerRow[];
      answers.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  }
  return answers;
}

async function fetchMaxScoreByExam(examIds: string[]): Promise<Map<string, number>> {
  const maxScoreByExam = new Map<string, number>();
  for (let i = 0; i < examIds.length; i += EXAM_ID_CHUNK) {
    const examSlice = examIds.slice(i, i + EXAM_ID_CHUNK);
    const { data: questionsData, error: questionsError } = await supabase
      .from('questions')
      .select('exam_id,points')
      .in('exam_id', examSlice);
    if (questionsError) throw questionsError;
    for (const row of questionsData || []) {
      const examId = String((row as { exam_id: string; points?: number | null }).exam_id);
      const pts = (row as { points?: number | null }).points ?? 1;
      maxScoreByExam.set(examId, (maxScoreByExam.get(examId) ?? 0) + pts);
    }
  }
  return maxScoreByExam;
}

/**
 * Media de los % de cada examen que ya tiene al menos una calificación:
 * (suma de promedios de exámenes evaluados) / (cantidad de esos exámenes).
 */
export async function fetchTeacherGlobalAveragePercent(
  exams: Exam[]
): Promise<number | null> {
  const { data, error } = await supabase.rpc('teacher_global_grade_average');
  if (!error) {
    const payload = data as { ok?: boolean; percent?: number | null } | null;
    if (payload?.ok) {
      if (payload.percent == null) return null;
      return clampPercent(Number(payload.percent));
    }
  }

  if (exams.length === 0) return null;
  const examIds = exams.map((e) => e.id);
  const answers = await fetchAnswersForExams(examIds);
  if (answers.length === 0) return null;
  const maxScoreByExam = await fetchMaxScoreByExam(examIds);

  const pointsByExamStudent = new Map<string, Map<string, number>>();
  for (const answer of answers) {
    let byStudent = pointsByExamStudent.get(answer.exam_id);
    if (!byStudent) {
      byStudent = new Map<string, number>();
      pointsByExamStudent.set(answer.exam_id, byStudent);
    }
    const prev = byStudent.get(answer.student_id) ?? 0;
    byStudent.set(answer.student_id, prev + (typeof answer.score === 'number' ? answer.score : 0));
  }

  const examPercents: number[] = [];
  for (const exam of exams) {
    const byStudent = pointsByExamStudent.get(exam.id);
    if (!byStudent || byStudent.size === 0) continue;
    const maxScore = Math.max(1, maxScoreByExam.get(exam.id) ?? 0);
    let total = 0;
    for (const points of byStudent.values()) {
      total += clampPercent(calculatePercentage(points, maxScore));
    }
    examPercents.push(clampPercent(total / byStudent.size));
  }

  if (examPercents.length === 0) return null;
  return clampPercent(examPercents.reduce((sum, pct) => sum + pct, 0) / examPercents.length);
}

async function fetchStudentPointsViaRpc(
  examIds: string[]
): Promise<StudentAnswerRow[] | null> {
  const rows: StudentAnswerRow[] = [];
  for (let i = 0; i < examIds.length; i += EXAM_ID_CHUNK) {
    const slice = examIds.slice(i, i + EXAM_ID_CHUNK);
    const { data, error } = await supabase.rpc('teacher_exam_student_scores', {
      p_exam_ids: slice,
    });
    if (error) return null;
    const payload = data as {
      ok?: boolean;
      rows?: Array<{ exam_id: string; student_id: string; points: number }>;
    } | null;
    if (!payload?.ok || !Array.isArray(payload.rows)) return null;
    for (const row of payload.rows) {
      rows.push({
        exam_id: row.exam_id,
        student_id: row.student_id,
        score: Number(row.points) || 0,
      });
    }
  }
  return rows;
}

/**
 * Porcentaje por alumno = puntos / máximo del examen, acotado a 0–100.
 * `globalAveragePercent` = media de los porcentajes de cada examen que ya tiene
 * al menos una calificación (suma de % de exámenes calificados / cantidad de esos exámenes).
 */
export async function fetchTeacherExamAverageSummaries(
  exams: Exam[],
  groupsById: Map<string, string>
): Promise<{ rows: ExamAverageSummaryRow[]; globalAveragePercent: number | null }> {
  if (exams.length === 0) {
    return { rows: [], globalAveragePercent: null };
  }

  const examIds = exams.map((e) => e.id);
  const answers = await fetchAnswersForExams(examIds);
  const maxScoreByExam = await fetchMaxScoreByExam(examIds);

  const studentIds = Array.from(new Set(answers.map((a) => a.student_id)));
  const studentsById = new Map<string, StudentRow>();
  for (let i = 0; i < studentIds.length; i += STUDENT_ID_CHUNK) {
    const slice = studentIds.slice(i, i + STUDENT_ID_CHUNK);
    const { data: studentsData, error: studentsError } = await supabase
      .from('students')
      .select('id,name,group_id')
      .in('id', slice);
    if (studentsError) throw studentsError;
    for (const student of studentsData || []) {
      studentsById.set(student.id, student as StudentRow);
    }
  }

  const assignments: ExamGroupAssignmentRow[] = [];
  for (let i = 0; i < examIds.length; i += EXAM_ID_CHUNK) {
    const examSlice = examIds.slice(i, i + EXAM_ID_CHUNK);
    const { data: assignmentData, error: assignmentError } = await supabase
      .from('exam_group_assignments')
      .select('exam_id,group_id')
      .in('exam_id', examSlice);
    if (assignmentError) throw assignmentError;
    assignments.push(...((assignmentData || []) as ExamGroupAssignmentRow[]));
  }
  const assignedGroupIdsByExam = new Map<string, Set<string>>();
  for (const row of assignments) {
    if (!assignedGroupIdsByExam.has(row.exam_id)) {
      assignedGroupIdsByExam.set(row.exam_id, new Set<string>());
    }
    assignedGroupIdsByExam.get(row.exam_id)!.add(row.group_id);
  }

  const rows: ExamAverageSummaryRow[] = exams.map((exam) => {
    const maxScore = Math.max(1, maxScoreByExam.get(exam.id) ?? 0);
    const byStudent = new Map<string, number>();

    for (const answer of answers) {
      if (answer.exam_id !== exam.id) continue;
      const prev = byStudent.get(answer.student_id) ?? 0;
      byStudent.set(answer.student_id, prev + (typeof answer.score === 'number' ? answer.score : 0));
    }

    const groupCollector = new Map<string, { total: number; count: number }>();
    let overallTotal = 0;
    let overallCount = 0;

    for (const [studentId, points] of Array.from(byStudent.entries())) {
      const student = studentsById.get(studentId);
      if (!student) continue;
      const pct = clampPercent(calculatePercentage(points, maxScore));
      overallTotal += pct;
      overallCount += 1;
      const prev = groupCollector.get(student.group_id) ?? { total: 0, count: 0 };
      groupCollector.set(student.group_id, {
        total: prev.total + pct,
        count: prev.count + 1,
      });
    }

    const assignedGroupIds = assignedGroupIdsByExam.get(exam.id);
    if (assignedGroupIds && assignedGroupIds.size > 0) {
      for (const groupId of Array.from(assignedGroupIds)) {
        if (!groupCollector.has(groupId)) {
          groupCollector.set(groupId, { total: 0, count: 0 });
        }
      }
    } else if (exam.group_id && !groupCollector.has(exam.group_id)) {
      groupCollector.set(exam.group_id, { total: 0, count: 0 });
    }

    const groupAverages: ExamGroupAverage[] = Array.from(groupCollector.entries())
      .map(([groupId, v]) => ({
        groupId,
        groupName: groupsById.get(groupId) || 'Grupo sin nombre',
        average: v.count > 0 ? Math.round(v.total / v.count) : 0,
        studentsCount: v.count,
      }))
      .sort((a, b) => b.average - a.average);

    return {
      examId: exam.id,
      examTitle: exam.title,
      createdAt: exam.created_at,
      groupAverages,
      overallAverage: overallCount > 0 ? clampPercent(overallTotal / overallCount) : 0,
      totalStudents: overallCount,
    };
  });

  const gradedExamPercents = rows
    .filter((row) => row.totalStudents > 0)
    .map((row) => row.overallAverage);
  const globalAveragePercent =
    gradedExamPercents.length > 0
      ? clampPercent(
          gradedExamPercents.reduce((sum, pct) => sum + pct, 0) / gradedExamPercents.length
        )
      : null;

  return {
    rows,
    globalAveragePercent,
  };
}
