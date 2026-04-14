'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useExam, useExamResults } from '@/hooks/useExams';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  ArrowLeft, 
  Download, 
  FileSpreadsheet, 
  FileText,
  Loader2,
  Users,
  TrendingUp,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { Answer, Question, Student } from '@/types';
import {
  formatDate,
  calculatePercentage,
  getGradeLabel,
  getGradeColor,
  isMultipleChoiceAnswerCorrect,
} from '@/lib/utils';

interface StudentResult {
  studentId: string;
  studentName: string;
  answers: Answer[];
  totalScore: number;
  maxScore: number;
  percentage: number;
  submittedAt: string;
}

interface QuestionAnalysis {
  question: Question;
  totalAnswers: number;
  correctAnswers: number;
  percentageCorrect: number;
}

type StudentQuestionBreakdown = {
  questionId: string;
  questionNumber: number;
  questionText: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean | null;
};

export default function ExamResultsPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.examId as string;
  const { exam, loading: examLoading } = useExam(examId);
  const { answers, loading: answersLoading } = useExamResults(examId);
  const [studentResults, setStudentResults] = useState<StudentResult[]>([]);
  const [questionAnalysis, setQuestionAnalysis] = useState<QuestionAnalysis[]>([]);
  const [gradeDistribution, setGradeDistribution] = useState<any[]>([]);
  const [selectedStudentBreakdownId, setSelectedStudentBreakdownId] = useState<string>('');
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!exam) return;

    const applyResults = (studentNamesById: Record<string, string>) => {
      if (!exam) return;

      const answersByStudent = answers.reduce((acc, answer) => {
        if (!acc[answer.student_id]) {
          acc[answer.student_id] = [];
        }
        acc[answer.student_id].push(answer);
        return acc;
      }, {} as Record<string, Answer[]>);

      const results: StudentResult[] = Object.entries(answersByStudent).map(([studentId, studentAnswers]) => {
        const maxScore = exam.questions.length;
        const totalScore = exam.questions.reduce((sum, q) => {
          const a = studentAnswers.find((x) => x.question_id === q.id);
          if (q.type === 'multiple_choice') {
            return sum + (a && isMultipleChoiceAnswerCorrect(q.options, a.answer_text, q.correct_answer) ? 1 : 0);
          }
          const sc = a?.score;
          return sum + (typeof sc === 'number' ? sc : 0);
        }, 0);
        const name = studentNamesById[studentId]?.trim();
        return {
          studentId,
          studentName: name || `Estudiante ${studentId.slice(0, 8)}`,
          answers: studentAnswers,
          totalScore,
          maxScore,
          percentage: calculatePercentage(totalScore, maxScore),
          submittedAt: studentAnswers[0]?.created_at || '',
        };
      });

      setStudentResults(results.sort((a, b) => b.percentage - a.percentage));

      const analysis: QuestionAnalysis[] = exam.questions.map((question) => {
        const questionAnswers = answers.filter((a) => a.question_id === question.id);
        const correctAnswers =
          question.type === 'multiple_choice'
            ? questionAnswers.filter((a) =>
                isMultipleChoiceAnswerCorrect(question.options, a.answer_text, question.correct_answer)
              ).length
            : questionAnswers.filter((a) => a.is_correct).length;
        return {
          question,
          totalAnswers: questionAnswers.length,
          correctAnswers,
          percentageCorrect: calculatePercentage(correctAnswers, questionAnswers.length),
        };
      });

      setQuestionAnalysis(analysis);

      const distribution = [
        { range: '90-100', count: 0, label: 'Excelente', color: '#22c55e' },
        { range: '80-89', count: 0, label: 'Muy bien', color: '#3b82f6' },
        { range: '70-79', count: 0, label: 'Bien', color: '#eab308' },
        { range: '60-69', count: 0, label: 'Suficiente', color: '#f97316' },
        { range: '0-59', count: 0, label: 'Necesita mejorar', color: '#ef4444' },
      ];

      results.forEach((result) => {
        if (result.percentage >= 90) distribution[0].count++;
        else if (result.percentage >= 80) distribution[1].count++;
        else if (result.percentage >= 70) distribution[2].count++;
        else if (result.percentage >= 60) distribution[3].count++;
        else distribution[4].count++;
      });

      setGradeDistribution(distribution);
    };

    const uniqueIds = Array.from(new Set(answers.map((a) => a.student_id)));
    if (uniqueIds.length === 0) {
      applyResults({});
      return;
    }

    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('students').select('id, name').in('id', uniqueIds);
      if (cancelled) return;
      const studentNamesById: Record<string, string> = {};
      (data || []).forEach((row: Pick<Student, 'id' | 'name'>) => {
        studentNamesById[row.id] = row.name;
      });
      applyResults(studentNamesById);
    })();

    return () => {
      cancelled = true;
    };
  }, [exam, answers]);

  useEffect(() => {
    setExpandedQuestionIds({});
  }, [selectedStudentBreakdownId]);

  const exportToExcel = () => {
    import('xlsx').then((XLSX) => {
      const data = studentResults.map(result => ({
        'Estudiante': result.studentName,
        'Puntaje': result.totalScore,
        'Máximo': result.maxScore,
        'Porcentaje': `${result.percentage}%`,
        'Calificación': getGradeLabel(result.percentage),
        'Fecha': formatDate(result.submittedAt),
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
      XLSX.writeFile(wb, `resultados_${exam?.title || 'examen'}.xlsx`);
      toast.success('Resultados exportados a Excel');
    });
  };

  const exportToPDF = () => {
    import('jspdf').then(({ jsPDF }) => {
      import('jspdf-autotable').then((autoTable) => {
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text(`Resultados: ${exam?.title || 'Examen'}`, 14, 20);
        
        doc.setFontSize(12);
        doc.text(`Total de estudiantes: ${studentResults.length}`, 14, 30);
        doc.text(`Promedio general: ${(studentResults.reduce((sum, r) => sum + r.percentage, 0) / studentResults.length || 0).toFixed(1)}%`, 14, 38);

        const data = studentResults.map(result => [
          result.studentName,
          `${result.totalScore}/${result.maxScore}`,
          `${result.percentage}%`,
          getGradeLabel(result.percentage),
          formatDate(result.submittedAt),
        ]);

        (doc as any).autoTable({
          head: [['Estudiante', 'Puntaje', 'Porcentaje', 'Calificación', 'Fecha']],
          body: data,
          startY: 45,
        });

        doc.save(`resultados_${exam?.title || 'examen'}.pdf`);
        toast.success('Resultados exportados a PDF');
      });
    });
  };

  if (examLoading || answersLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-medium text-gray-900 mb-2">Examen no encontrado</h3>
        <Button onClick={() => router.push('/exams')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver a exámenes
        </Button>
      </div>
    );
  }

  const selectedStudentForBreakdown =
    studentResults.find((r) => r.studentId === selectedStudentBreakdownId) ?? null;

  const breakdownRows: StudentQuestionBreakdown[] = selectedStudentForBreakdown
    ? exam.questions.map((q, idx) => {
        const answer = selectedStudentForBreakdown.answers.find((a) => a.question_id === q.id);
        const studentAnswer = answer?.answer_text ?? '';
        if (q.type === 'multiple_choice') {
          const correctAnswer = q.correct_answer ?? '';
          return {
            questionId: q.id,
            questionNumber: idx + 1,
            questionText: q.text,
            studentAnswer,
            correctAnswer,
            isCorrect: isMultipleChoiceAnswerCorrect(q.options, studentAnswer, correctAnswer),
          };
        }
        return {
          questionId: q.id,
          questionNumber: idx + 1,
          questionText: q.text,
          studentAnswer,
          correctAnswer: q.correct_answer ?? '',
          isCorrect: answer?.is_correct ?? null,
        };
      })
    : [];

  const toggleExpandedQuestion = (questionId: string) => {
    setExpandedQuestionIds((prev) => ({
      ...prev,
      [questionId]: !prev[questionId],
    }));
  };

  const averageScore = studentResults.length > 0 
    ? (studentResults.reduce((sum, r) => sum + r.percentage, 0) / studentResults.length).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/exams')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Resultados: {exam.title}</h1>
            <p className="text-gray-600 mt-1">Análisis de rendimiento de los estudiantes</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToExcel}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={exportToPDF}>
            <FileText className="w-4 h-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Estudiantes</CardTitle>
            <Users className="w-4 h-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{studentResults.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Promedio</CardTitle>
            <TrendingUp className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageScore}%</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Aprobados</CardTitle>
            <CheckCircle className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {studentResults.filter(r => r.percentage >= 60).length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Reprobados</CardTitle>
            <XCircle className="w-4 h-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {studentResults.filter(r => r.percentage < 60).length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="students" className="space-y-6">
        <TabsList>
          <TabsTrigger value="students">
            <Users className="w-4 h-4 mr-2" />
            Estudiantes
          </TabsTrigger>
          <TabsTrigger value="distribution">
            <TrendingUp className="w-4 h-4 mr-2" />
            Distribución
          </TabsTrigger>
          <TabsTrigger value="questions">
            <CheckCircle className="w-4 h-4 mr-2" />
            Por Pregunta
          </TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          <Card>
            <CardHeader>
              <CardTitle>Resultados por Estudiante</CardTitle>
              <CardDescription>
                Lista de todos los estudiantes que han respondido el examen
              </CardDescription>
            </CardHeader>
            <CardContent>
              {studentResults.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No hay resultados aún
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-semibold">Estudiante</th>
                        <th className="text-center py-3 px-4 font-semibold">Puntaje</th>
                        <th className="text-center py-3 px-4 font-semibold">Porcentaje</th>
                        <th className="text-center py-3 px-4 font-semibold">Calificación</th>
                        <th className="text-left py-3 px-4 font-semibold">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentResults.map((result) => (
                        <tr key={result.studentId} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4 font-medium">{result.studentName}</td>
                          <td className="py-3 px-4 text-center">
                            {result.totalScore}/{result.maxScore}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`font-semibold ${getGradeColor(result.percentage)}`}>
                              {result.percentage}%
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Badge className={result.percentage >= 60 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-red-100 text-red-700'
                            }>
                              {getGradeLabel(result.percentage)}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-gray-500">
                            {formatDate(result.submittedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Detalle por pregunta (bien/mal)</CardTitle>
              <CardDescription>
                Compara la respuesta del alumno con la clave correcta, sin recalificar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {studentResults.length === 0 ? (
                <div className="text-sm text-gray-500">Aún no hay estudiantes con resultados.</div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Alumno</label>
                    <select
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                      value={selectedStudentBreakdownId}
                      onChange={(e) => setSelectedStudentBreakdownId(e.target.value)}
                    >
                      <option value="">Selecciona un alumno</option>
                      {studentResults.map((result) => (
                        <option key={result.studentId} value={result.studentId}>
                          {result.studentName} ({result.percentage}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedStudentForBreakdown && (
                    <div className="space-y-3">
                      <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <span className="font-medium">{selectedStudentForBreakdown.studentName}</span>
                        {' · '}
                        {selectedStudentForBreakdown.totalScore}/{selectedStudentForBreakdown.maxScore}
                        {' · '}
                        <span className={getGradeColor(selectedStudentForBreakdown.percentage)}>
                          {selectedStudentForBreakdown.percentage}%
                        </span>
                      </div>

                      <div className="max-h-[26rem] overflow-y-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-700">
                            <tr className="border-b">
                              <th className="px-3 py-2 text-left font-semibold">#</th>
                              <th className="px-3 py-2 text-left font-semibold">Respuesta alumno</th>
                              <th className="px-3 py-2 text-left font-semibold">Correcta</th>
                              <th className="px-3 py-2 text-left font-semibold">Estado</th>
                              <th className="px-3 py-2 text-left font-semibold">Detalle</th>
                            </tr>
                          </thead>
                          <tbody>
                            {breakdownRows.flatMap((row) => {
                              const isExpanded = Boolean(expandedQuestionIds[row.questionId]);
                              const mainRow = (
                                <tr key={row.questionId} className="border-b align-top">
                                  <td className="px-3 py-2 font-medium text-gray-800">{row.questionNumber}</td>
                                  <td className="px-3 py-2 text-gray-700">{row.studentAnswer || 'Sin respuesta'}</td>
                                  <td className="px-3 py-2 text-gray-700">{row.correctAnswer || '—'}</td>
                                  <td className="px-3 py-2">
                                    {row.isCorrect === true ? (
                                      <Badge className="bg-green-100 text-green-700">Correcta</Badge>
                                    ) : row.isCorrect === false ? (
                                      <Badge className="bg-red-100 text-red-700">Incorrecta</Badge>
                                    ) : (
                                      <Badge className="bg-gray-100 text-gray-700">No evaluada</Badge>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => toggleExpandedQuestion(row.questionId)}
                                    >
                                      {isExpanded ? 'Ocultar' : 'Ver pregunta'}
                                    </Button>
                                  </td>
                                </tr>
                              );
                              if (!isExpanded) return [mainRow];
                              const detailRow = (
                                <tr key={`${row.questionId}-detail`} className="border-b bg-gray-50">
                                  <td className="px-3 py-2 text-xs font-semibold text-gray-500">Enunciado</td>
                                  <td colSpan={4} className="px-3 py-2 text-sm text-gray-800">
                                    {row.questionText}
                                  </td>
                                </tr>
                              );
                              return [mainRow, detailRow];
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution">
          <Card>
            <CardHeader>
              <CardTitle>Distribución de Calificaciones</CardTitle>
              <CardDescription>
                Visualización de cómo se distribuyen las calificaciones
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gradeDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Estudiantes">
                      {gradeDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="questions">
          <Card>
            <CardHeader>
              <CardTitle>Análisis por Pregunta</CardTitle>
              <CardDescription>
                Porcentaje de aciertos en cada pregunta
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {questionAnalysis.map((analysis, index) => (
                  <div key={analysis.question.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-500">Pregunta {index + 1}</span>
                        <p className="font-medium mt-1">{analysis.question.text}</p>
                      </div>
                      <Badge className={analysis.percentageCorrect >= 70 
                        ? 'bg-green-100 text-green-700' 
                        : analysis.percentageCorrect >= 50 
                          ? 'bg-yellow-100 text-yellow-700' 
                          : 'bg-red-100 text-red-700'
                      }>
                        {analysis.percentageCorrect}% aciertos
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-sm text-gray-500 mb-1">
                        <span>{analysis.correctAnswers} de {analysis.totalAnswers} correctas</span>
                        <span>{analysis.totalAnswers} respuestas</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            analysis.percentageCorrect >= 70 
                              ? 'bg-green-500' 
                              : analysis.percentageCorrect >= 50 
                                ? 'bg-yellow-500' 
                                : 'bg-red-500'
                          }`}
                          style={{ width: `${analysis.percentageCorrect}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
