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
  incorrectAnswers: number;
  blankAnswers: number;
  percentageCorrect: number;
  /** Opción múltiple: respuestas elegidas (texto) y frecuencia. */
  optionCounts: { label: string; count: number; isCorrectOption: boolean }[];
}

type StudentQuestionBreakdown = {
  questionId: string;
  questionNumber: number;
  questionText: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean | null;
};

function buildStudentQuestionBreakdownRows(result: StudentResult, questions: Question[]): StudentQuestionBreakdown[] {
  return questions.map((q, idx) => {
    const answer = result.answers.find((a) => a.question_id === q.id);
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
  });
}

function sanitizeExportFilenameBase(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'examen';
}

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

        let incorrectAnswers = 0;
        let blankAnswers = 0;
        const optTally: Record<string, number> = {};

        for (const a of questionAnswers) {
          const text = (a.answer_text ?? '').trim();
          if (question.type === 'multiple_choice') {
            if (!text) {
              blankAnswers++;
              continue;
            }
            const ok = isMultipleChoiceAnswerCorrect(
              question.options,
              a.answer_text,
              question.correct_answer
            );
            if (!ok) incorrectAnswers++;
            optTally[text] = (optTally[text] ?? 0) + 1;
          } else {
            if (!text) blankAnswers++;
            else if (a.is_correct === false) incorrectAnswers++;
          }
        }

        const correctOpt = (question.correct_answer ?? '').trim();
        const optionCounts: { label: string; count: number; isCorrectOption: boolean }[] =
          question.type === 'multiple_choice'
            ? Object.entries(optTally)
                .map(([label, count]) => ({
                  label,
                  count,
                  isCorrectOption: label === correctOpt,
                }))
                .sort((x, y) => y.count - x.count)
            : [];

        return {
          question,
          totalAnswers: questionAnswers.length,
          correctAnswers,
          incorrectAnswers,
          blankAnswers,
          percentageCorrect: calculatePercentage(correctAnswers, questionAnswers.length),
          optionCounts,
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
    if (!exam) return;
    import('xlsx').then((XLSX) => {
      const wb = XLSX.utils.book_new();
      const base = sanitizeExportFilenameBase(exam.title);

      const estudiantesSheet = XLSX.utils.json_to_sheet(
        studentResults.map((result) => ({
          Estudiante: result.studentName,
          Puntaje: result.totalScore,
          Máximo: result.maxScore,
          Porcentaje: `${result.percentage}%`,
          Calificación: getGradeLabel(result.percentage),
          Fecha: formatDate(result.submittedAt),
        }))
      );
      XLSX.utils.book_append_sheet(wb, estudiantesSheet, 'Estudiantes');

      const distribSheet = XLSX.utils.json_to_sheet(
        gradeDistribution.map((d) => ({
          'Rango %': d.range,
          Etiqueta: d.label,
          Estudiantes: d.count,
        }))
      );
      XLSX.utils.book_append_sheet(wb, distribSheet, 'Distribución');

      const reactivosSheet = XLSX.utils.json_to_sheet(
        questionAnalysis.map((a, i) => ({
          '#': i + 1,
          Pregunta: a.question.text,
          Correctas: a.correctAnswers,
          Incorrectas: a.incorrectAnswers,
          'En blanco': a.blankAnswers,
          'Total respuestas': a.totalAnswers,
          '% aciertos': a.percentageCorrect,
        }))
      );
      XLSX.utils.book_append_sheet(wb, reactivosSheet, 'Reactivos');

      const detalleRows: Record<string, string | number>[] = [];
      for (const result of studentResults) {
        for (const row of buildStudentQuestionBreakdownRows(result, exam.questions)) {
          detalleRows.push({
            Estudiante: result.studentName,
            '#': row.questionNumber,
            Enunciado: row.questionText,
            'Respuesta alumno': row.studentAnswer || 'Sin respuesta',
            'Respuesta correcta': row.correctAnswer || '—',
            Estado:
              row.isCorrect === true
                ? 'Correcta'
                : row.isCorrect === false
                  ? 'Incorrecta'
                  : 'No eval.',
          });
        }
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalleRows), 'Detalle por pregunta');

      const distrRows: Record<string, string | number>[] = [];
      questionAnalysis.forEach((a, qi) => {
        for (const oc of a.optionCounts) {
          const pct = a.totalAnswers ? Math.round((oc.count / a.totalAnswers) * 100) : 0;
          distrRows.push({
            Reactivo: qi + 1,
            Pregunta: a.question.text,
            Opción: oc.label,
            Cantidad: oc.count,
            '% del total': pct,
            'Es correcta': oc.isCorrectOption ? 'Sí' : 'No',
          });
        }
      });
      if (distrRows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(distrRows), 'Distractores');
      }

      XLSX.writeFile(wb, `resultados_${base}.xlsx`);
      toast.success('Resultados exportados a Excel (todas las secciones)');
    });
  };

  const exportToPDF = () => {
    if (!exam) return;
    import('jspdf').then(({ jsPDF }) => {
      import('jspdf-autotable').then(() => {
        const doc = new jsPDF();
        const margin = 14;
        const base = sanitizeExportFilenameBase(exam.title);

        doc.setFontSize(18);
        doc.text(`Resultados: ${exam.title}`, margin, 20);

        doc.setFontSize(10);
        const approved = studentResults.filter((r) => r.percentage >= 60).length;
        const failed = studentResults.filter((r) => r.percentage < 60).length;
        const avg =
          studentResults.length > 0
            ? (
                studentResults.reduce((sum, r) => sum + r.percentage, 0) / studentResults.length
              ).toFixed(1)
            : '0';

        doc.text(
          `Estudiantes: ${studentResults.length}  ·  Promedio: ${avg}%  ·  Aprobados: ${approved}  ·  Reprobados: ${failed}`,
          margin,
          30
        );

        let nextY = 44;

        const section = (title: string) => {
          nextY += 8;
          if (nextY > 270) {
            doc.addPage();
            nextY = 20;
          }
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(title, margin, nextY);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          nextY += 5;
        };

        section('Estudiantes — resultados globales');
        (doc as any).autoTable({
          head: [['Estudiante', 'Puntaje', '%', 'Calificación', 'Fecha']],
          body: studentResults.map((result) => [
            result.studentName,
            `${result.totalScore}/${result.maxScore}`,
            `${result.percentage}%`,
            getGradeLabel(result.percentage),
            formatDate(result.submittedAt),
          ]),
          startY: nextY,
          margin: { left: margin, right: margin },
          styles: { fontSize: 8, cellPadding: 2 },
        });
        nextY = (doc as any).lastAutoTable.finalY + 10;

        section('Distribución de calificaciones');
        (doc as any).autoTable({
          head: [['Rango %', 'Etiqueta', 'Estudiantes']],
          body: gradeDistribution.map((d) => [d.range, d.label, String(d.count)]),
          startY: nextY,
          margin: { left: margin, right: margin },
          styles: { fontSize: 8, cellPadding: 2 },
        });
        nextY = (doc as any).lastAutoTable.finalY + 10;

        section('Reactivos (análisis por pregunta)');
        (doc as any).autoTable({
          head: [['#', 'Resumen pregunta', 'OK', 'Mal', 'Blanco', 'N', '% aciertos']],
          body: questionAnalysis.map((a, i) => {
            const shortQ =
              a.question.text.length > 90 ? `${a.question.text.slice(0, 90)}…` : a.question.text;
            return [
              String(i + 1),
              shortQ,
              String(a.correctAnswers),
              String(a.incorrectAnswers),
              String(a.blankAnswers),
              String(a.totalAnswers),
              `${a.percentageCorrect}%`,
            ];
          }),
          startY: nextY,
          margin: { left: margin, right: margin },
          styles: { fontSize: 7, cellPadding: 1.5 },
          columnStyles: {
            0: { cellWidth: 10 },
            1: { cellWidth: 72 },
          },
        });
        nextY = (doc as any).lastAutoTable.finalY + 10;

        const hasDistractors = questionAnalysis.some((a) => a.optionCounts.length > 0);
        if (hasDistractors) {
          section('Distractores (opción múltiple)');
          const distrBody: string[][] = [];
          questionAnalysis.forEach((a, qi) => {
            for (const oc of a.optionCounts) {
              const pct = a.totalAnswers ? Math.round((oc.count / a.totalAnswers) * 100) : 0;
              const label =
                oc.label.length > 55 ? `${oc.label.slice(0, 55)}…` : oc.label;
              distrBody.push([
                String(qi + 1),
                label,
                String(oc.count),
                `${pct}%`,
                oc.isCorrectOption ? 'Sí' : 'No',
              ]);
            }
          });
          (doc as any).autoTable({
            head: [['Reactivo', 'Opción elegida', 'Cant.', '% total', '¿Correcta?']],
            body: distrBody,
            startY: nextY,
            margin: { left: margin, right: margin },
            styles: { fontSize: 7, cellPadding: 1.5 },
          });
          nextY = (doc as any).lastAutoTable.finalY + 10;
        }

        section('Detalle por estudiante y pregunta');
        const detalleBody: string[][] = [];
        for (const result of studentResults) {
          for (const row of buildStudentQuestionBreakdownRows(result, exam.questions)) {
            const estado =
              row.isCorrect === true
                ? 'Correcta'
                : row.isCorrect === false
                  ? 'Incorrecta'
                  : 'No eval.';
            const enun =
              row.questionText.length > 60 ? `${row.questionText.slice(0, 60)}…` : row.questionText;
            const sa = row.studentAnswer || '—';
            const ca = row.correctAnswer || '—';
            detalleBody.push([
              result.studentName,
              String(row.questionNumber),
              enun,
              sa.length > 40 ? `${sa.slice(0, 40)}…` : sa,
              ca.length > 40 ? `${ca.slice(0, 40)}…` : ca,
              estado,
            ]);
          }
        }
        (doc as any).autoTable({
          head: [['Estudiante', '#', 'Pregunta (extracto)', 'Resp. alumno', 'Correcta', 'Estado']],
          body: detalleBody,
          startY: nextY,
          margin: { left: margin, right: margin },
          styles: { fontSize: 6, cellPadding: 1 },
          columnStyles: {
            0: { cellWidth: 28 },
            1: { cellWidth: 8 },
            2: { cellWidth: 38 },
            3: { cellWidth: 22 },
            4: { cellWidth: 22 },
            5: { cellWidth: 18 },
          },
        });

        doc.save(`resultados_${base}.pdf`);
        toast.success('Resultados exportados a PDF (todas las secciones)');
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
    ? buildStudentQuestionBreakdownRows(selectedStudentForBreakdown, exam.questions)
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
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden sm:space-y-6">
      {/* Header */}
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-2 sm:items-center sm:gap-4">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.push('/exams')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold text-gray-900 sm:text-2xl">Resultados: {exam.title}</h1>
            <p className="mt-1 text-sm text-gray-600 sm:text-base">Análisis de rendimiento de los estudiantes</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-8 sm:h-9 sm:px-4" onClick={exportToExcel}>
            <FileSpreadsheet className="mr-2 h-4 w-4 shrink-0" />
            Excel
          </Button>
          <Button variant="outline" size="sm" className="h-8 sm:h-9 sm:px-4" onClick={exportToPDF}>
            <FileText className="mr-2 h-4 w-4 shrink-0" />
            PDF
          </Button>
        </div>
      </div>

      {/* Stats: 2×2 en móvil, fila en md+ */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
        <Card className="gap-0 py-3 shadow-sm sm:gap-6 sm:py-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pb-2 pt-0 sm:px-6">
            <CardTitle className="text-xs font-medium leading-tight text-gray-600 sm:text-sm">Estudiantes</CardTitle>
            <Users className="h-3.5 w-3.5 shrink-0 text-orange-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-0 pt-0 sm:px-6">
            <div className="text-lg font-bold tabular-nums sm:text-2xl">{studentResults.length}</div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-3 shadow-sm sm:gap-6 sm:py-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pb-2 pt-0 sm:px-6">
            <CardTitle className="text-xs font-medium leading-tight text-gray-600 sm:text-sm">Promedio</CardTitle>
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-0 pt-0 sm:px-6">
            <div className="text-lg font-bold tabular-nums sm:text-2xl">{averageScore}%</div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-3 shadow-sm sm:gap-6 sm:py-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pb-2 pt-0 sm:px-6">
            <CardTitle className="text-xs font-medium leading-tight text-gray-600 sm:text-sm">Aprobados</CardTitle>
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-0 pt-0 sm:px-6">
            <div className="text-lg font-bold tabular-nums sm:text-2xl">
              {studentResults.filter(r => r.percentage >= 60).length}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-3 shadow-sm sm:gap-6 sm:py-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pb-2 pt-0 sm:px-6">
            <CardTitle className="text-xs font-medium leading-tight text-gray-600 sm:text-sm">Reprobados</CardTitle>
            <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="px-3 pb-0 pt-0 sm:px-6">
            <div className="text-lg font-bold tabular-nums sm:text-2xl">
              {studentResults.filter(r => r.percentage < 60).length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="students" className="min-w-0 space-y-4 sm:space-y-6">
        <TabsList className="grid h-auto w-full min-w-0 grid-cols-3 gap-1 rounded-lg bg-muted p-1 sm:inline-flex sm:h-9 sm:w-fit">
          <TabsTrigger value="students" className="gap-1 px-1.5 text-[11px] leading-tight sm:px-3 sm:text-sm">
            <Users className="h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            <span className="truncate">Estudiantes</span>
          </TabsTrigger>
          <TabsTrigger value="distribution" className="gap-1 px-1.5 text-[11px] leading-tight sm:px-3 sm:text-sm">
            <TrendingUp className="h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            <span className="truncate">Distribución</span>
          </TabsTrigger>
          <TabsTrigger value="questions" className="gap-1 px-1.5 text-[11px] leading-tight sm:px-3 sm:text-sm">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" />
            <span className="truncate sm:hidden">Reactivos</span>
            <span className="hidden truncate sm:inline">Reactivos (por pregunta)</span>
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
                <div className="w-full min-w-0">
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="w-[46%] py-2 pl-0 pr-2 text-left font-semibold sm:w-auto sm:py-3 sm:px-4 sm:pl-4">
                          Estudiante
                        </th>
                        <th className="w-[22%] py-2 px-1 text-center font-semibold sm:w-auto sm:py-3 sm:px-4">
                          Puntaje
                        </th>
                        <th className="w-[32%] py-2 pl-2 pr-0 text-center font-semibold sm:w-auto sm:py-3 sm:px-4 sm:pr-4">
                          Porcentaje
                        </th>
                        <th className="hidden text-center py-3 px-4 font-semibold md:table-cell md:w-auto">
                          Calificación
                        </th>
                        <th className="hidden text-left py-3 px-4 font-semibold md:table-cell md:w-auto">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentResults.map((result) => (
                        <tr key={result.studentId} className="border-b hover:bg-gray-50">
                          <td className="py-2 pl-0 pr-2 font-medium [word-break:break-word] sm:py-3 sm:px-4 sm:pl-4">
                            {result.studentName}
                          </td>
                          <td className="py-2 px-1 text-center tabular-nums sm:py-3 sm:px-4">
                            {result.totalScore}/{result.maxScore}
                          </td>
                          <td className="py-2 pl-2 pr-0 text-center sm:py-3 sm:px-4 sm:pr-4">
                            <span className={`font-semibold ${getGradeColor(result.percentage)}`}>
                              {result.percentage}%
                            </span>
                          </td>
                          <td className="hidden py-3 px-4 text-center md:table-cell">
                            <Badge className={result.percentage >= 60 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-red-100 text-red-700'
                            }>
                              {getGradeLabel(result.percentage)}
                            </Badge>
                          </td>
                          <td className="hidden py-3 px-4 text-gray-500 md:table-cell">
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

                      <div className="max-h-[26rem] overflow-y-auto overflow-x-hidden rounded-lg border">
                        <table className="w-full table-fixed border-collapse text-[11px] sm:text-sm">
                          <thead className="bg-gray-50 text-gray-700">
                            <tr className="border-b">
                              <th className="w-8 px-1 py-2 text-left font-semibold sm:w-10 sm:px-3">#</th>
                              <th className="min-w-0 px-1 py-2 text-left font-semibold sm:px-3">
                                <span className="[word-break:break-word]">Respuesta alumno</span>
                              </th>
                              <th className="min-w-0 px-1 py-2 text-left font-semibold sm:px-3">
                                <span className="[word-break:break-word]">Correcta</span>
                              </th>
                              <th className="w-[4.5rem] px-1 py-2 text-left font-semibold sm:w-auto sm:px-3">
                                Estado
                              </th>
                              <th className="w-[3.25rem] px-1 py-2 text-left font-semibold sm:w-auto sm:px-3">
                                Detalle
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {breakdownRows.flatMap((row) => {
                              const isExpanded = Boolean(expandedQuestionIds[row.questionId]);
                              const mainRow = (
                                <tr key={row.questionId} className="border-b align-top">
                                  <td className="px-1 py-2 font-medium text-gray-800 sm:px-3">{row.questionNumber}</td>
                                  <td className="min-w-0 px-1 py-2 text-gray-700 [word-break:break-word] sm:px-3">
                                    {row.studentAnswer || 'Sin respuesta'}
                                  </td>
                                  <td className="min-w-0 px-1 py-2 text-gray-700 [word-break:break-word] sm:px-3">
                                    {row.correctAnswer || '—'}
                                  </td>
                                  <td className="px-1 py-2 sm:px-3">
                                    {row.isCorrect === true ? (
                                      <Badge className="max-w-full whitespace-normal break-words bg-green-100 text-[10px] leading-tight text-green-700 sm:text-xs">
                                        Correcta
                                      </Badge>
                                    ) : row.isCorrect === false ? (
                                      <Badge className="max-w-full whitespace-normal break-words bg-red-100 text-[10px] leading-tight text-red-700 sm:text-xs">
                                        Incorrecta
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-gray-100 text-[10px] text-gray-700 sm:text-xs">No eval.</Badge>
                                    )}
                                  </td>
                                  <td className="px-1 py-2 sm:px-3">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-1.5 text-[10px] sm:h-9 sm:px-3 sm:text-sm"
                                      onClick={() => toggleExpandedQuestion(row.questionId)}
                                    >
                                      <span className="hidden sm:inline">{isExpanded ? 'Ocultar' : 'Ver pregunta'}</span>
                                      <span className="sm:hidden">{isExpanded ? 'Ocultar' : 'Ver'}</span>
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
            <CardContent className="min-w-0">
              <div className="h-80 w-full min-w-0 max-w-full">
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
              <CardTitle>Análisis agregado por reactivo</CardTitle>
              <CardDescription>
                Aciertos, distractores más elegidos y respuestas en blanco (similar a informe por pregunta tipo ZipGrade).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {questionAnalysis.map((analysis, index) => (
                  <div key={analysis.question.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-500">Reactivo {index + 1}</span>
                        <p className="font-medium mt-1 text-sm sm:text-base">{analysis.question.text}</p>
                      </div>
                      <Badge className={analysis.percentageCorrect >= 70 
                        ? 'bg-green-100 text-green-700 shrink-0' 
                        : analysis.percentageCorrect >= 50 
                          ? 'bg-yellow-100 text-yellow-700 shrink-0' 
                          : 'bg-red-100 text-red-700 shrink-0'
                      }>
                        {analysis.percentageCorrect}% aciertos
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                      <span>
                        Correctas: <strong className="text-gray-900">{analysis.correctAnswers}</strong>
                      </span>
                      <span>
                        Incorrectas: <strong className="text-gray-900">{analysis.incorrectAnswers}</strong>
                      </span>
                      <span>
                        En blanco: <strong className="text-gray-900">{analysis.blankAnswers}</strong>
                      </span>
                      <span>
                        N: <strong className="text-gray-900">{analysis.totalAnswers}</strong>
                      </span>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-sm text-gray-500 mb-1">
                        <span>Proporción de aciertos sobre calificados</span>
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
                    {analysis.optionCounts.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                          Distractores (respuestas elegidas)
                        </p>
                        <div className="space-y-2">
                          {analysis.optionCounts.map((oc) => {
                            const pct = analysis.totalAnswers
                              ? Math.round((oc.count / analysis.totalAnswers) * 100)
                              : 0;
                            return (
                              <div key={oc.label} className="text-sm">
                                <div className="flex justify-between gap-2 mb-0.5">
                                  <span
                                    className={
                                      oc.isCorrectOption
                                        ? 'font-medium text-green-800 truncate'
                                        : 'text-gray-800 truncate'
                                    }
                                    title={oc.label}
                                  >
                                    {oc.isCorrectOption ? '✓ ' : ''}
                                    {oc.label.length > 80 ? `${oc.label.slice(0, 80)}…` : oc.label}
                                  </span>
                                  <span className="text-gray-500 shrink-0">
                                    {oc.count} ({pct}%)
                                  </span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-1.5">
                                  <div
                                    className={
                                      oc.isCorrectOption ? 'h-1.5 rounded-full bg-green-500' : 'h-1.5 rounded-full bg-orange-400'
                                    }
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
