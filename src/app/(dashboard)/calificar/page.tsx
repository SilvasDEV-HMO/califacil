'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Loader2, AlertCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useExam, useExams } from '@/hooks/useExams';
import { supabase } from '@/lib/supabase';
import {
  buildCalifacilVirtualKey,
  CALIFACIL_OMR_GUIDE_ASPECT_RATIO,
  chunkQuestions,
  califacilOmrColumnCount,
  examSupportsCalifacilOmr,
} from '@/lib/printExam';
import {
  autoOrientCalifacilSheet,
  califacilImageToJpegDataUrl,
  fileToImage,
  isCalifacilExamSheetLikely,
  prepareCalifacilScanInput,
  scanCalifacilOmrSheet,
  scanCalifacilOmrSheetWithMeta,
  type CalifacilOmrScanGeometry,
} from '@/lib/omrScan';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';
import { calculatePercentage, getGradeColor, getGradeLabel } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { CALIFACIL_VISION_POLICY } from '@/lib/califacilVisionPolicy';
import {
  playScanCompleteChime,
  resumeScanAudioContext,
  startScanningHum,
  stopScanningHum,
} from '@/lib/scanSounds';

type Phase = 'elegir' | 'capturar' | 'revisar_hoja' | 'guardando';

/** Umbral mínimo de reactivos leídos para fijar borrador y habilitar guardado en cámara en vivo. */
const MIN_AUTO_READ_RATIO = 0.9;
/** Fotogramas consecutivos con lectura estable antes de fijar borrador (consenso en vivo). */
const STABLE_PARTIAL_TICKS = 3;
/** Si más filas ambiguas que esto, aviso explícito en revisión. */
const AMBIGUOUS_ROW_WARN_RATIO = 0.35;

/** Convierte borrador de texto a índice de columna OMR por fila (0 = A). */
function draftSelectionsToColumnPicks(
  chunk: Question[],
  draft: Record<string, string>
): (number | null)[] {
  const out: (number | null)[] = Array(10).fill(null);
  for (let i = 0; i < chunk.length; i++) {
    const q = chunk[i];
    const text = draft[q.id]?.trim() ?? '';
    const opts = q.options ?? [];
    const idx = opts.findIndex((o) => o.trim() === text);
    out[i] = idx >= 0 ? idx : null;
  }
  return out;
}

/** Letra de inciso (A–E) a partir del texto de opción elegido; vacío si no hay lectura. */
function optionAnswerToLetter(q: Question, answerText: string): string {
  const t = answerText.trim();
  if (!t) return '';
  const opts = q.options ?? [];
  const idx = opts.findIndex((o) => o.trim() === t);
  if (idx < 0) return '';
  return String.fromCharCode(65 + idx);
}

export default function CalificarPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
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
  /** Geometría de celdas del último escaneo (misma relación de aspecto que la vista previa). */
  const [reviewOmrGeometry, setReviewOmrGeometry] = useState<CalifacilOmrScanGeometry | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Abre la cámara para detectar respuestas en vivo.');
  const [liveResolvedCount, setLiveResolvedCount] = useState(0);
  const [liveDraftSelections, setLiveDraftSelections] = useState<Record<string, string>>({});
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveTickRef = useRef<number | null>(null);
  const liveBusyRef = useRef(false);
  const stablePartialTicksRef = useRef(0);
  /** Respuestas ya capturadas en vivo por id de pregunta; no se sobrescriben hasta «Escanear otra vez». */
  const liveLockedAnswersRef = useRef<Record<string, string>>({});
  /** Evita repetir el sonido de «hoja completa» en cada fotograma. */
  const liveCompleteSoundPlayedRef = useRef(false);
  const submitAllRef = useRef<(merged: Record<string, string>) => Promise<void>>(async () => {});
  const scanBusyRef = useRef(false);
  const startingCameraRef = useRef(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const confirmedAnswersRef = useRef<Record<string, string>>({});
  const sheetIndexRef = useRef(0);

  const [reviewQualityHint, setReviewQualityHint] = useState<string | null>(null);

  const [autoGradeDialogOpen, setAutoGradeDialogOpen] = useState(false);
  const [autoGradeStats, setAutoGradeStats] = useState<{
    pct: number;
    correct: number;
    wrong: number;
    total: number;
  } | null>(null);

  const publishedExams = useMemo(
    () => (exams as Exam[]).filter((e) => e.status === 'published'),
    [exams]
  );

  const questions = useMemo(() => exam?.questions ?? [], [exam]);
  const omrCols = califacilOmrColumnCount(questions);
  const supportsCalifacil = exam ? examSupportsCalifacilOmr(questions) : false;
  const virtualKey = useMemo(() => buildCalifacilVirtualKey(questions), [questions]);
  const virtualKeyByQuestionId = useMemo(
    () => new Map(virtualKey.rows.map((row) => [row.questionId, row])),
    [virtualKey.rows]
  );
  const sheets = useMemo(() => chunkQuestions(questions, 10), [questions]);
  const totalSheets = sheets.length;
  const currentChunk = sheets[sheetIndex] ?? [];
  const maxQuestions = 30;
  const minResolvedForCurrentChunk = Math.max(1, Math.ceil(currentChunk.length * MIN_AUTO_READ_RATIO));

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [students]
  );

  useEffect(() => {
    confirmedAnswersRef.current = confirmedByQuestionId;
  }, [confirmedByQuestionId]);

  useEffect(() => {
    sheetIndexRef.current = sheetIndex;
  }, [sheetIndex]);

  const selectedStudentName =
    sortedStudents.find((s) => s.id === selectedStudentId)?.name ?? '';

  const setTorchEnabled = useCallback(async (enabled: boolean) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return false;
    const capabilities =
      typeof track.getCapabilities === 'function'
        ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
        : null;
    if (!capabilities?.torch) return false;
    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled } as MediaTrackConstraintSet],
      });
      setFlashOn(enabled);
      return true;
    } catch {
      return false;
    }
  }, []);

  const resetLiveReadings = useCallback(() => {
    stablePartialTicksRef.current = 0;
    liveLockedAnswersRef.current = {};
    liveCompleteSoundPlayedRef.current = false;
    stopScanningHum();
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus(
      isMobile
        ? 'Cámara activa. Encuadra solo la banda CaliFacil dentro del marco.'
        : 'Elige una imagen del recuadro CaliFacil para leer las respuestas.'
    );
  }, [isMobile]);

  const stopLiveCamera = useCallback(() => {
    stopScanningHum();
    if (liveTickRef.current !== null) {
      window.clearInterval(liveTickRef.current);
      liveTickRef.current = null;
    }
    void setTorchEnabled(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    stablePartialTicksRef.current = 0;
    setFlashSupported(false);
    setFlashOn(false);
    setCameraOpen(false);
  }, [setTorchEnabled]);

  const attachStreamToVideo = useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    await video.play().catch(() => undefined);
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
    async (
      source: HTMLImageElement | HTMLCanvasElement,
      fallbackFile?: File,
      opts?: { skipReviewUi?: boolean }
    ): Promise<{ success: boolean; chunkDraft?: Record<string, string> }> => {
      const skipReviewUi = opts?.skipReviewUi;
      const chunk = sheets[sheetIndexRef.current] ?? [];
      const oriented = autoOrientCalifacilSheet(source, omrCols) ?? source;
      const examCanvas =
        oriented instanceof HTMLCanvasElement
          ? oriented
          : prepareCalifacilScanInput(oriented);
      if (!examCanvas || !isCalifacilExamSheetLikely(examCanvas, omrCols)) {
        setLiveStatus(
          isMobile
            ? 'No se detecta la tabla CaliFacil. Encuadra solo el recuadro impreso del examen.'
            : 'No se detecta la tabla CaliFacil en la imagen. Usa una foto clara del recuadro del examen.'
        );
        toast.error(
          isMobile
            ? 'No se reconoce el examen CaliFacil. Centra el recuadro con la tabla de casillas A–D.'
            : 'No se reconoce el examen CaliFacil en esta imagen. Elige una foto del recuadro impreso.'
        );
        return { success: false };
      }
      const meta = scanCalifacilOmrSheetWithMeta(oriented, omrCols, { skipGuideCrop: true });
      const raw = [...meta.picks];

      const ambiguousIdx = meta.rows
        .map((r, i) => (i < chunk.length && r.ambiguous ? i : -1))
        .filter((i) => i >= 0);

      const si = sheetIndexRef.current;
      const picksInChunk = raw.slice(0, chunk.length);
      const allSameCol =
        chunk.length > 1 &&
        picksInChunk.every((p, i) => i === 0 || p === picksInChunk[0]) &&
        picksInChunk[0] !== null &&
        picksInChunk.every((p) => p !== null);

      if (CALIFACIL_VISION_POLICY.onAmbiguousRows && ambiguousIdx.length > 0 && examId) {
        const rowsPayload = ambiguousIdx.map((i) => ({
          questionId: chunk[i].id,
          globalNumber: si * 10 + i + 1,
          options: chunk[i].options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetch('/api/calificar/vision-omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              examId,
              imageBase64,
              rows: rowsPayload,
              omrColumnCount: omrCols,
              focusNumbers,
            }),
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (const i of ambiguousIdx) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (ambiguousIdx.length > 0 && !skipReviewUi) {
              toast.message('Filas dudosas revisadas con visión asistida.');
            }
          } else if (res.status === 503 && payload.code === 'NO_KEY') {
            // Sin API key: se mantienen solo lecturas locales.
          }
        } catch {
          // Fallo de red: mantener lectura local
        }
      }

      if (
        CALIFACIL_VISION_POLICY.onManySameColumnAlign &&
        examId &&
        chunk.length >= 8 &&
        meta.maxSameColumnCount >= 8 &&
        !allSameCol
      ) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: si * 10 + i + 1,
          options: q.options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetch('/api/calificar/vision-omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              examId,
              imageBase64,
              rows: rowsPayload,
              omrColumnCount: omrCols,
              focusNumbers,
            }),
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (let i = 0; i < chunk.length; i++) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (!skipReviewUi) {
              toast.message(
                'Lectura revisada con visión (muchas filas en la misma columna; posible desalineación).'
              );
            }
          }
        } catch {
          /* mantener lectura local */
        }
      }

      if (
        CALIFACIL_VISION_POLICY.onAllSameColumn &&
        allSameCol &&
        examId &&
        !ambiguousIdx.length
      ) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: si * 10 + i + 1,
          options: q.options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetch('/api/calificar/vision-omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              examId,
              imageBase64,
              rows: rowsPayload,
              omrColumnCount: omrCols,
              focusNumbers,
            }),
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (let i = 0; i < chunk.length; i++) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (!skipReviewUi) {
              toast.message('Lectura revisada con visión (todas las filas coincidían en la misma columna).');
            }
          }
        } catch {
          /* mantener lectura local */
        }
      }

      if (CALIFACIL_VISION_POLICY.onFinalizeEveryRow && examId && chunk.length > 0) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: si * 10 + i + 1,
          options: q.options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetch('/api/calificar/vision-omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              examId,
              imageBase64,
              rows: rowsPayload,
              omrColumnCount: omrCols,
              focusNumbers,
            }),
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (let i = 0; i < chunk.length; i++) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (!skipReviewUi) {
              toast.message('Visión aplicada a toda la hoja (modo alta precisión).');
            }
          }
        } catch {
          /* mantener OMR local */
        }
      }

      const mapped = mapRawToDraft(raw, chunk);
      const locks = liveLockedAnswersRef.current;
      const mergedDraft: Record<string, string> = {};
      let mergedResolved = 0;
      for (const q of chunk) {
        const locked = locks[q.id]?.trim();
        if (locked) {
          mergedDraft[q.id] = locked;
          mergedResolved++;
        } else {
          const v = mapped.draft[q.id]?.trim() ?? '';
          mergedDraft[q.id] = v;
          if (v) {
            locks[q.id] = v;
            mergedResolved++;
          }
        }
      }
      const minResolved = Math.max(1, Math.ceil(chunk.length * MIN_AUTO_READ_RATIO));
      if (mergedResolved < minResolved) {
        setDraftSelections({});
        setLiveDraftSelections(mergedDraft);
        setLiveResolvedCount(mergedResolved);
        setLiveStatus(
          isMobile
            ? 'Lectura insuficiente: acerca el recuadro, mejora luz y evita sombras.'
            : 'Lectura insuficiente: elige una imagen más nítida del recuadro, bien iluminada.'
        );
        toast.error(
          isMobile
            ? 'La captura no tiene calidad suficiente para leer el recuadro. Acerca más la cámara y vuelve a intentar.'
            : 'La imagen no tiene calidad suficiente para leer el recuadro. Prueba con otra foto más clara.'
        );
        return { success: false };
      }

      liveLockedAnswersRef.current = {};
      for (const q of chunk) {
        const v = mapped.draft[q.id]?.trim() ?? '';
        if (v) liveLockedAnswersRef.current[q.id] = v;
      }
      setDraftSelections(mapped.draft);
      setLiveDraftSelections(mapped.draft);
      setLiveResolvedCount(mapped.resolvedCount);

      if (!skipReviewUi) {
        const ambiguousRowCount = meta.rows.filter((r, i) => i < chunk.length && r.ambiguous).length;
        if (
          ambiguousRowCount / Math.max(1, chunk.length) >= AMBIGUOUS_ROW_WARN_RATIO ||
          meta.needsVisionAssist
        ) {
          setReviewQualityHint(
            `Lectura automática dudosa en ${ambiguousRowCount} fila(s). Corrige las opciones antes de guardar.`
          );
        } else if (mapped.unresolvedCount > 0) {
          setReviewQualityHint(
            `${mapped.unresolvedCount} pregunta(s) sin lectura clara: elige la opción manualmente.`
          );
        } else {
          setReviewQualityHint(null);
        }

        await setPreviewFromSource(oriented, fallbackFile);
        setReviewOmrGeometry(meta.geometry);
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
      } else {
        setLiveStatus('Hoja guardada automáticamente.');
      }

      return { success: true, chunkDraft: mapped.draft };
    },
    [examId, isMobile, mapRawToDraft, omrCols, setPreviewFromSource, sheets]
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
    if (!cameraOpen) return;
    void attachStreamToVideo();
    const video = videoRef.current;
    if (!video) return;
    const onLoadedMetadata = () => {
      void attachStreamToVideo();
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [attachStreamToVideo, cameraOpen]);

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
    setReviewQualityHint(null);
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus(
      isMobile
        ? 'Abre la cámara para detectar respuestas en vivo.'
        : 'En ordenador solo se importa imagen: elige una foto del recuadro CaliFacil.'
    );
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setReviewOmrGeometry(null);
    setSelectedStudentId('');
  }, [stopLiveCamera, isMobile]);

  const handleStudentChange = (studentId: string) => {
    setSelectedStudentId(studentId);
    if (!studentId) return;
    const canAutoStart =
      Boolean(examId) &&
      Boolean(exam) &&
      !examLoading &&
      supportsCalifacil &&
      questions.length > 0 &&
      questions.length <= maxQuestions &&
      virtualKey.issues.length === 0 &&
      sortedStudents.some((s) => s.id === studentId);
    if (!canAutoStart) return;
    stopLiveCamera();
    setPhase('capturar');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus(
      isMobile
        ? 'Abre la cámara para detectar respuestas en vivo.'
        : 'En ordenador solo se importa imagen: elige una foto del recuadro CaliFacil.'
    );
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
  };

  const handleGalleryFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Elige un archivo de imagen (JPG, PNG, etc.).');
      return;
    }
    setScanBusy(true);
    try {
      const img = await fileToImage(file);
      await finalizeCapturedSheet(img, file);
    } catch {
      toast.error('No se pudo leer la imagen.');
    } finally {
      setScanBusy(false);
    }
  };

  const startLiveCamera = async () => {
    if (cameraOpen || startingCameraRef.current) return;
    startingCameraRef.current = true;
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        toast.error('Tu navegador no permite cámara en vivo en esta pantalla.');
        startingCameraRef.current = false;
        return;
      }
      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: { exact: 'environment' } }, audio: false },
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: { facingMode: 'user' }, audio: false },
        { video: true, audio: false },
      ];
      let stream: MediaStream | null = null;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch {
          // Intentamos el siguiente perfil de cámara.
        }
      }
      if (!stream) {
        throw new Error('camera_unavailable');
      }
      streamRef.current = stream;
      setCameraOpen(true);
      resetLiveReadings();
      await attachStreamToVideo();
      const track = stream.getVideoTracks()[0];
      const capabilities =
        typeof track?.getCapabilities === 'function'
          ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
          : null;
      const supportsTorch = Boolean(capabilities?.torch);
      setFlashSupported(supportsTorch);
      if (supportsTorch) {
        await setTorchEnabled(true);
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

          const chunk = sheets[sheetIndexRef.current] ?? [];
          const oriented = autoOrientCalifacilSheet(frame, omrCols) ?? frame;
          if (!isCalifacilExamSheetLikely(oriented, omrCols)) {
            stopScanningHum();
            stablePartialTicksRef.current = 0;
            const locksNoExam = liveLockedAnswersRef.current;
            const mergedNoExam: Record<string, string> = {};
            let resolvedNoExam = 0;
            for (const q of chunk) {
              const locked = locksNoExam[q.id]?.trim();
              mergedNoExam[q.id] = locked || '';
              if (locked) resolvedNoExam++;
            }
            setLiveDraftSelections(mergedNoExam);
            setLiveResolvedCount(resolvedNoExam);
            setLiveStatus(
              'No se detecta la tabla CaliFacil. Encuadra solo el recuadro impreso (números y casillas).'
            );
            return;
          }
          const raw = scanCalifacilOmrSheet(oriented, omrCols, {
            skipGuideCrop: true,
            qnumSweep: 'live',
            columnShiftSweep: 'live',
          });
          const mapped = mapRawToDraft(raw, chunk);
          const locks = liveLockedAnswersRef.current;
          const mergedLive: Record<string, string> = {};
          let mergedResolved = 0;
          for (const q of chunk) {
            const locked = locks[q.id]?.trim();
            if (locked) {
              mergedLive[q.id] = locked;
              mergedResolved++;
            } else {
              const v = mapped.draft[q.id]?.trim() ?? '';
              mergedLive[q.id] = v;
              if (v) {
                locks[q.id] = v;
                mergedResolved++;
              }
            }
          }
          setLiveDraftSelections(mergedLive);
          setLiveResolvedCount(mergedResolved);

          if (chunk.length > 0) {
            if (mergedResolved >= chunk.length) {
              stopScanningHum();
              if (!liveCompleteSoundPlayedRef.current) {
                liveCompleteSoundPlayedRef.current = true;
                playScanCompleteChime();
              }
            } else if (mergedResolved > 0) {
              startScanningHum();
            } else {
              stopScanningHum();
            }
          } else {
            stopScanningHum();
          }

          const minResolved = Math.max(1, Math.ceil(chunk.length * MIN_AUTO_READ_RATIO));
          if (mergedResolved >= chunk.length && chunk.length > 0) {
            setLiveStatus(
              'Detección completa. Puedes mover la cámara; las lecturas se mantienen hasta «Escanear otra vez».'
            );
          } else if (mergedResolved >= minResolved) {
            setLiveStatus(
              'Lecturas capturadas se mantienen aunque muevas el teléfono. Completa las faltantes o pulsa «Revisar y confirmar».'
            );
          } else if (mergedResolved >= Math.ceil(chunk.length * 0.3)) {
            setLiveStatus('Casi listo: centra mejor el recuadro y aumenta luz.');
          } else {
            setLiveStatus('Ajusta cámara: acerca la banda CaliFacil y evita sombras.');
          }

          if (mergedResolved >= minResolved && chunk.length > 0) {
            stablePartialTicksRef.current += 1;
          } else {
            stablePartialTicksRef.current = 0;
          }

          if (stablePartialTicksRef.current >= STABLE_PARTIAL_TICKS && chunk.length > 0) {
            stablePartialTicksRef.current = 0;
            setDraftSelections((prev) => {
              const next = { ...prev };
              for (const q of chunk) {
                const v = mergedLive[q.id]?.trim();
                if (v) next[q.id] = v;
              }
              return next;
            });
          }
        } finally {
          liveBusyRef.current = false;
        }
      }, 750);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'No se pudo abrir la cámara. Revisa permisos o usa "Subir foto".';
      toast.error('No se pudo abrir la cámara', {
        description: toSpanishAuthMessage(message),
      });
      setCameraOpen(false);
    } finally {
      startingCameraRef.current = false;
    }
  };

  useEffect(() => {
    if (!isMobile) return;
    if (phase !== 'capturar' || cameraOpen || scanBusy) return;
    void startLiveCamera();
  }, [isMobile, cameraOpen, phase, scanBusy, startLiveCamera]);

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
      setReviewOmrGeometry(null);
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setDraftSelections({});
      resetLiveReadings();
      setPhase('capturar');
      toast.success(
        isMobile
          ? `Hoja ${sheetIndex + 1} guardada. Captura la siguiente.`
          : `Hoja ${sheetIndex + 1} guardada. Importa la foto de la siguiente hoja.`
      );
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
      const rows = questions.map((question: Question) => {
        const answerText = (merged[question.id] ?? '').trim();
        const key = virtualKeyByQuestionId.get(question.id);
        const answerIdx = key ? key.options.findIndex((opt) => opt === answerText) : -1;
        const isCorrect =
          question.type === 'multiple_choice'
            ? key
              ? answerIdx === key.correctIndex
              : false
            : null;
        if (isCorrect) correctCount++;

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

      const mcTotal = virtualKey.rows.length;
      const pct = calculatePercentage(correctCount, mcTotal);
      const wrong = Math.max(0, mcTotal - correctCount);
      setAutoGradeStats({
        pct,
        correct: correctCount,
        wrong,
        total: mcTotal,
      });
      setAutoGradeDialogOpen(true);
      toast.success('Calificación guardada.');
      stopLiveCamera();
      setPhase('elegir');
      setSheetIndex(0);
      setConfirmedByQuestionId({});
      confirmedAnswersRef.current = {};
      setDraftSelections({});
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      liveLockedAnswersRef.current = {};
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

  const commitGradeFromLive = useCallback(async () => {
    const chunk = sheets[sheetIndex] ?? [];
    if (chunk.length === 0) return;

    setScanBusy(true);
    try {
      const mergedChunk: Record<string, string> = { ...draftSelections };
      for (const q of chunk) {
        const live = liveDraftSelections[q.id]?.trim();
        if (live) mergedChunk[q.id] = live;
      }

      const missing = chunk.filter((q) => !mergedChunk[q.id]?.trim());
      if (missing.length > 0) {
        toast.error(
          `Faltan ${missing.length} respuesta(s) en esta hoja. Acerca el recuadro o espera la lectura en vivo.`
        );
        return;
      }

      let orientedForPreview: HTMLCanvasElement | null = null;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth >= 40) {
        const frame = document.createElement('canvas');
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        const ctx = frame.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, frame.width, frame.height);
          orientedForPreview = autoOrientCalifacilSheet(frame, omrCols) ?? frame;
        }
      }

      let visionToastShown = false;
      if (
        CALIFACIL_VISION_POLICY.onLiveCommitVision &&
        examId &&
        orientedForPreview &&
        chunk.length > 0
      ) {
        const si = sheetIndexRef.current;
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: si * 10 + i + 1,
          options: q.options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(orientedForPreview);
          const res = await fetch('/api/calificar/vision-omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              examId,
              imageBase64,
              rows: rowsPayload,
              omrColumnCount: omrCols,
              focusNumbers,
            }),
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (let i = 0; i < chunk.length; i++) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                mergedChunk[q.id] = text;
              }
            }
            visionToastShown = true;
            toast.message('Lectura verificada con visión (revisa antes de guardar).');
          } else if (res.status === 503 && payload.code === 'NO_KEY') {
            visionToastShown = true;
            toast.message('Lectura automática sin verificación IA (sin clave en el servidor).');
          }
        } catch {
          /* mantener lectura OMR local */
        }
      }

      if (orientedForPreview) {
        const mg = scanCalifacilOmrSheetWithMeta(orientedForPreview, omrCols, { skipGuideCrop: true });
        setReviewOmrGeometry(mg.geometry);
      } else {
        setReviewOmrGeometry(null);
      }

      setDraftSelections(mergedChunk);

      if (orientedForPreview) {
        await setPreviewFromSource(orientedForPreview);
      } else {
        setPreviewUrl((u) => {
          if (u) URL.revokeObjectURL(u);
          return null;
        });
      }

      setReviewQualityHint(
        CALIFACIL_VISION_POLICY.onLiveCommitVision
          ? 'Revisa cada opción; si hay clave de IA se ha intentado una segunda lectura de la foto.'
          : 'Revisa y corrige cada opción si hace falta; la lectura en vivo es orientativa.'
      );
      setPhase('revisar_hoja');
      setLiveStatus('Revisa cada respuesta y confirma con «Guardar calificación».');
      if (!visionToastShown) {
        toast.message('Revisa las lecturas antes de confirmar.');
      }
    } finally {
      setScanBusy(false);
    }
  }, [draftSelections, examId, liveDraftSelections, omrCols, setPreviewFromSource, setPreviewUrl, sheetIndex, sheets]);

  const switchToAnotherStudentScan = useCallback(() => {
    stopLiveCamera();
    setReviewQualityHint(null);
    setSelectedStudentId('');
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    confirmedAnswersRef.current = {};
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    stablePartialTicksRef.current = 0;
    liveLockedAnswersRef.current = {};
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setLiveStatus(
      isMobile
        ? 'Abre la cámara para detectar respuestas en vivo.'
        : 'En ordenador solo se importa imagen: elige una foto del recuadro CaliFacil.'
    );
    toast.message('Elige otro alumno para escanear su examen.');
  }, [isMobile, stopLiveCamera]);

  submitAllRef.current = submitAll;

  const scanAgainInLive = () => {
    const chunk = sheets[sheetIndex] ?? [];
    setDraftSelections((prev) => {
      const next = { ...prev };
      for (const q of chunk) delete next[q.id];
      return next;
    });
    resetLiveReadings();
  };

  if (!user) return null;

  return (
    <div className="flex w-full flex-col gap-3 pb-6 sm:gap-4 sm:pb-8">
      <Dialog open={autoGradeDialogOpen} onOpenChange={setAutoGradeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Calificación guardada</DialogTitle>
            <DialogDescription>
              Resultados para {selectedStudentName.trim() || 'el alumno seleccionado'}.
            </DialogDescription>
          </DialogHeader>
          {autoGradeStats && (
            <div className="space-y-3 py-2">
              <div className={`text-center text-4xl font-bold ${getGradeColor(autoGradeStats.pct)}`}>
                {autoGradeStats.pct}%
              </div>
              <p className="text-center text-sm text-gray-600">{getGradeLabel(autoGradeStats.pct)}</p>
              <div className="grid grid-cols-2 gap-3 text-center text-sm">
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <div className="text-xs text-green-800">Correctas</div>
                  <div className="text-xl font-semibold text-green-900">{autoGradeStats.correct}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <div className="text-xs text-red-800">Incorrectas</div>
                  <div className="text-xl font-semibold text-red-900">{autoGradeStats.wrong}</div>
                </div>
              </div>
              <p className="text-center text-xs text-gray-500">Total de preguntas: {autoGradeStats.total}</p>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {examId ? (
              <Button type="button" variant="outline" className="w-full" asChild>
                <Link href={`/exams/results/${examId}`}>
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  Ver en panel de resultados
                </Link>
              </Button>
            ) : null}
            <Button
              type="button"
              className="w-full bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                setSelectedStudentId('');
                setAutoGradeDialogOpen(false);
              }}
            >
              Elegir otro alumno
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setAutoGradeDialogOpen(false)}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-gray-600"
              onClick={() => {
                setAutoGradeDialogOpen(false);
                router.push('/dashboard');
              }}
            >
              Ir al inicio del dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Calificar</h1>
        <p className="mt-0.5 text-xs text-gray-600 sm:mt-1 sm:text-sm">
          {isMobile
            ? 'Fotografía el pie CaliFacil de cada hoja impresa (10 preguntas por hoja, hasta 3 hojas).'
            : 'En ordenador importa una imagen del pie CaliFacil por hoja (10 preguntas por hoja, hasta 3 hojas). La cámara solo está disponible en el móvil.'}
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

          {exam && supportsCalifacil && virtualKey.issues.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertCircle className="h-5 w-5 shrink-0" />
              {virtualKey.issues[0]}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="calif-alumno">Alumno</Label>
            <StudentCombobox
              id="calif-alumno"
              students={sortedStudents}
              value={selectedStudentId}
              onValueChange={handleStudentChange}
              disabled={phase === 'guardando'}
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

        </CardContent>
      </Card>

      {(phase === 'capturar' || phase === 'revisar_hoja') && exam && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Hoja {sheetIndex + 1} de {totalSheets}
            </CardTitle>
            <CardDescription>
              Preguntas {sheetIndex * 10 + 1}–{sheetIndex * 10 + currentChunk.length} ·{' '}
              {isMobile
                ? 'Incluye en la foto el recuadro negro CaliFacil del pie de página.'
                : 'La imagen debe mostrar con claridad el recuadro CaliFacil del pie de página.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {phase === 'capturar' && (
              <div className="space-y-3">
                {isMobile ? (
                  <>
                    {!cameraOpen ? (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Abriendo cámara en vivo...
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-3 w-full"
                          onClick={() => void startLiveCamera()}
                        >
                          Reintentar cámara
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="relative overflow-hidden rounded-lg border bg-black/90">
                          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="aspect-[4/3] min-h-[12rem] w-full bg-black object-cover"
                          />
                          <div className="pointer-events-none absolute inset-0 bg-black/20" />
                          <div
                            className="pointer-events-none absolute left-1/2 top-[62%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-lg border-[2.5px] border-orange-400/95 shadow-[0_0_0_9999px_rgba(0,0,0,0.2)]"
                            style={{ aspectRatio: `${CALIFACIL_OMR_GUIDE_ASPECT_RATIO} / 1` }}
                          />
                        </div>
                        <div className="rounded-md border bg-orange-50 px-3 py-2 text-sm text-orange-900">
                          {liveStatus}
                        </div>
                        <p className="text-[11px] leading-snug text-gray-600">
                          <span className="font-medium text-gray-800">Tip:</span> encuadra el recuadro
                          negro completo, luz uniforme y relleno <strong>oscuro y redondo</strong> dentro
                          del círculo. La fila es el número de pregunta; las columnas son A, B, C… según la
                          primera fila de la tabla impresa.
                        </p>
                        {flashSupported && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => void setTorchEnabled(!flashOn)}
                          >
                            <Zap className="mr-2 h-4 w-4" />
                            {flashOn ? 'Apagar flash' : 'Encender flash'}
                          </Button>
                        )}
                        <p className="text-xs text-gray-500">
                          Leídas{' '}
                          {
                            currentChunk.filter(
                              (q) =>
                                Boolean(draftSelections[q.id]?.trim()) ||
                                Boolean(liveDraftSelections[q.id]?.trim())
                            ).length
                          }
                          /{currentChunk.length}. Cada respuesta detectada se mantiene aunque muevas el
                          teléfono; con al menos {minResolvedForCurrentChunk} lecturas se copian al borrador
                          inferior. «Escanear otra vez» borra esta hoja y vuelve a leer desde cero.
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {currentChunk.map((q, idx) => {
                            const letter = optionAnswerToLetter(
                              q,
                              draftSelections[q.id] || liveDraftSelections[q.id] || ''
                            );
                            return (
                              <div key={q.id} className="rounded-md border bg-white px-2 py-1 text-xs">
                                <span className="font-medium">P{sheetIndex * 10 + idx + 1}</span>:{' '}
                                <span className="font-semibold">{letter || '—'}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <Button
                              className="flex-1 bg-orange-600 hover:bg-orange-700"
                              onClick={() => void commitGradeFromLive()}
                              disabled={
                                scanBusy ||
                                !currentChunk.every(
                                  (q) =>
                                    Boolean(draftSelections[q.id]?.trim()) ||
                                    Boolean(liveDraftSelections[q.id]?.trim())
                                )
                              }
                            >
                              {scanBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                'Revisar y confirmar'
                              )}
                            </Button>
                            <Button variant="outline" className="flex-1" onClick={scanAgainInLive}>
                              Escanear otra vez
                            </Button>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full"
                            onClick={switchToAnotherStudentScan}
                            disabled={scanBusy}
                          >
                            Escanear examen de otro alumno
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={handleGalleryFile}
                    />
                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/90 p-6 text-center">
                      <p className="text-sm text-gray-700">
                        En ordenador no se usa la cámara ni la captura en vivo. Elige una imagen del recuadro
                        CaliFacil (archivo de fotos o imagen que hayas pasado desde el móvil).
                      </p>
                      <Button
                        type="button"
                        className="mt-4 bg-orange-600 hover:bg-orange-700"
                        disabled={scanBusy}
                        onClick={() => galleryInputRef.current?.click()}
                      >
                        {scanBusy ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Leyendo imagen…
                          </>
                        ) : (
                          'Elegir imagen…'
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {previewUrl && phase === 'revisar_hoja' && (
              <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
                <div className="relative inline-block max-h-96 max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Vista previa del recuadro CaliFacil"
                    className="relative z-0 block max-h-96 w-auto max-w-full"
                  />
                  {reviewOmrGeometry ? (
                    <CalifacilOmrReviewOverlay
                      geometry={reviewOmrGeometry}
                      picks={draftSelectionsToColumnPicks(currentChunk, draftSelections)}
                      rowCount={currentChunk.length}
                    />
                  ) : null}
                </div>
              </div>
            )}

            {phase === 'revisar_hoja' && (
              <div className="space-y-3">
                {reviewQualityHint ? (
                  <Alert variant="default" className="border-amber-300 bg-amber-50 text-amber-950">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle className="text-sm">Calidad de lectura</AlertTitle>
                    <AlertDescription className="text-sm">{reviewQualityHint}</AlertDescription>
                  </Alert>
                ) : null}
                <p className="text-sm font-medium text-gray-800">
                  Confirma o corrige cada respuesta antes de guardar. Verde = opción leída; azul = resto de
                  casillas detectadas. Con buena luz y casillas bien rellenas la lectura suele coincidir.
                </p>
                {currentChunk.map((q, idx) => {
                  const globalNum = sheetIndex * 10 + idx + 1;
                  const opts = q.options ?? [];
                  const val = draftSelections[q.id]?.trim() ?? '';
                  return (
                    <div key={q.id} className="flex flex-col gap-1">
                      <Label className="text-xs text-gray-600">Pregunta {globalNum}</Label>
                      <Select
                        value={val || undefined}
                        onValueChange={(v) => {
                          setDraftSelections((prev) => ({ ...prev, [q.id]: v }));
                        }}
                      >
                        <SelectTrigger className="w-full max-w-md">
                          <SelectValue placeholder="Elegir opción leída" />
                        </SelectTrigger>
                        <SelectContent>
                          {opts.map((opt, oi) => (
                            <SelectItem key={opt} value={opt}>
                              {String.fromCharCode(65 + oi)}. {opt}
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
                      setReviewOmrGeometry(null);
                      setPreviewUrl((u) => {
                        if (u) URL.revokeObjectURL(u);
                        return null;
                      });
                      setDraftSelections({});
                      resetLiveReadings();
                    }}
                  >
                    {isMobile ? 'Escanear otra vez' : 'Importar otra imagen'}
                  </Button>
                  <Button
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                    onClick={confirmCurrentSheet}
                  >
                    Guardar calificación
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
    </div>
  );
}
