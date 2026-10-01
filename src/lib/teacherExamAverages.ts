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

/**
 * Misma lógica que la página Promedios: porcentaje por alumno = puntos / nº preguntas del examen.
 * `globalAveragePercent` agrupa todas las calificaciones (alumno–examen) del maestro en un único % 0–100.
 */
export async function fetchTeacherExamAverageSummaries(
  exams: Exam[],
  groupsById: Map<string, string>
): Promise<{ rows: ExamAverageSummaryRow[]; globalAveragePercent: number | null }> {
  if (exams.length === 0) {
    return { rows: [], globalAveragePercent: null };
  }

  const examIds = exams.map((e) => e.id);

  const answers: StudentAnswerRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: answersData, error: answersError } = await supabase
      .from('answers')
      .select('exam_id,student_id,score')
      .in('exam_id', examIds)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (answersError) throw answersError;
    const batch = (answersData || []) as StudentAnswerRow[];
    answers.push(...batch);
    if (batch.length < pageSize) break;
  }

  const { data: questionsData, error: questionsError } = await supabase
    .from('questions')
    .select('exam_id,points')
    .in('exam_id', examIds);
  if (questionsError) throw questionsError;
  const maxScoreByExam = new Map<string, number>();
  for (const row of questionsData || []) {
    const examId = String((row as { exam_id: string; points?: number | null }).exam_id);
    const pts = (row as { points?: number | null }).points ?? 1;
    maxScoreByExam.set(examId, (maxScoreByExam.get(examId) ?? 0) + pts);
  }

  const studentIds = Array.from(new Set(answers.map((a) => a.student_id)));
  const studentsById = new Map<string, StudentRow>();
  const idChunk = 200;
  for (let i = 0; i < studentIds.length; i += idChunk) {
    const slice = studentIds.slice(i, i + idChunk);
    const { data: studentsData, error: studentsError } = await supabase
      .from('students')
      .select('id,name,group_id')
      .in('id', slice);
    if (studentsError) throw studentsError;
    for (const student of studentsData || []) {
      studentsById.set(student.id, student as StudentRow);
    }
  }

  const { data: assignmentData, error: assignmentError } = await supabase
    .from('exam_group_assignments')
    .select('exam_id,group_id')
    .in('exam_id', examIds);
  if (assignmentError) throw assignmentError;
  const assignments = (assignmentData || []) as ExamGroupAssignmentRow[];
  const assignedGroupIdsByExam = new Map<string, Set<string>>();
  for (const row of assignments) {
    if (!assignedGroupIdsByExam.has(row.exam_id)) {
      assignedGroupIdsByExam.set(row.exam_id, new Set<string>());
    }
    assignedGroupIdsByExam.get(row.exam_id)!.add(row.group_id);
  }

  let globalPctSum = 0;
  let globalGradedCount = 0;

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
      const pct = calculatePercentage(points, maxScore);
      overallTotal += pct;
      overallCount += 1;
      globalPctSum += pct;
      globalGradedCount += 1;
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
      overallAverage: overallCount > 0 ? Math.round(overallTotal / overallCount) : 0,
      totalStudents: overallCount,
    };
  });

  return {
    rows,
    globalAveragePercent: globalGradedCount > 0 ? Math.round(globalPctSum / globalGradedCount) : null,
  };
}
