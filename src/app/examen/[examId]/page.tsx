'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { examPublicSupabase } from '@/lib/supabase';
import { sortExamQuestions } from '@/lib/examQuestions';
import {
  rpcCompleteStudentExamAttempt,
  rpcGetStudentExamAttempt,
  rpcLogExamAttemptEvent,
  rpcStartStudentExamAttempt,
  rpcStudentAnswerCount,
} from '@/lib/examAttemptRpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { StudentCombobox } from '@/components/student-combobox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Clock, CheckCircle, AlertCircle, Send, Video, Monitor } from 'lucide-react';
import { BrandWordmark } from '@/components/brand-wordmark';
import { QuestionIllustration } from '@/components/question-illustration';
import { ExamWhiteboard } from '@/components/exam-whiteboard';
import { ExamCaptureBlockedOverlay } from '@/components/exam-capture-blocked-overlay';
import type { ExamProtectionOverlayVariant } from '@/components/exam-capture-blocked-overlay';
import { ExamAntiLeakWatermark } from '@/components/exam-anti-leak-watermark';
import {
  CAPTURE_FORFEIT_DELAY_MS,
  clearExamClipboardAccess,
  warmupExamClipboardAccess,
} from '@/lib/examAntiCapture';
import {
  isWhiteboardQuestion,
  isWhiteboardStudentAnswer,
} from '@/lib/whiteboardAnswer';
import { requestExamScreenShare, isExamScreenShareSupported } from '@/lib/examScreenShare';
import { toast } from 'sonner';
import { Exam, Question, Student } from '@/types';
import {
  calculatePercentage,
  examMaxScore,
  getGradeLabel,
  getGradeColor,
  isMultipleChoiceAnswerCorrect,
  questionPoints,
  shuffleArray,
} from '@/lib/utils';
import { examForfeitMessages } from '@/lib/examForfeitMessages';
import {
  type ExamFullscreenMode,
  EXAM_PSEUDO_FULLSCREEN_CLASS,
  enterExamFullscreen,
  exitExamFullscreenSafe,
  isMobileExamDevice,
  lockExamKeyboard,
  setExamImmersiveRoot,
  unlockExamKeyboard,
} from '@/lib/examFullscreen';
import { EXAM_SECURE_BODY_CLASS } from '@/lib/examAntiCapture';
import {
  clearExamClientSession,
  readExamClientSession,
  useStudentExamProctoring,
  writeExamClientSession,
} from '@/hooks/useStudentExamProctoring';
import { cn } from '@/lib/utils';

type PreStartBlock =
  | null
  | { type: 'voided'; message?: string }
  | { type: 'submitted' }
  | { type: 'other_device' }
  | { type: 'not_allowed' }
  | { type: 'rpc_error' }
  | { type: 'answers_exist' };

const forfeitMessages = examForfeitMessages;

const VIRTUAL_CAMERA_RE = /(droidcam|airdroid|iriun|epoccam|obs|virtual|ndi)/i;

function isVirtualCameraLabel(label: string | undefined): boolean {
  return Boolean(label && VIRTUAL_CAMERA_RE.test(label));
}

async function pickPreferredDesktopCameraDeviceId(excludeDeviceId?: string): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videos = devices.filter((d) => d.kind === 'videoinput');
  if (videos.length === 0) return null;
  const filtered = videos.filter((d) => d.deviceId && d.deviceId !== excludeDeviceId);
  const preferred =
    filtered.find((d) => !isVirtualCameraLabel(d.label)) ??
    videos.find((d) => !isVirtualCameraLabel(d.label)) ??
    filtered[0] ??
    videos[0];
  return preferred?.deviceId ?? null;
}

function preStartMessage(block: PreStartBlock): { title: string; body: string } | null {
  if (!block) return null;
  switch (block.type) {
    case 'voided':
      const voidReason = block.message?.trim() ?? '';
      return {
        title: 'Examen anulado',
        body:
          (voidReason === 'left_fullscreen' ? 'Pide ayuda a tu Maestro' : voidReason) ||
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
  const [allowedGroupIds, setAllowedGroupIds] = useState<string[]>([]);
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
  const [fullscreenMode, setFullscreenMode] = useState<ExamFullscreenMode>('none');
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [protectionOverlay, setProtectionOverlay] = useState<ExamProtectionOverlayVariant | null>(
    null
  );
  const captureForfeitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportViolationRef = useRef<(reason: string) => void>(() => undefined);

  const clearCaptureForfeitTimer = useCallback(() => {
    if (captureForfeitTimerRef.current) {
      clearTimeout(captureForfeitTimerRef.current);
      captureForfeitTimerRef.current = null;
    }
  }, []);

  const examShellRef = useRef<HTMLDivElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const attachPreviewVideo = useCallback((node: HTMLVideoElement | null) => {
    if (!node) return;
    const stream = previewStreamRef.current;
    if (!stream) return;
    node.srcObject = stream;
    void node.play().catch(() => undefined);
  }, []);

  const logAttemptEvent = useCallback(
    (eventType: string, metadata?: Record<string, unknown>) => {
      if (!selectedStudentId || !clientSessionToken) return;
      void rpcLogExamAttemptEvent(examId, selectedStudentId, clientSessionToken, eventType, metadata ?? null);
    },
    [examId, selectedStudentId, clientSessionToken]
  );

  const { bindStream, bindScreenStream, stopStream, reportViolation } = useStudentExamProctoring({
    examId,
    studentId: selectedStudentId || null,
    clientSession: clientSessionToken,
    active: Boolean(hasStarted && !submitted && !forfeitReason && clientSessionToken),
    fullscreenMode,
    onForfeit: (reason, voidPersisted) => {
      clearCaptureForfeitTimer();
      clearExamClipboardAccess();
      setProtectionOverlay(null);
      setScreenShareActive(false);
      setExamImmersiveRoot(false);
      void exitExamFullscreenSafe();
      setFullscreenMode('none');
      previewStreamRef.current = null;
      clearExamClientSession(examId, selectedStudentId);
      setClientSessionToken(null);
      setForfeitReason(reason);
      if (voidPersisted) {
        toast.error('Examen anulado', { duration: 6000 });
      } else {
        toast.error('Examen anulado en este dispositivo', {
          description: 'No se pudo registrar en el servidor. Avisa a tu maestro.',
          duration: 8000,
        });
      }
    },
    onVisibilityHidden: () => setProtectionOverlay('tab_hidden'),
    onVisibilityVisible: () => {
      clearCaptureForfeitTimer();
      setProtectionOverlay(null);
    },
    onCaptureAttempt: (source) => {
      setProtectionOverlay('screenshot');
      clearCaptureForfeitTimer();
      captureForfeitTimerRef.current = setTimeout(() => {
        reportViolationRef.current('capture_attempt');
      }, CAPTURE_FORFEIT_DELAY_MS);
    },
    onLogEvent: (eventType, metadata) => logAttemptEvent(eventType, metadata),
  });

  reportViolationRef.current = reportViolation;

  useEffect(() => {
    return () => clearCaptureForfeitTimer();
  }, [clearCaptureForfeitTimer]);

  const fetchExam = useCallback(async () => {
    try {
      setLoading(true);

      const { data: examData, error: examError } = await examPublicSupabase
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

      const { data: questionsData, error: questionsError } = await examPublicSupabase
        .from('questions')
        .select('*')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true });

      if (questionsError) throw questionsError;
      setQuestions(sortExamQuestions(questionsData || []));

      const { data: assignmentData } = await examPublicSupabase
        .from('exam_group_assignments')
        .select('group_id')
        .eq('exam_id', examId);

      const assignedGroupIds = (assignmentData || [])
        .map((row) => row.group_id as string)
        .filter(Boolean);
      const fallbackGroupId = examData.group_id ? [examData.group_id] : [];
      const examGroupIds = assignedGroupIds.length > 0 ? assignedGroupIds : fallbackGroupId;
      setAllowedGroupIds(examGroupIds);

      if (examGroupIds.length > 0) {
        const { data: studentsData, error: studentsError } = await examPublicSupabase
          .from('students')
          .select('*')
          .in('group_id', examGroupIds);

        if (!studentsError) {
          setStudents(studentsData || []);
        }
      } else {
        setStudents([]);
      }
    } catch {
      toast.error('Error al cargar el examen');
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    void fetchExam();
  }, [fetchExam]);

  useEffect(() => {
    setClientSessionToken(null);
    setForfeitReason(null);
    setPreStartBlock(null);
    setFullscreenMode('none');
  }, [selectedStudentId, examId]);

  useEffect(() => {
    if (!selectedStudentId) {
      setPreStartBlock(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setCheckingAttempt(true);
      try {
        let answerCount: number;
        try {
          answerCount = await rpcStudentAnswerCount(examId, selectedStudentId);
        } catch {
          if (!cancelled) setPreStartBlock({ type: 'rpc_error' });
          return;
        }

        if (cancelled) return;
        if (answerCount < 0) {
          setPreStartBlock({ type: 'not_allowed' });
          return;
        }
        if (answerCount > 0) {
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
  }, [exam?.id, examId, selectedStudentId]);

  useEffect(() => {
    if (!hasStarted || submitted || forfeitReason) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [hasStarted, submitted, forfeitReason]);

  useEffect(() => {
    if (!hasStarted || submitted || forfeitReason) return;
    const blockCopy = (e: Event) => {
      if (e.type === 'selectstart' && isMobileExamDevice()) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('input, textarea, [contenteditable="true"]')) {
          return;
        }
      }
      e.preventDefault();
    };
    const opts = { capture: true } as AddEventListenerOptions;
    document.addEventListener('copy', blockCopy, opts);
    document.addEventListener('cut', blockCopy, opts);
    document.addEventListener('contextmenu', blockCopy, opts);
    document.addEventListener('dragstart', blockCopy, opts);
    document.addEventListener('selectstart', blockCopy, opts);
    return () => {
      document.removeEventListener('copy', blockCopy, opts);
      document.removeEventListener('cut', blockCopy, opts);
      document.removeEventListener('contextmenu', blockCopy, opts);
      document.removeEventListener('dragstart', blockCopy, opts);
      document.removeEventListener('selectstart', blockCopy, opts);
    };
  }, [hasStarted, submitted, forfeitReason]);

  useEffect(() => {
    if (!hasStarted || submitted || forfeitReason) {
      document.body.classList.remove(EXAM_SECURE_BODY_CLASS);
      return;
    }
    document.body.classList.add(EXAM_SECURE_BODY_CLASS);
    return () => document.body.classList.remove(EXAM_SECURE_BODY_CLASS);
  }, [hasStarted, submitted, forfeitReason]);

  useLayoutEffect(() => {
    if (!hasStarted || submitted || forfeitReason) {
      setExamImmersiveRoot(false);
      return;
    }

    if (isMobileExamDevice()) {
      setExamImmersiveRoot(true);
      setFullscreenMode('pseudo');
      return () => setExamImmersiveRoot(false);
    }

    let cancelled = false;
    const run = async () => {
      const el = examShellRef.current;
      if (!el || cancelled) return;
      const mode = await enterExamFullscreen(el);
      if (!cancelled) setFullscreenMode(mode);
      if (!cancelled && mode === 'native') {
        await lockExamKeyboard();
      }
    };
    void run();
    return () => {
      cancelled = true;
      void unlockExamKeyboard();
    };
  }, [hasStarted, submitted, forfeitReason]);

  useEffect(() => {
    if (!hasStarted || submitted || forfeitReason || fullscreenMode !== 'pseudo') return;
    const shell = examShellRef.current;
    if (!shell) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || shell.contains(target)) return;
      const camera = document.querySelector('[aria-label="Vista previa de la cámara del examen"]');
      if (camera?.contains(target)) return;
      reportViolation('left_fullscreen');
    };

    const opts = { capture: true } as AddEventListenerOptions;
    document.addEventListener('pointerdown', onPointerDown, opts);
    return () => document.removeEventListener('pointerdown', onPointerDown, opts);
  }, [hasStarted, submitted, forfeitReason, fullscreenMode, reportViolation]);

  useEffect(() => {
    if (hasStarted && !submitted && !forfeitReason) return;
    setExamImmersiveRoot(false);
    void exitExamFullscreenSafe();
    setFullscreenMode('none');
  }, [hasStarted, submitted, forfeitReason]);

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
      toast.message('Protección del examen', {
        description:
          'Si el navegador pide permiso de portapapeles, acéptalo para detectar capturas de pantalla.',
        duration: 5000,
      });
      const clipboardAccess = await warmupExamClipboardAccess();
      if (clipboardAccess === 'granted') {
        toast.success('Protección antcapturas activa');
      } else if (clipboardAccess === 'denied') {
        toast.warning('Detección de capturas limitada', {
          description:
            'Sin permiso de portapapeles algunas capturas podrían no detectarse. El examen puede continuar.',
          duration: 7000,
        });
      }

      let stream: MediaStream | null = null;
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const attempts: MediaStreamConstraints[] = [
          { video: { facingMode: { ideal: 'user' } }, audio: false },
          { video: { facingMode: 'user' }, audio: false },
          { video: true, audio: false },
        ];
        for (const constraints of attempts) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (stream) break;
          } catch {
            /* siguiente perfil (p. ej. escritorio sin facingMode) */
          }
        }
      }
      if (!stream) {
        toast.error('Debes permitir la cámara para hacer el examen');
        setStartingExam(false);
        return;
      }

      const initialTrack = stream.getVideoTracks()[0];
      const initialLabel = initialTrack?.label ?? '';
      if (isVirtualCameraLabel(initialLabel)) {
        const currentId =
          typeof initialTrack?.getSettings === 'function'
            ? (initialTrack.getSettings().deviceId ?? undefined)
            : undefined;
        const preferredDeviceId = await pickPreferredDesktopCameraDeviceId(currentId);
        if (preferredDeviceId) {
          try {
            const switched = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: preferredDeviceId } },
              audio: false,
            });
            stream.getTracks().forEach((t) => t.stop());
            stream = switched;
          } catch {
            // Si falla el cambio, seguimos con la cámara ya abierta.
          }
        }
      }

      const mobileDevice = isMobileExamDevice();
      let screenStream: MediaStream | null = null;

      if (!mobileDevice || isExamScreenShareSupported()) {
        toast.message('Compartir pantalla', {
          description: mobileDevice
            ? 'Si el navegador lo permite, comparte tu pantalla para vigilancia del examen.'
            : 'Elige «Pantalla completa» o «Ventana». No compartas solo esta pestaña.',
          duration: 7000,
        });

        const maxAttempts = mobileDevice ? 1 : 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const screen = await requestExamScreenShare({ rejectBrowserTabOnly: !mobileDevice });
          if (screen.ok) {
            screenStream = screen.stream;
            break;
          }
          if (screen.error === 'tab_only' && attempt < maxAttempts - 1) {
            toast.error('Comparte toda la pantalla', {
              description: 'No selecciones solo la pestaña del navegador. Vuelve a intentarlo.',
            });
            continue;
          }
          if (!mobileDevice) {
            stream.getTracks().forEach((t) => t.stop());
            if (screen.error === 'denied') {
              toast.error('Debes compartir tu pantalla para hacer el examen');
            } else if (screen.error === 'tab_only') {
              toast.error('Debes compartir toda la pantalla, no solo esta pestaña');
            } else {
              toast.error('No se pudo activar el monitoreo de pantalla');
            }
            setStartingExam(false);
            return;
          }
          break;
        }
      }

      if (!mobileDevice && !screenStream) {
        stream.getTracks().forEach((t) => t.stop());
        toast.error('Debes compartir tu pantalla para hacer el examen');
        setStartingExam(false);
        return;
      }

      const start = await rpcStartStudentExamAttempt(examId, selectedStudentId, token);
      if (!start.ok) {
        stream.getTracks().forEach((t) => t.stop());
        screenStream?.getTracks().forEach((t) => t.stop());
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
      if (screenStream) {
        bindScreenStream(screenStream);
        setScreenShareActive(true);
        void rpcLogExamAttemptEvent(examId, selectedStudentId, token, 'screen_share_started');
      } else if (mobileDevice) {
        toast.warning('Monitoreo de pantalla no disponible en este dispositivo', {
          description: 'No cambies de app ni tomes capturas; el examen se vigila por cámara y visibilidad.',
          duration: 8000,
        });
      }

      setQuestions((prev) => shuffleArray(prev));
      if (isMobileExamDevice()) {
        setFullscreenMode('pseudo');
      }
      setHasStarted(true);
      void rpcLogExamAttemptEvent(examId, selectedStudentId, token, 'exam_started');
    } catch {
      toast.error('Error al iniciar. Si persiste, avisa a tu maestro (¿migración Supabase aplicada?).');
      setPreStartBlock({ type: 'rpc_error' });
    } finally {
      setStartingExam(false);
    }
  };

  const handleAnswerChange = (questionId: string, answer: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    logAttemptEvent('answer_changed', { question_id: questionId });
  };

  const handleSubmit = async () => {
    logAttemptEvent('submit_clicked');
    const unansweredQuestions = questions.filter((q) => {
      const answer = answers[q.id];
      if (isWhiteboardQuestion(q)) return !isWhiteboardStudentAnswer(answer);
      return !answer?.trim();
    });
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
            const isCorrect = isMultipleChoiceAnswerCorrect(
              question.options,
              answerText,
              question.correct_answer
            );
            const pts = questionPoints(question);
            if (process.env.NEXT_PUBLIC_GRADING_DEBUG === 'true') {
              console.info('[grading:online]', {
                questionId: question.id,
                student: answerText,
                correct: question.correct_answer,
                ok: isCorrect,
                pts: isCorrect ? pts : 0,
              });
            }
            return {
              exam_id: examId,
              student_id: studentId,
              question_id: question.id,
              answer_text: answerText,
              is_correct: isCorrect as boolean | null,
              score: isCorrect ? pts : 0,
              _points: isCorrect ? pts : 0,
            };
          }

          if (isWhiteboardQuestion(question)) {
            try {
              const res = await fetch('/api/grade/whiteboard-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  examId,
                  studentId,
                  clientSession: clientSessionToken,
                  questionId: question.id,
                  questionText: question.text,
                  referenceAnswer: question.correct_answer,
                  studentAnswer: answerText,
                }),
              });
              const payload = (await res.json().catch(() => ({}))) as {
                code?: string;
                score?: number | null;
                is_correct?: boolean | null;
                pending?: boolean;
              };

              if (res.status === 503 && payload.code === 'NO_KEY') {
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
              if (!res.ok || payload.pending) {
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
              const sc = typeof payload.score === 'number' ? payload.score : 0;
              return {
                exam_id: examId,
                student_id: studentId,
                question_id: question.id,
                answer_text: answerText,
                is_correct: payload.is_correct === true,
                score: sc,
                _points: sc,
              };
            } catch {
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
          }

          try {
            const res = await fetch('/api/grade/open-answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                examId,
                studentId,
                clientSession: clientSessionToken,
                questionId: question.id,
                questionText: question.text,
                referenceAnswer: question.correct_answer,
                studentAnswer: answerText,
              }),
            });
            const payload = (await res.json().catch(() => ({}))) as {
              code?: string;
              score?: number;
              is_correct?: boolean;
            };

            if (res.status === 503 && payload.code === 'NO_KEY') {
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
            const sc = typeof payload.score === 'number' ? payload.score : 0;
            return {
              exam_id: examId,
              student_id: studentId,
              question_id: question.id,
              answer_text: answerText,
              is_correct: sc > 0,
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

      const { error: answersError } = await examPublicSupabase.from('answers').insert(answersToInsert);

      if (answersError) throw answersError;

      const completed = await rpcCompleteStudentExamAttempt(examId, studentId, clientSessionToken);
      if (!completed) {
        toast.error('Respuestas guardadas, pero no se pudo cerrar el intento. Avisa a tu maestro.');
      }

      stopStream();
      previewStreamRef.current = null;
      clearExamClientSession(examId, studentId);
      setClientSessionToken(null);
      setFullscreenMode('none');
      await exitExamFullscreenSafe();

      const totalPoints = examMaxScore(questions);
      const obtainedPoints = graded.reduce((s, r) => s + r._points, 0);
      const finalPct = calculatePercentage(obtainedPoints, totalPoints);
      if (process.env.NEXT_PUBLIC_GRADING_DEBUG === 'true') {
        console.info('[grading:online:final]', {
          formula: 'round(obtainedPoints / totalPoints * 100)',
          obtainedPoints,
          totalPoints,
          pct: finalPct,
        });
      }
      setScore(finalPct);
      setSubmitted(true);
      toast.success('¡Examen enviado exitosamente!');
      if (questions.some((q) => isWhiteboardQuestion(q)) && openSkippedAi) {
        toast.message('Pizarrón sin calificación automática: falta OPENAI_API_KEY en el servidor.', {
          duration: 6000,
        });
      }
      if (openSkippedAi) {
        toast.message(
          'Hay preguntas abiertas sin calificación automática: falta OPENAI_API_KEY en el servidor.',
          { duration: 6000 }
        );
      }
    } catch {
      await exitExamFullscreenSafe();
      setFullscreenMode('none');
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
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white/35 px-4 py-6 backdrop-blur-[2px] app-scroll sm:py-8">
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
      <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white/35 px-4 py-6 backdrop-blur-[2px] app-scroll sm:py-8">
        <div className="mx-auto w-full max-w-lg">
          <div className="mb-10 flex justify-center px-1">
            <BrandWordmark
              href={false}
              imgClassName="h-[4.5rem] w-auto max-w-[min(100%,28rem)] object-contain sm:h-20 sm:max-w-[30rem] lg:h-[5.5rem] lg:max-w-[34rem]"
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
                    <li>
                      En computadora debes compartir tu pantalla completa (o ventana) durante todo el
                      examen; si dejas de compartir, el intento se anula.
                    </li>
                    <li>
                      Entrarás en pantalla completa (en el celular se activa automáticamente): no la cierres
                      ni salgas hasta terminar o el examen se anula.
                    </li>
                    <li>
                      No cambies de pestaña, de aplicación ni minimices el navegador; si lo haces, el examen
                      se anula.
                    </li>
                    <li>
                      No tomes capturas ni grabes la pantalla; el contenido se oculta si sales de la
                      aplicación.
                    </li>
                    <li>Solo hay un intento por alumno.</li>
                  </ul>
                  {isMobileExamDevice() && (
                    <p className="mt-3 text-xs text-amber-800/90">
                      En celular o tablet usa el navegador en vertical, con buena conexión y sin abrir otras
                      apps hasta enviar el examen.
                    </p>
                  )}
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
                      allowedGroupIds.length === 0
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
                      {startingExam ? 'Activando cámara y pantalla…' : 'Comprobando…'}
                    </>
                  ) : (
                    isMobileExamDevice()
                      ? 'Comenzar examen (cámara obligatoria)'
                      : 'Comenzar examen (cámara y pantalla obligatorias)'
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  const mobileImmersive = isMobileExamDevice();

  const examViewport = (
    <div
      ref={examShellRef}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden bg-white select-none',
        (mobileImmersive || fullscreenMode === 'pseudo') && EXAM_PSEUDO_FULLSCREEN_CLASS,
        !mobileImmersive && fullscreenMode !== 'pseudo' && 'h-full bg-white/35 backdrop-blur-[2px]',
        '[&_input]:select-text [&_textarea]:select-text'
      )}
      style={{ WebkitTouchCallout: 'none' }}
    >
      {protectionOverlay && <ExamCaptureBlockedOverlay variant={protectionOverlay} />}
      {hasStarted && !submitted && !forfeitReason && (
        <div
          className="pointer-events-none fixed z-[10001] flex flex-col items-end gap-2"
          style={{
            right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
            bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
          }}
        >
          {screenShareActive && (
            <div className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-1 rounded-md bg-emerald-700/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
                <Monitor className="h-3 w-3" />
                Pantalla
              </span>
            </div>
          )}
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-md bg-orange-600/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
              Cámara
            </span>
            <video
              ref={attachPreviewVideo}
              className="h-[5.5rem] w-[6.75rem] rounded-xl border-[3px] border-orange-500 bg-black object-cover shadow-xl ring-1 ring-orange-300/40 sm:h-28 sm:w-32"
              playsInline
              muted
              autoPlay
              aria-label="Vista previa de la cámara del examen"
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          'app-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-5 sm:px-4 sm:pt-8',
          'pb-[max(7rem,calc(5.5rem+env(safe-area-inset-bottom,0px)))]',
          (mobileImmersive || fullscreenMode === 'pseudo') && 'exam-pseudo-fullscreen-scroll'
        )}
      >
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{exam.title}</h1>
          <p className="text-sm text-gray-600 sm:text-base">Estudiante: {selectedStudentName}</p>
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

        <div className="relative space-y-6">
          <ExamAntiLeakWatermark
            studentName={selectedStudentName}
            examTitle={exam.title}
            sessionTag={clientSessionToken?.slice(0, 8).toUpperCase()}
          />
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
                  <div className="mb-4 ml-11">
                    <QuestionIllustration illustration={question.illustration} />
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

                {isWhiteboardQuestion(question) && (
                  <div className="ml-11">
                    <p className="mb-2 text-sm text-gray-600">
                      Dibuja tu respuesta en el pizarrón:
                    </p>
                    <ExamWhiteboard
                      value={answers[question.id] ?? null}
                      onChange={(dataUrl) => handleAnswerChange(question.id, dataUrl)}
                      minHeight={240}
                    />
                  </div>
                )}

                {question.type === 'open_answer' && !isWhiteboardQuestion(question) && (
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
    </div>
  );

  if (mobileImmersive && typeof document !== 'undefined') {
    return createPortal(examViewport, document.body);
  }

  return examViewport;
}
