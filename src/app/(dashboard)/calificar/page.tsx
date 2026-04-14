'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle, LayoutDashboard, Loader2, Scan, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useExam, useExams } from '@/hooks/useExams';
import { supabase } from '@/lib/supabase';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import {
  chunkQuestions,
  califacilOmrColumnCount,
  examSupportsCalifacilOmr,
} from '@/lib/printExam';
import { fileToVisionJpegDataUrl } from '@/lib/imageCompress';
import { fileToImage, scanCalifacilOmrSheet } from '@/lib/omrScan';
import {
  calculatePercentage,
  getGradeColor,
  getGradeLabel,
  isMultipleChoiceAnswerCorrect,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { StudentCombobox } from '@/components/student-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Exam, Question, Student } from '@/types';
import { toSpanishAuthMessage } from '@/lib/authErrors';

type Phase =
  | 'elegir'
  | 'capturar'
  | 'revisar_hoja'
  | 'guardando'
  | 'resultado';

type ResultBreakdownItem = {
  questionId: string;
  questionNumber: number;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
};

export default function CalificarPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { exams, loading: examsLoading } = useExams(user?.id);

  const [examId, setExamId] = useState<string>('');
  const { exam, loading: examLoading } = useExam(examId || undefined);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [phase, setPhase] = useState<Phase>('elegir');
  const [sheetIndex, setSheetIndex] = useState(0);
  /** Respuestas confirmadas por id de pregunta (todas las hojas) */
  const [confirmedByQuestionId, setConfirmedByQuestionId] = useState<Record<string, string>>({});
  /** Lectura OMR de la hoja actual (antes de confirmar) */
  const [draftSelections, setDraftSelections] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  const [resultPct, setResultPct] = useState(0);
  const [resultCorrect, setResultCorrect] = useState(0);
  const [resultTotal, setResultTotal] = useState(0);
  const [resultBreakdown, setResultBreakdown] = useState<ResultBreakdownItem[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  const publishedExams = useMemo(
    () => (exams as Exam[]).filter((e) => e.status === 'published'),
    [exams]
  );

  const questions = useMemo(() => exam?.questions ?? [], [exam]);
  const omrCols = califacilOmrColumnCount(questions);
  const supportsCalifacil = exam ? examSupportsCalifacilOmr(questions) : false;
  const sheets = useMemo(() => chunkQuestions(questions, 10), [questions]);
  const totalSheets = sheets.length;
  const currentChunk = sheets[sheetIndex] ?? [];
  const maxQuestions = 30;

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [students]
  );

  const selectedStudentName =
    sortedStudents.find((s) => s.id === selectedStudentId)?.name ?? '';

  useEffect(() => {
    if (!exam?.group_id) {
      setStudents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('group_id', exam.group_id!);
      if (!cancelled && !error) setStudents(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [exam?.group_id]);

  const resetFlow = useCallback(() => {
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    setDraftSelections({});
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setResultPct(0);
    setResultCorrect(0);
    setResultTotal(0);
    setResultBreakdown([]);
    setSelectedStudentId('');
  }, []);

  const validateStudentSelection = (): boolean => {
    if (!selectedStudentId) {
      toast.error('Selecciona un alumno de la lista');
      return false;
    }
    if (!sortedStudents.some((s) => s.id === selectedStudentId)) {
      toast.error('El alumno elegido no es válido');
      return false;
    }
    return true;
  };

  const startCapturePhase = () => {
    if (!examId || !exam) {
      toast.error('Selecciona un examen');
      return;
    }
    if (!supportsCalifacil || omrCols < 2) {
      toast.error(
        'Este examen no es compatible con CaliFacil (solo opción múltiple, 2–5 opciones por pregunta).'
      );
      return;
    }
    if (questions.length > maxQuestions) {
      toast.error(`Máximo ${maxQuestions} preguntas para calificación por hoja.`);
      return;
    }
    if (!validateStudentSelection()) return;
    setPhase('capturar');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !exam) return;

    setScanBusy(true);
    try {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });

      const chunk = sheets[sheetIndex] ?? [];
      const img = await fileToImage(file);
      const raw = scanCalifacilOmrSheet(img, omrCols);

      let visionSelections: Record<string, string> = {};
      let scanNote = 'Revisa las respuestas detectadas y confirma antes de guardar.';
      try {
        const dataUrl = await fileToVisionJpegDataUrl(file);
        const vr = await fetch('/api/calificar/vision-omr', {
          method: 'POST',
          headers: await dashboardAuthJsonHeaders(),
          body: JSON.stringify({
            examId: exam.id,
            imageBase64: dataUrl,
            omrColumnCount: omrCols,
            rows: chunk.map((q, i) => ({
              questionId: q.id,
              globalNumber: sheetIndex * 10 + i + 1,
              options: q.options ?? [],
            })),
          }),
        });
        if (vr.ok) {
          const j = (await vr.json()) as { selections?: Record<string, string> };
          visionSelections = j.selections ?? {};
          scanNote = 'IA leyó la foto; revisa y confirma antes de guardar.';
        } else if (vr.status === 503) {
          scanNote = 'Sin OPENAI_API_KEY en el servidor: solo lectura local del recuadro. Revisa y confirma.';
        } else {
          console.warn('vision-omr', await vr.json().catch(() => ({})));
          scanNote = 'La IA no respondió bien; se usó lectura local. Revisa y confirma.';
        }
      } catch (visionErr) {
        console.warn(visionErr);
        scanNote = 'Sin conexión a la IA; lectura local. Revisa y confirma.';
      }

      const nextDraft: Record<string, string> = {};
      let disagreementCount = 0;
      let unresolvedCount = 0;
      for (let i = 0; i < chunk.length; i++) {
        const q = chunk[i];
        const opts = q.options ?? [];
        let fromVision = visionSelections[q.id]?.trim() ?? '';
        if (fromVision && !opts.includes(fromVision)) {
          const hit = opts.find(
            (o) => o.trim().toLowerCase() === fromVision.toLowerCase()
          );
          if (hit) fromVision = hit;
        }
        const col = raw[i];
        const fromLocal = col !== null && col < opts.length ? opts[col] : '';

        // Preferimos lectura local del recuadro porque es más estable con la plantilla.
        // IA solo ayuda cuando local no logró detectar una burbuja clara.
        if (fromLocal) {
          nextDraft[q.id] = fromLocal;
          if (fromVision && fromVision !== fromLocal) disagreementCount++;
          continue;
        }

        if (fromVision && opts.includes(fromVision)) {
          nextDraft[q.id] = fromVision;
          continue;
        }

        nextDraft[q.id] = '';
        unresolvedCount++;
      }

      setDraftSelections(nextDraft);
      setPhase('revisar_hoja');
      const detailParts: string[] = [];
      if (disagreementCount > 0) {
        detailParts.push(`${disagreementCount} con diferencia IA/local`);
      }
      if (unresolvedCount > 0) {
        detailParts.push(`${unresolvedCount} sin lectura clara`);
      }
      toast.message(
        detailParts.length > 0 ? `${scanNote} (${detailParts.join(' · ')})` : scanNote
      );
    } catch {
      toast.error('No se pudo procesar la foto. Intenta otra con mejor luz y encuadre.');
    } finally {
      setScanBusy(false);
    }
  };

  const confirmCurrentSheet = () => {
    const chunk = sheets[sheetIndex] ?? [];
    for (const q of chunk) {
      const v = draftSelections[q.id]?.trim() ?? '';
      if (!v) {
        toast.error(`Falta la respuesta de la pregunta ${questions.findIndex((x) => x.id === q.id) + 1}`);
        return;
      }
    }

    const mergedNow: Record<string, string> = { ...confirmedByQuestionId };
    for (const q of chunk) {
      mergedNow[q.id] = draftSelections[q.id]!;
    }
    setConfirmedByQuestionId(mergedNow);

    const isLast = sheetIndex >= totalSheets - 1;
    if (!isLast) {
      setSheetIndex((s) => s + 1);
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setDraftSelections({});
      setPhase('capturar');
      toast.success(`Hoja ${sheetIndex + 1} guardada. Captura la siguiente.`);
      return;
    }

    void submitAll(mergedNow);
  };

  const submitAll = async (merged: Record<string, string>) => {
    if (!exam || !examId) return;

    for (const q of questions) {
      if (!merged[q.id]?.trim()) {
        toast.error('Faltan respuestas por confirmar.');
        return;
      }
    }

    if (!selectedStudentId || !sortedStudents.some((s) => s.id === selectedStudentId)) {
      toast.error('Alumno no válido. Vuelve a seleccionar en la primera pantalla.');
      return;
    }

    setPhase('guardando');

    try {
      const studentId = selectedStudentId;

      let correctCount = 0;
      const breakdown: ResultBreakdownItem[] = [];
      const rows = questions.map((question: Question) => {
        const answerText = merged[question.id];
        const isCorrect =
          question.type === 'multiple_choice'
            ? isMultipleChoiceAnswerCorrect(
                question.options,
                answerText,
                question.correct_answer
              )
            : null;
        if (isCorrect) correctCount++;

        if (question.type === 'multiple_choice') {
          breakdown.push({
            questionId: question.id,
            questionNumber: questions.findIndex((x) => x.id === question.id) + 1,
            studentAnswer: answerText ?? '',
            correctAnswer: question.correct_answer ?? '',
            isCorrect: Boolean(isCorrect),
          });
        }

        return {
          exam_id: examId,
          student_id: studentId,
          question_id: question.id,
          answer_text: answerText,
          is_correct: isCorrect,
          score: isCorrect ? 1 : 0,
        };
      });

      const { error: answersError } = await supabase.from('answers').upsert(rows, {
        onConflict: 'exam_id,student_id,question_id',
      });
      if (answersError) throw answersError;

      const mcTotal = questions.filter((q) => q.type === 'multiple_choice').length;
      const pct = calculatePercentage(correctCount, mcTotal);
      setResultCorrect(correctCount);
      setResultTotal(mcTotal);
      setResultPct(pct);
      setResultBreakdown(breakdown);
      setPhase('resultado');
      toast.success('Calificación guardada. Ya aparece en resultados.');
       } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '';
      toast.error('No se pudo guardar', {
        description: msg ? toSpanishAuthMessage(msg) : 'Revisa tu conexión y permisos.',
      });
      setPhase('revisar_hoja');
    }
  };

  const openCamera = () => fileRef.current?.click();

  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 pb-6 sm:gap-4 sm:pb-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Calificar</h1>
        <p className="mt-0.5 text-xs text-gray-600 sm:mt-1 sm:text-sm">
          Fotografía el pie CaliFacil de cada hoja impresa (10 preguntas por hoja, hasta 3 hojas).
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-1 pb-2 sm:pb-3">
          <CardTitle className="text-base sm:text-lg">Examen y alumno</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            El examen debe estar publicado, impreso con la zona CaliFacil y ser solo opción múltiple
            (2–5 opciones).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4">
          <div className="space-y-2">
            <Label>Examen</Label>
            <Select
              value={examId || undefined}
              onValueChange={(v) => {
                setExamId(v);
                resetFlow();
              }}
              disabled={examsLoading || phase === 'guardando'}
            >
              <SelectTrigger>
                <SelectValue placeholder={examsLoading ? 'Cargando…' : 'Elige un examen'} />
              </SelectTrigger>
              <SelectContent>
                {publishedExams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {examId && examLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando preguntas…
            </div>
          )}

          {exam && !examLoading && !supportsCalifacil && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="h-5 w-5 shrink-0" />
              Este examen no puede usarse aquí: todas las preguntas deben ser opción múltiple con 2 a
              5 opciones.
            </div>
          )}

          {exam && supportsCalifacil && questions.length > maxQuestions && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertCircle className="h-5 w-5 shrink-0" />
              Este examen tiene más de {maxQuestions} preguntas. Reduce el examen para usar Calificar.
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="calif-alumno">Alumno</Label>
            <StudentCombobox
              id="calif-alumno"
              students={sortedStudents}
              value={selectedStudentId}
              onValueChange={setSelectedStudentId}
              disabled={phase === 'guardando' || phase === 'resultado'}
              placeholder="Busca y elige al alumno"
              searchPlaceholder="Escribe para buscar…"
              emptyText="Ningún alumno coincide."
              noStudentsText={
                exam && !exam.group_id
                  ? 'Este examen no tiene grupo asignado. Asigna un grupo al examen y registra alumnos en Grupos.'
                  : undefined
              }
            />
            <p className="text-xs text-gray-500">
              Solo puedes calificar a alumnos que estén en la lista del grupo del examen.
            </p>
          </div>

          {phase === 'elegir' && (
            <Button
              className="w-full bg-orange-600 hover:bg-orange-700"
              onClick={startCapturePhase}
              disabled={
                !examId ||
                examLoading ||
                !supportsCalifacil ||
                questions.length === 0 ||
                questions.length > maxQuestions ||
                sortedStudents.length === 0 ||
                !selectedStudentId
              }
            >
              <Scan className="mr-2 h-4 w-4" />
              Comenzar calificación
            </Button>
          )}
        </CardContent>
      </Card>

      {(phase === 'capturar' || phase === 'revisar_hoja') && exam && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Hoja {sheetIndex + 1} de {totalSheets}
            </CardTitle>
            <CardDescription>
              Preguntas {sheetIndex * 10 + 1}–{sheetIndex * 10 + currentChunk.length} · Incluye en la
              foto el recuadro negro CaliFacil del pie de página.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onPickImage}
            />

            {phase === 'capturar' && (
              <Button
                type="button"
                size="lg"
                className="h-16 w-full gap-2 bg-orange-600 text-base hover:bg-orange-700"
                onClick={openCamera}
                disabled={scanBusy}
              >
                {scanBusy ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Camera className="h-7 w-7" />
                )}
                CaliFacil
              </Button>
            )}

            {previewUrl && phase === 'revisar_hoja' && (
              <div className="overflow-hidden rounded-lg border bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Vista previa" className="max-h-48 w-full object-contain" />
              </div>
            )}

            {phase === 'revisar_hoja' && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-800">Confirmar respuestas</p>
                {currentChunk.map((q, idx) => {
                  const globalNum = sheetIndex * 10 + idx + 1;
                  const opts = q.options ?? [];
                  return (
                    <div key={q.id} className="flex flex-col gap-1">
                      <Label className="text-xs text-gray-600">Pregunta {globalNum}</Label>
                      <Select
                        value={
                          draftSelections[q.id] && opts.includes(draftSelections[q.id])
                            ? draftSelections[q.id]
                            : undefined
                        }
                        onValueChange={(v) =>
                          setDraftSelections((d) => ({ ...d, [q.id]: v }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Elige respuesta" />
                        </SelectTrigger>
                        <SelectContent>
                          {opts.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}

                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setPhase('capturar');
                      setPreviewUrl((u) => {
                        if (u) URL.revokeObjectURL(u);
                        return null;
                      });
                      setDraftSelections({});
                    }}
                  >
                    Tomar otra foto
                  </Button>
                  <Button
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                    onClick={confirmCurrentSheet}
                  >
                    {sheetIndex >= totalSheets - 1 ? 'Guardar calificación' : 'Siguiente hoja'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {phase === 'guardando' && (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <Loader2 className="h-10 w-10 animate-spin text-orange-600" />
          <p className="text-sm text-gray-600">Guardando en resultados…</p>
        </div>
      )}

      {phase === 'resultado' && exam && (
        <Card>
          <CardContent className="space-y-6 pt-6 text-center">
            <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Calificación registrada</h2>
              <p className="mt-1 text-gray-600">{selectedStudentName}</p>
            </div>
            <div className="rounded-xl bg-orange-50/80 p-6">
              <p className="text-sm text-gray-600">Aciertos</p>
              <p className="text-3xl font-bold text-gray-900">
                {resultCorrect} / {resultTotal}
              </p>
              <p className="mt-3 text-sm text-gray-600">Calificación</p>
              <p className={`text-5xl font-bold ${getGradeColor(resultPct)}`}>{resultPct}%</p>
              <p className={`mt-2 text-lg font-medium ${getGradeColor(resultPct)}`}>
                {getGradeLabel(resultPct)}
              </p>
            </div>
            {resultBreakdown.length > 0 && (
              <div className="space-y-2 text-left">
                <p className="text-sm font-semibold text-gray-800">
                  Comparación de respuestas (alumno vs clave)
                </p>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {resultBreakdown.map((item) => (
                    <div
                      key={item.questionId}
                      className={`rounded-md border p-2 text-sm ${
                        item.isCorrect
                          ? 'border-green-200 bg-green-50'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <p className="font-medium text-gray-900">Pregunta {item.questionNumber}</p>
                      <p className="text-gray-700">
                        Alumno: <span className="font-medium">{item.studentAnswer || 'Sin respuesta'}</span>
                      </p>
                      <p className="text-gray-700">
                        Correcta: <span className="font-medium">{item.correctAnswer || '—'}</span>
                      </p>
                      <p className={item.isCorrect ? 'text-green-700' : 'text-red-700'}>
                        {item.isCorrect ? 'Correcta' : 'Incorrecta'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => {
                  setPhase('elegir');
                  setSheetIndex(0);
                  setConfirmedByQuestionId({});
                  setDraftSelections({});
                  setPreviewUrl((u) => {
                    if (u) URL.revokeObjectURL(u);
                    return null;
                  });
                  setResultPct(0);
                  setResultCorrect(0);
                  setResultTotal(0);
                  setResultBreakdown([]);
                  setSelectedStudentId('');
                }}
              >
                Calificar otro alumno (mismo examen)
              </Button>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => {
                  resetFlow();
                  setExamId('');
                }}
              >
                Escanear otro examen
              </Button>
              <Button
                className="flex-1 bg-orange-600 hover:bg-orange-700 sm:flex-none"
                asChild
              >
                <Link href={`/exams/results/${examId}`}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Ver en panel
                </Link>
              </Button>
            </div>
            <Button variant="ghost" className="w-full text-gray-600" onClick={() => router.push('/dashboard')}>
              Ir al inicio del dashboard
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
