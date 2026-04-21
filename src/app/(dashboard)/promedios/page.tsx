'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useExams } from '@/hooks/useExams';
import { useGroups } from '@/hooks/useGroups';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp, Users } from 'lucide-react';
import { calculatePercentage, formatDate } from '@/lib/utils';

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

type ExamGroupAverage = {
  groupId: string;
  groupName: string;
  average: number;
  studentsCount: number;
};

type ExamAverageSummary = {
  examId: string;
  examTitle: string;
  createdAt: string;
  groupAverages: ExamGroupAverage[];
  overallAverage: number;
  totalStudents: number;
};

export default function PromediosPage() {
  const { user } = useAuth();
  const { exams, loading: examsLoading } = useExams(user?.id);
  const { groups } = useGroups(user?.id);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExamAverageSummary[]>([]);

  const groupsById = useMemo(() => {
    return new Map(groups.map((g) => [g.id, g.name]));
  }, [groups]);

  useEffect(() => {
    if (!user?.id || examsLoading) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        if (exams.length === 0) {
          if (!cancelled) setRows([]);
          return;
        }
        const examIds = exams.map((e) => e.id);

        const { data: answersData, error: answersError } = await supabase
          .from('answers')
          .select('exam_id,student_id,score')
          .in('exam_id', examIds);
        if (answersError) throw answersError;
        const answers = (answersData || []) as StudentAnswerRow[];

        const { data: questionsData, error: questionsError } = await supabase
          .from('questions')
          .select('exam_id')
          .in('exam_id', examIds);
        if (questionsError) throw questionsError;
        const questionCountByExam = new Map<string, number>();
        for (const row of questionsData || []) {
          const examId = String((row as { exam_id: string }).exam_id);
          questionCountByExam.set(examId, (questionCountByExam.get(examId) ?? 0) + 1);
        }

        const studentIds = Array.from(new Set(answers.map((a) => a.student_id)));
        let studentsById = new Map<string, StudentRow>();
        if (studentIds.length > 0) {
          const { data: studentsData, error: studentsError } = await supabase
            .from('students')
            .select('id,name,group_id')
            .in('id', studentIds);
          if (studentsError) throw studentsError;
          studentsById = new Map((studentsData || []).map((s) => [s.id, s as StudentRow]));
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

        const next: ExamAverageSummary[] = exams.map((exam) => {
          const maxScore = Math.max(1, questionCountByExam.get(exam.id) ?? 0);
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

        if (!cancelled) {
          setRows(next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.id, examsLoading, exams, groupsById]);

  if (loading || examsLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Promedios</h1>
        <p className="mt-1 text-sm text-gray-600 sm:text-base">
          Promedio por grupo y promedio general de cada examen.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-500">
            Aún no hay datos para calcular promedios.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((row) => (
            <Card key={row.examId}>
              <CardHeader className="space-y-1">
                <CardTitle className="line-clamp-2">{row.examTitle}</CardTitle>
                <CardDescription>Creado el {formatDate(row.createdAt)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-gray-500">Promedio general</p>
                    <p className="mt-1 flex items-center gap-1 text-xl font-bold text-orange-600">
                      <TrendingUp className="h-4 w-4" />
                      {row.overallAverage}%
                    </p>
                  </div>
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-gray-500">Alumnos calificados</p>
                    <p className="mt-1 flex items-center gap-1 text-xl font-bold text-gray-900">
                      <Users className="h-4 w-4" />
                      {row.totalStudents}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border">
                  <div className="grid grid-cols-12 border-b bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                    <span className="col-span-6">Grupo</span>
                    <span className="col-span-3 text-center">Alumnos</span>
                    <span className="col-span-3 text-right">Promedio</span>
                  </div>
                  {row.groupAverages.map((g) => (
                    <div key={`${row.examId}-${g.groupId}`} className="grid grid-cols-12 px-3 py-2 text-sm">
                      <span className="col-span-6 truncate">{g.groupName}</span>
                      <span className="col-span-3 text-center text-gray-600">{g.studentsCount}</span>
                      <span className="col-span-3 text-right font-semibold text-orange-700">{g.average}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
