'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  rpcCompleteStudentExamAttempt,
  rpcGetStudentExamAttempt,
  rpcStartStudentExamAttempt,
} from '@/lib/examAttemptRpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { StudentCombobox } from '@/components/student-combobox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Clock, CheckCircle, AlertCircle, Send, Video } from 'lucide-react';
import { BrandWordmark } from '@/components/brand-wordmark';
import { toast } from 'sonner';
import { Exam, Question, Student } from '@/types';
import { calculatePercentage, getGradeLabel, getGradeColor } from '@/lib/utils';
import {
  clearExamClientSession,
  readExamClientSession,
  useStudentExamProctoring,
  writeExamClientSession,
} from '@/hooks/useStudentExamProctoring';

type PreStartBlock =
  | null
  | { type: 'voided'; message?: string }
  | { type: 'submitted' }
  | { type: 'other_device' }
  | { type: 'not_allowed' }
  | { type: 'rpc_error' }
  | { type: 'answers_exist' };

const forfeitMessages: Record<string, string> = {
  tab_hidden:
    'Saliste del examen (cambio de pestaña o aplicación). El intento quedó anulado y no puedes volver a presentarlo.',
  left_page: 'Cerraste o abandonaste la página del examen. El intento quedó anulado.',
  camera_stopped: 'La cámara se desactivó durante el examen. El intento quedó anulado.',
};

function preStartMessage(block: PreStartBlock): { title: string; body: string } | null {
  if (!block) return null;
  switch (block.type) {
    case 'voided':
      return {
        title: 'Examen anulado',
        body:
          block.message?.trim() ||
          'Este intento fue cancelado. Debes contactar a tu maestro si necesitas volver a intentarlo.',
      };
    case 'submitted':
      return {
        title: 'Ya enviaste este examen',
        body: 'Cada alumno solo puede entregar una vez. Si crees que es un error, habla con tu maestro.',
      };
    case 'other_device':
      return {
        title: 'Intento en otro dispositivo',
        body:
          'Este examen ya se inició en otro navegador o dispositivo. Continúa allí o pide a tu maestro que te ayude.',
      };
    case 'not_allowed':
      return {
        title: 'No puedes acceder',
        body: 'El examen no está disponible para tu grupo o no está publicado correctamente.',
      };
    case 'rpc_error':
      return {
        title: 'Error de configuración',
        body:
          'El sistema de intentos no está disponible. Pide a tu maestro que revise la base de datos (migración exam_attempts) en Supabase.',
      };
    case 'answers_exist':
      return {
        title: 'Respuestas ya registradas',
        body: 'Ya constan respuestas tuyas para este examen. No puedes volver a presentarlo.',
      };
    default:
      return null;
  }
}

export default function StudentExamPage() {
  const params = useParams();
  const examId = params.examId as string;

  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [preStartBlock, setPreStartBlock] = useState<PreStartBlock>(null);
  const [checkingAttempt, setCheckingAttempt] = useState(false);
  const [startingExam, setStartingExam] = useState(false);
  const [clientSessionToken, setClientSessionToken] = useState<string | null>(null);
  const [forfeitReason, setForfeitReason] = useState<string | null>(null);
  const [cameraPortalReady, setCameraPortalReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const { bindStream, stopStream } = useStudentExamProctoring({
    examId,
    studentId: selectedStudentId || null,
    clientSession: clientSessionToken,
    active: Boolean(hasStarted && !submitted && !forfeitReason && clientSessionToken),
    onForfeit: (reason) => {
      previewStreamRef.current = null;
      clearExamClientSession(examId, selectedStudentId);
      setClientSessionToken(null);
      setForfeitReason(reason);
      toast.error('Examen anulado', { duration: 6000 });
    },
  });

  useEffect(() => {
    setCameraPortalReady(true);
  }, []);

  useLayoutEffect(() => {
    if (!hasStarted || submitted || forfeitReason) return;
    const el = videoRef.current;
    const stream = previewStreamRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [hasStarted, submitted, forfeitReason]);

  useEffect(() => {
    fetchExam();
  }, [examId]);

  useEffect(() => {
    setClientSessionToken(null);
    setForfeitReason(null);
    setPreStartBlock(null);
  }, [selectedStudentId, examId]);

  useEffect(() => {
    if (!exam?.group_id || !selectedStudentId) {
      setPreStartBlock(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setCheckingAttempt(true);
      try {
        const { count, error: countError } = await supabase
          .from('answers')
          .select('id', { count: 'exact', head: true })
          .eq('exam_id', examId)
          .eq('student_id', selectedStudentId);

        if (cancelled) return;
        if (countError) throw countError;
        if (count != null && count > 0) {
          setPreStartBlock({ type: 'answers_exist' });
          return;
        }

        const session = readExamClientSession(examId, selectedStudentId);
        const data = await rpcGetStudentExamAttempt(examId, selectedStudentId, session);

        if (cancelled) return;
        if (data.ok === false && data.error === 'not_allowed') {
          setPreStartBlock({ type: 'not_allowed' });
          return;
        }
        if (data.state === 'voided') {
          setPreStartBlock({ type: 'voided', message: data.void_reason ?? undefined });
          return;
        }
        if (data.state === 'submitted') {
          setPreStartBlock({ type: 'submitted' });
          return;
        }
        if (data.state === 'in_progress' && data.other_device) {
          setPreStartBlock({ type: 'other_device' });
          return;
        }
        setPreStartBlock(null);
      } catch {
        if (!cancelled) setPreStartBlock({ type: 'rpc_error' });
      } finally {
        if (!cancelled) setCheckingAttempt(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [exam?.group_id, examId, selectedStudentId]);

  useEffect(() => {
    if (!hasStarted || submitted || forfeitReason) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [hasStarted, submitted, forfeitReason]);

  const fetchExam = async () => {
    try {
      setLoading(true);

      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('*')
        .eq('id', examId)
        .eq('status', 'published')
        .single();

      if (examError || !examData) {
        toast.error('Examen no encontrado o no está disponible');
        return;
      }

      setExam(examData);

      const { data: questionsData, error: questionsError } = await supabase
        .from('questions')
        .select('*')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true });

      if (questionsError) throw questionsError;
      setQuestions(questionsData || []);

      if (examData.group_id) {
        const { data: studentsData, error: studentsError } = await supabase
          .from('students')
          .select('*')
          .eq('group_id', examData.group_id);

        if (!studentsError) {
          setStudents(studentsData || []);
        }
      }
    } catch {
      toast.error('Error al cargar el examen');
    } finally {
      setLoading(false);
    }
  };

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [students]
  );

  const selectedStudentName =
    sortedStudents.find((s) => s.id === selectedStudentId)?.name ?? '';

  const handleStartExam = async () => {
    if (!selectedStudentId) {
      toast.error('Selecciona tu nombre de la lista');
      return;
    }
    if (!sortedStudents.some((s) => s.id === selectedStudentId)) {
      toast.error('Debes elegir un alumno válido de la lista');
      return;
    }
    if (preStartBlock) {
      toast.error('No puedes comenzar este examen en este momento');
      return;
    }

    setStartingExam(true);
    const token = readExamClientSession(examId, selectedStudentId) || crypto.randomUUID();

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
      } catch {
        toast.error('Debes permitir la cámara para hacer el examen');
        setStartingExam(false);
        return;
      }

      const start = await rpcStartStudentExamAttempt(examId, selectedStudentId, token);
      if (!start.ok) {
        stream.getTracks().forEach((t) => t.stop());
        if (start.error === 'voided') {
          setPreStartBlock({ type: 'voided', message: start.void_reason ?? undefined });
          toast.error('Este intento ya fue anulado');
        } else if (start.error === 'already_submitted') {
          setPreStartBlock({ type: 'submitted' });
          toast.error('Ya enviaste este examen');
        } else if (start.error === 'in_progress_other') {
          setPreStartBlock({ type: 'other_device' });
          toast.error('El examen está abierto en otro dispositivo');
        } else if (start.error === 'not_allowed') {
          setPreStartBlock({ type: 'not_allowed' });
        } else {
          toast.error('No se pudo iniciar el examen');
        }
        setStartingExam(false);
        return;
      }

      writeExamClientSession(examId, selectedStudentId, token);
      setClientSessionToken(token);
      previewStreamRef.current = stream;
      bindStream(stream);

      setHasStarted(true);
    } catch {
      toast.error('Error al iniciar. Si persiste, avisa a tu maestro (¿migración Supabase aplicada?).');
      setPreStartBlock({ type: 'rpc_error' });
    } finally {
      setStartingExam(false);
    }
  };

  const handleAnswerChange = (questionId: string, answer: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  const handleSubmit = async () => {
    const unansweredQuestions = questions.filter((q) => !answers[q.id]);
    if (unansweredQuestions.length > 0) {
      toast.error(`Faltan ${unansweredQuestions.length} preguntas por responder`);
      return;
    }

    if (!selectedStudentId || !sortedStudents.some((s) => s.id === selectedStudentId)) {
      toast.error('Sesión de alumno no válida. Vuelve a elegir tu nombre.');
      return;
    }
    if (!clientSessionToken) {
      toast.error('Sesión de examen no válida');
      return;
    }

    setSubmitting(true);

    try {
      const studentId = selectedStudentId;

      let openSkippedAi = false;
      const graded = await Promise.all(
        questions.map(async (question) => {
          const answerText = answers[question.id];
          if (question.type === 'multiple_choice') {
            const isCorrect = answerText === question.correct_answer;
            return {
              exam_id: examId,
              student_id: studentId,
              question_id: question.id,
              answer_text: answerText,
              is_correct: isCorrect as boolean | null,
              score: isCorrect ? 1 : 0,
              _points: isCorrect ? 1 : 0,
            };
          }

          try {
            const res = await fetch('/api/grade/open-answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                questionText: question.text,
                referenceAnswer: question.correct_answer,
                studentAnswer: answerText,
              }),
            });
            if (res.status === 503) {
              openSkippedAi = true;
              return {
                exam_id: examId,
                student_id: studentId,
                question_id: question.id,
                answer_text: answerText,
                is_correct: null,
                score: null,
                _points: 0,
              };
            }
            if (!res.ok) {
              return {
                exam_id: examId,
                student_id: studentId,
                question_id: question.id,
                answer_text: answerText,
                is_correct: false,
                score: 0,
                _points: 0,
              };
            }
            const j = (await res.json()) as { score?: number; is_correct?: boolean };
            const sc = j.score === 1 ? 1 : 0;
            return {
              exam_id: examId,
              student_id: studentId,
              question_id: question.id,
              answer_text: answerText,
              is_correct: sc === 1,
              score: sc,
              _points: sc,
            };
          } catch {
            return {
              exam_id: examId,
              student_id: studentId,
              question_id: question.id,
              answer_text: answerText,
              is_correct: false,
              score: 0,
              _points: 0,
            };
          }
        })
      );

      const answersToInsert = graded.map(({ _points: _p, ...row }) => row);

      const { error: answersError } = await supabase.from('answers').insert(answersToInsert);

      if (answersError) throw answersError;

      const completed = await rpcCompleteStudentExamAttempt(examId, studentId, clientSessionToken);
      if (!completed) {
        toast.error('Respuestas guardadas, pero no se pudo cerrar el intento. Avisa a tu maestro.');
      }

      stopStream();
      previewStreamRef.current = null;
      clearExamClientSession(examId, studentId);
      setClientSessionToken(null);

      const totalPoints = questions.length;
      const obtainedPoints = graded.reduce((s, r) => s + r._points, 0);
      setScore(calculatePercentage(obtainedPoints, totalPoints));
      setSubmitted(true);
      toast.success('¡Examen enviado exitosamente!');
      if (openSkippedAi) {
        toast.message(
          'Hay preguntas abiertas sin calificación automática: falta OPENAI_API_KEY en el servidor.',
          { duration: 6000 }
        );
      }
    } catch {
      toast.error('Error al enviar el examen');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-white/35 backdrop-blur-[2px]">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-white/35 p-4 backdrop-blur-[2px]">
        <Card className="w-full max-w-md p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-16 w-16 text-red-500" />
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Examen no disponible</h1>
          <p className="text-gray-600">Este examen no existe o no está disponible actualmente.</p>
        </Card>
      </div>
    );
  }

  if (forfeitReason) {
    const msg = forfeitMessages[forfeitReason] ?? 'El examen fue anulado. No puedes volver a presentarlo.';
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-white/35 p-4 backdrop-blur-[2px] app-scroll">
        <Card className="w-full max-w-md p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-16 w-16 text-amber-600" />
          <h1 className="mb-2 text-xl font-bold text-gray-900">Intento anulado</h1>
          <p className="text-gray-600">{msg}</p>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white/35 px-4 py-8 backdrop-blur-[2px] app-scroll">
        <div className="mx-auto max-w-2xl">
          <Card className="p-8 text-center">
            <CheckCircle className="mx-auto mb-6 h-20 w-20 text-green-500" />
            <h1 className="mb-2 text-3xl font-bold text-gray-900">¡Examen completado!</h1>
            <p className="mb-6 text-gray-600">Gracias por participar, {selectedStudentName}</p>

            <div className="mb-6 rounded-lg bg-white/35 p-6 backdrop-blur-[2px]">
              <p className="mb-2 text-sm text-gray-500">Tu calificación</p>
              <p className={`text-5xl font-bold ${getGradeColor(score)}`}>{score}%</p>
              <p className={`mt-2 text-lg font-medium ${getGradeColor(score)}`}>
                {getGradeLabel(score)}
              </p>
            </div>

            <p className="text-sm text-gray-500">Los resultados han sido enviados a tu maestro.</p>
          </Card>
        </div>
      </div>
    );
  }

  if (!hasStarted) {
    const blockMsg = preStartMessage(preStartBlock);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white/35 px-4 py-8 backdrop-blur-[2px] app-scroll">
        <div className="mx-auto max-w-md">
          <div className="mb-10 flex justify-center px-1">
            <BrandWordmark
              href={false}
              imgClassName="h-16 w-auto max-w-[min(100%,26rem)] object-contain sm:h-20 sm:max-w-[30rem] lg:h-[5.5rem] lg:max-w-[34rem]"
            />
          </div>

          {blockMsg ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-center text-xl text-amber-800">{blockMsg.title}</CardTitle>
                <CardDescription className="text-center text-base text-gray-600">
                  {blockMsg.body}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-center text-2xl">{exam.title}</CardTitle>
                <CardDescription className="text-center">
                  {exam.description || 'Completa el siguiente examen'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {questions.length} preguntas
                  </div>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950">
                  <p className="mb-2 flex items-center gap-2 font-semibold">
                    <Video className="h-4 w-4 shrink-0" />
                    Normas del examen
                  </p>
                  <ul className="list-inside list-disc space-y-1 text-amber-900/90">
                    <li>La cámara frontal debe estar activa todo el tiempo.</li>
                    <li>No cambies de pestaña ni cierres esta ventana; si lo haces, el examen se anula.</li>
                    <li>Solo hay un intento por alumno.</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="student-picker">Selecciona tu nombre</Label>
                  <StudentCombobox
                    id="student-picker"
                    students={sortedStudents}
                    value={selectedStudentId}
                    onValueChange={setSelectedStudentId}
                    placeholder="Busca y elige tu nombre en la lista"
                    searchPlaceholder="Escribe para buscar tu nombre…"
                    emptyText="Ningún nombre coincide. Revisa la ortografía o pide ayuda a tu maestro."
                    noStudentsText={
                      !exam.group_id
                        ? 'Este examen no está asignado a un grupo con lista de alumnos. El maestro debe asignar un grupo en la configuración del examen y registrar alumnos en Grupos.'
                        : undefined
                    }
                  />
                  <p className="text-sm text-gray-500">
                    Debes elegir tu nombre en la lista; no se puede escribir a mano para evitar errores.
                  </p>
                </div>

                <Button
                  onClick={() => void handleStartExam()}
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  disabled={
                    sortedStudents.length === 0 ||
                    !selectedStudentId ||
                    Boolean(preStartBlock) ||
                    checkingAttempt ||
                    startingExam
                  }
                >
                  {checkingAttempt || startingExam ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {startingExam ? 'Activando cámara…' : 'Comprobando…'}
                    </>
                  ) : (
                    'Comenzar examen (cámara obligatoria)'
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-y-auto bg-white/35 px-4 pb-24 pt-8 backdrop-blur-[2px] app-scroll">
      {hasStarted &&
        !submitted &&
        !forfeitReason &&
        cameraPortalReady &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[85] flex flex-col items-end gap-1"
            style={{
              right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
              bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
            }}
          >
            <span className="rounded-md bg-orange-600/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
              Cámara
            </span>
            <video
              ref={videoRef}
              className="h-[5.5rem] w-[6.75rem] rounded-xl border-[3px] border-orange-500 bg-black object-cover shadow-xl ring-1 ring-orange-300/40 sm:h-28 sm:w-32"
              playsInline
              muted
              autoPlay
              aria-label="Vista previa de la cámara del examen"
            />
          </div>,
          document.body
        )}

      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{exam.title}</h1>
          <p className="text-gray-600">Estudiante: {selectedStudentName}</p>
        </div>

        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-sm text-gray-500">
            <span>Progreso</span>
            <span>
              {Object.keys(answers).length} de {questions.length} preguntas
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-orange-600 transition-all"
              style={{
                width: `${(Object.keys(answers).length / Math.max(questions.length, 1)) * 100}%`,
              }}
            />
          </div>
        </div>

        <div className="space-y-6">
          {questions.map((question, index) => (
            <Card key={question.id}>
              <CardContent className="p-6">
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-600">
                    {index + 1}
                  </span>
                  <p className="text-lg font-medium">{question.text}</p>
                </div>

                {question.illustration && (
                  <div className="mb-4 ml-11 rounded-lg bg-white/35 p-4 backdrop-blur-[2px]">
                    <p className="text-sm italic text-gray-500">
                      <span className="font-medium">Ilustración:</span> {question.illustration}
                    </p>
                  </div>
                )}

                {question.type === 'multiple_choice' && question.options && (
                  <RadioGroup
                    value={answers[question.id] || ''}
                    onValueChange={(value) => handleAnswerChange(question.id, value)}
                    className="ml-11 space-y-2"
                  >
                    {question.options.map((option, optIndex) => (
                      <div key={optIndex} className="flex items-center space-x-2">
                        <RadioGroupItem value={option} id={`q${question.id}-opt${optIndex}`} />
                        <Label
                          htmlFor={`q${question.id}-opt${optIndex}`}
                          className="cursor-pointer font-normal"
                        >
                          {String.fromCharCode(65 + optIndex)}. {option}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}

                {question.type === 'open_answer' && (
                  <div className="ml-11">
                    <Textarea
                      placeholder="Escribe tu respuesta aquí..."
                      value={answers[question.id] || ''}
                      onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                      rows={4}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-8">
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || Object.keys(answers).length < questions.length}
            className="w-full bg-orange-600 py-6 text-lg hover:bg-orange-700"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Enviando…
              </>
            ) : (
              <>
                <Send className="mr-2 h-5 w-5" />
                Enviar examen
              </>
            )}
          </Button>
          {Object.keys(answers).length < questions.length && (
            <p className="mt-2 text-center text-sm text-gray-500">
              Responde todas las preguntas para poder enviar
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
