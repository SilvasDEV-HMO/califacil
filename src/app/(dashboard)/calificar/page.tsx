'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle, LayoutDashboard, Loader2, Scan, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useExam, useExams } from '@/hooks/useExams';
import { supabase } from '@/lib/supabase';
import {
  chunkQuestions,
  califacilOmrColumnCount,
  examSupportsCalifacilOmr,
} from '@/lib/printExam';
import { autoOrientCalifacilSheet, fileToImage, scanCalifacilOmrSheet } from '@/lib/omrScan';
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Abre la cámara para detectar respuestas en vivo.');
  const [liveResolvedCount, setLiveResolvedCount] = useState(0);
  const [liveDraftSelections, setLiveDraftSelections] = useState<Record<string, string>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveTickRef = useRef<number | null>(null);
  const liveBusyRef = useRef(false);
  const stableReadyTicksRef = useRef(0);
  const scanBusyRef = useRef(false);

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

  const stopLiveCamera = useCallback(() => {
    if (liveTickRef.current !== null) {
      window.clearInterval(liveTickRef.current);
      liveTickRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    stableReadyTicksRef.current = 0;
    setCameraOpen(false);
  }, []);

  const mapRawToDraft = useCallback(
    (raw: (number | null)[], chunk: Question[]) => {
      const nextDraft: Record<string, string> = {};
      let unresolvedCount = 0;
      for (let i = 0; i < chunk.length; i++) {
        const q = chunk[i];
        const opts = q.options ?? [];
        const col = raw[i];
        const value = col !== null && col < opts.length ? opts[col] : '';
        nextDraft[q.id] = value;
        if (!value) unresolvedCount++;
      }
      return {
        draft: nextDraft,
        unresolvedCount,
        resolvedCount: chunk.length - unresolvedCount,
      };
    },
    []
  );

  const setPreviewFromSource = useCallback(
    async (source: HTMLImageElement | HTMLCanvasElement, fallbackFile?: File) => {
      let nextUrl: string | null = null;
      if (source instanceof HTMLCanvasElement) {
        const blob = await new Promise<Blob | null>((resolve) => {
          source.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
        });
        if (blob) nextUrl = URL.createObjectURL(blob);
      } else if (fallbackFile) {
        nextUrl = URL.createObjectURL(fallbackFile);
      }
      if (!nextUrl && fallbackFile) nextUrl = URL.createObjectURL(fallbackFile);
      if (nextUrl) {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextUrl;
        });
      }
    },
    []
  );

  const finalizeCapturedSheet = useCallback(
    async (source: HTMLImageElement | HTMLCanvasElement, fallbackFile?: File) => {
      const chunk = sheets[sheetIndex] ?? [];
      const oriented = autoOrientCalifacilSheet(source, omrCols) ?? source;
      const raw = scanCalifacilOmrSheet(oriented, omrCols);
      const mapped = mapRawToDraft(raw, chunk);
      const minResolved = Math.max(1, Math.ceil(chunk.length * 0.6));
      if (mapped.resolvedCount < minResolved) {
        setDraftSelections({});
        setLiveDraftSelections(mapped.draft);
        setLiveResolvedCount(mapped.resolvedCount);
        setLiveStatus('Lectura insuficiente: acerca el recuadro, mejora luz y evita sombras.');
        toast.error(
          'La captura no tiene calidad suficiente para leer el recuadro. Acerca más la cámara y vuelve a intentar.'
        );
        return false;
      }

      await setPreviewFromSource(oriented, fallbackFile);
      setDraftSelections(mapped.draft);
      setLiveDraftSelections(mapped.draft);
      setLiveResolvedCount(mapped.resolvedCount);
      setPhase('revisar_hoja');
      setLiveStatus(
        mapped.unresolvedCount > 0
          ? `Lectura parcial: ${mapped.unresolvedCount} sin lectura clara.`
          : 'Lectura completa lista para confirmar.'
      );
      const scanNote =
        mapped.unresolvedCount > 0
          ? `Lectura realizada (${mapped.unresolvedCount} sin lectura clara). Revisa y confirma.`
          : 'Lectura realizada. Revisa y confirma.';
      toast.message(scanNote);
      return true;
    },
    [mapRawToDraft, omrCols, setPreviewFromSource, sheetIndex, sheets]
  );

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

  useEffect(() => {
    if (phase !== 'capturar' && cameraOpen) {
      stopLiveCamera();
    }
  }, [cameraOpen, phase, stopLiveCamera]);

  useEffect(() => {
    scanBusyRef.current = scanBusy;
  }, [scanBusy]);

  useEffect(() => {
    return () => {
      stopLiveCamera();
    };
  }, [stopLiveCamera]);

  const resetFlow = useCallback(() => {
    stopLiveCamera();
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus('Abre la cámara para detectar respuestas en vivo.');
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setResultPct(0);
    setResultCorrect(0);
    setResultTotal(0);
    setResultBreakdown([]);
    setSelectedStudentId('');
  }, [stopLiveCamera]);

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
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus('Abre la cámara para detectar respuestas en vivo.');
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
      const img = await fileToImage(file);
      await finalizeCapturedSheet(img, file);
    } catch {
      toast.error('No se pudo procesar la foto. Intenta otra con mejor luz y encuadre.');
    } finally {
      setScanBusy(false);
    }
  };

  const startLiveCamera = async () => {
    if (cameraOpen) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setLiveStatus('Cámara activa. Encuadra solo la banda CaliFacil dentro del marco.');
      setLiveResolvedCount(0);
      setLiveDraftSelections({});
      stableReadyTicksRef.current = 0;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      liveTickRef.current = window.setInterval(async () => {
        if (liveBusyRef.current) return;
        const video = videoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth < 40 || video.videoHeight < 40) return;
        liveBusyRef.current = true;
        try {
          const frame = document.createElement('canvas');
          frame.width = video.videoWidth;
          frame.height = video.videoHeight;
          const ctx = frame.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, frame.width, frame.height);

          const chunk = sheets[sheetIndex] ?? [];
          const oriented = autoOrientCalifacilSheet(frame, omrCols) ?? frame;
          const raw = scanCalifacilOmrSheet(oriented, omrCols);
          const mapped = mapRawToDraft(raw, chunk);
          setLiveDraftSelections(mapped.draft);
          setLiveResolvedCount(mapped.resolvedCount);

          const minResolved = Math.max(1, Math.ceil(chunk.length * 0.6));
          if (mapped.resolvedCount >= chunk.length) {
            setLiveStatus('Detección completa. Captura lista.');
          } else if (mapped.resolvedCount >= minResolved) {
            setLiveStatus('Detección estable. Puedes capturar ahora.');
          } else if (mapped.resolvedCount >= Math.ceil(chunk.length * 0.3)) {
            setLiveStatus('Casi listo: centra mejor el recuadro y aumenta luz.');
          } else {
            setLiveStatus('Ajusta cámara: acerca la banda CaliFacil y evita sombras.');
          }

          if (mapped.resolvedCount >= minResolved) {
            stableReadyTicksRef.current += 1;
          } else {
            stableReadyTicksRef.current = 0;
          }

          if (stableReadyTicksRef.current >= 3 && !scanBusyRef.current) {
            stableReadyTicksRef.current = -999;
            setScanBusy(true);
            const ok = await finalizeCapturedSheet(oriented);
            setScanBusy(false);
            if (ok) stopLiveCamera();
          }
        } finally {
          liveBusyRef.current = false;
        }
      }, 700);
    } catch {
      toast.error('No se pudo abrir la cámara. Revisa permisos o usa "Subir foto".');
      setCameraOpen(false);
    }
  };

  const captureLiveNow = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth < 40 || video.videoHeight < 40) {
      toast.error('La cámara aún no está lista.');
      return;
    }
    setScanBusy(true);
    try {
      const frame = document.createElement('canvas');
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      const ctx = frame.getContext('2d');
      if (!ctx) {
        toast.error('No se pudo capturar el fotograma.');
        return;
      }
      ctx.drawImage(video, 0, 0, frame.width, frame.height);
      const ok = await finalizeCapturedSheet(frame);
      if (ok) stopLiveCamera();
    } catch {
      toast.error('No se pudo capturar desde la cámara.');
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

  const openFilePicker = () => fileRef.current?.click();

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
              <div className="space-y-3">
                {!cameraOpen ? (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      size="lg"
                      className="h-14 w-full gap-2 bg-orange-600 text-base hover:bg-orange-700"
                      onClick={() => void startLiveCamera()}
                      disabled={scanBusy}
                    >
                      {scanBusy ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        <Camera className="h-6 w-6" />
                      )}
                      Abrir cámara en vivo
                    </Button>
                    <Button type="button" variant="outline" className="w-full" onClick={openFilePicker}>
                      Subir foto manual
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative overflow-hidden rounded-lg border bg-black">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video ref={videoRef} autoPlay playsInline muted className="w-full object-cover" />
                      <div className="pointer-events-none absolute inset-[12%] rounded-xl border-2 border-orange-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
                    </div>
                    <div className="rounded-md border bg-orange-50 px-3 py-2 text-sm text-orange-900">
                      {liveStatus}
                    </div>
                    <p className="text-xs text-gray-500">
                      Detectadas en vivo: {liveResolvedCount}/{currentChunk.length}. Auto-captura cuando esté
                      estable.
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {currentChunk.map((q, idx) => {
                        const detected = liveDraftSelections[q.id] || '';
                        const liveCorrect =
                          detected && q.type === 'multiple_choice'
                            ? isMultipleChoiceAnswerCorrect(q.options, detected, q.correct_answer)
                            : null;
                        return (
                          <div key={q.id} className="rounded-md border bg-white px-2 py-1 text-xs">
                            <span className="font-medium">P{sheetIndex * 10 + idx + 1}</span>:{' '}
                            <span className="font-semibold">{detected || '—'}</span>{' '}
                            {liveCorrect === true ? '✅' : liveCorrect === false ? '❌' : '•'}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1 bg-orange-600 hover:bg-orange-700" onClick={() => void captureLiveNow()} disabled={scanBusy}>
                        {scanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Capturar ahora'}
                      </Button>
                      <Button variant="outline" className="flex-1" onClick={stopLiveCamera}>
                        Cerrar cámara
                      </Button>
                    </div>
                  </div>
                )}
              </div>
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
