'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Info, LayoutDashboard, Loader2, AlertCircle, Zap } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
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
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { CALIFACIL_VISION_POLICY } from '@/lib/califacilVisionPolicy';
import {
  playAutoCaptureClickSound,
  playScanCompleteChime,
  resumeScanAudioContext,
  startScanningHum,
  stopScanningHum,
} from '@/lib/scanSounds';

type Phase = 'elegir' | 'capturar' | 'revisar_hoja' | 'guardando';
type GradeMode = 'student' | 'master_key';

/** Umbral mínimo de reactivos leídos para fijar borrador y habilitar guardado en cámara en vivo. */
const MIN_AUTO_READ_RATIO = 0.9;
/** Fotogramas consecutivos con lectura estable antes de fijar borrador (consenso en vivo). */
const STABLE_PARTIAL_TICKS = 3;
/** Fotogramas consecutivos con hoja completa para disparar captura automática. */
const STABLE_FULL_TICKS = 2;
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

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality = 0.9): string {
  return canvas.toDataURL('image/jpeg', quality);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function CalificarPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { exams, loading: examsLoading } = useExams(user?.id);

  const [examId, setExamId] = useState<string>('');
  const { exam, loading: examLoading } = useExam(examId || undefined);

  const [gradeMode, setGradeMode] = useState<GradeMode>('student');
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
  /** Confirmación explícita de que el usuario revisó lectura vs foto (no se guarda sin esto). */
  const [reviewHumanAck, setReviewHumanAck] = useState(false);
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
  const stableFullTicksRef = useRef(0);
  const autoFinalizeInProgressRef = useRef(false);
  /** Respuestas ya capturadas en vivo por id de pregunta; no se sobrescriben hasta «Escanear otra vez». */
  const liveLockedAnswersRef = useRef<Record<string, string>>({});
  /** Evita repetir el sonido de «hoja completa» en cada fotograma. */
  const liveCompleteSoundPlayedRef = useRef(false);
  const submitAllRef = useRef<(merged: Record<string, string>) => Promise<void>>(async () => {});
  const autoCaptureAndCompareRef = useRef<
    (merged: Record<string, string>, sourceForKey?: HTMLCanvasElement | HTMLImageElement) => Promise<void>
  >(async () => {});
  const scanBusyRef = useRef(false);
  const startingCameraRef = useRef(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const confirmedAnswersRef = useRef<Record<string, string>>({});
  const sheetIndexRef = useRef(0);
  const prevPhaseRef = useRef<Phase>('elegir');

  const [reviewQualityHint, setReviewQualityHint] = useState<string | null>(null);
  const [keyImageUploading, setKeyImageUploading] = useState(false);
  const [masterBlurOverlayUrl, setMasterBlurOverlayUrl] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(55);
  const [autoSnapshotUrl, setAutoSnapshotUrl] = useState<string | null>(null);
  const [showAutoSnapshot, setShowAutoSnapshot] = useState(false);

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
  const teacherSheetKeyByQuestionId = useMemo<Record<string, string>>(() => {
    const raw = exam?.answer_key_by_question;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [qid, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v.trim()) out[qid] = v.trim();
    }
    return out;
  }, [exam?.answer_key_by_question]);
  const usingTeacherSheetKey = exam?.answer_key_source === 'teacher_sheet';
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
  const answeredByTeacherSheetCount = questions.filter(
    (q) => Boolean(teacherSheetKeyByQuestionId[q.id]?.trim())
  ).length;
  const teacherSheetKeyComplete = questions.length > 0 && answeredByTeacherSheetCount === questions.length;
  const canGradeStudents = usingTeacherSheetKey && teacherSheetKeyComplete;

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

  const clearAutoSnapshot = useCallback(() => {
    setShowAutoSnapshot(false);
    setAutoSnapshotUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const showAutoCaptureSnapshot = useCallback(
    async (source: HTMLCanvasElement | HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      const w =
        source instanceof HTMLCanvasElement
          ? source.width
          : Math.max(1, Math.round(source.naturalWidth || source.width));
      const h =
        source instanceof HTMLCanvasElement
          ? source.height
          : Math.max(1, Math.round(source.naturalHeight || source.height));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
      );
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setAutoSnapshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setShowAutoSnapshot(true);
      playAutoCaptureClickSound();
      setLiveStatus('Captura automática realizada');
      await sleep(500);
      setShowAutoSnapshot(false);
    },
    []
  );

  const resetLiveReadings = useCallback(() => {
    stablePartialTicksRef.current = 0;
    stableFullTicksRef.current = 0;
    autoFinalizeInProgressRef.current = false;
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
    clearAutoSnapshot();
  }, [clearAutoSnapshot, isMobile]);

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
    stableFullTicksRef.current = 0;
    autoFinalizeInProgressRef.current = false;
    setFlashSupported(false);
    setFlashOn(false);
    setCameraOpen(false);
    clearAutoSnapshot();
  }, [clearAutoSnapshot, setTorchEnabled]);

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
      if (!examId || !exam || !supportsCalifacil) {
        toast.error('Selecciona un examen válido antes de escanear.');
        return { success: false };
      }
      const skipReviewUi = opts?.skipReviewUi;
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) {
        toast.error('No hay preguntas para escanear en esta hoja.');
        return { success: false };
      }
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
    [exam, examId, isMobile, mapRawToDraft, omrCols, setPreviewFromSource, sheets, supportsCalifacil]
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
    if (phase === 'revisar_hoja' && prevPhaseRef.current !== 'revisar_hoja') {
      setReviewHumanAck(false);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

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
    setReviewHumanAck(false);
    setSelectedStudentId('');
  }, [stopLiveCamera, isMobile]);

  const handleStudentChange = (studentId: string) => {
    if (gradeMode !== 'student') return;
    if (!canGradeStudents) {
      toast.error('Primero captura y guarda la hoja clave del maestro para habilitar la calificación de alumnos.');
      return;
    }
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
    setReviewOmrGeometry(null);
    setReviewHumanAck(false);
  };

  const startSheetCapture = useCallback(() => {
    const canStart =
      Boolean(examId) &&
      Boolean(exam) &&
      !examLoading &&
      supportsCalifacil &&
      questions.length > 0 &&
      questions.length <= maxQuestions &&
      virtualKey.issues.length === 0 &&
      (gradeMode === 'master_key' || (canGradeStudents && sortedStudents.some((s) => s.id === selectedStudentId)));
    if (!canStart) {
      toast.error(
        gradeMode === 'master_key'
          ? 'Elige un examen válido para capturar la hoja clave.'
          : !canGradeStudents
            ? 'Primero captura y guarda la hoja clave del maestro.'
            : 'Selecciona un alumno válido para iniciar la captura.'
      );
      return;
    }
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
    setReviewOmrGeometry(null);
    setReviewHumanAck(false);
  }, [
    exam,
    examId,
    examLoading,
    gradeMode,
    isMobile,
    maxQuestions,
    canGradeStudents,
    questions.length,
    selectedStudentId,
    sortedStudents,
    stopLiveCamera,
    supportsCalifacil,
    virtualKey.issues.length,
  ]);

  const uploadMasterKeyImage = useCallback(
    async (
      sheetIdx: number,
      source: string | HTMLCanvasElement | HTMLImageElement
    ): Promise<boolean> => {
      if (!examId) return false;
      try {
        setKeyImageUploading(true);
        let img: HTMLImageElement;
        if (typeof source === 'string') {
          const blob = await fetch(source).then((r) => r.blob());
          img = await blobToImage(blob);
        } else if (source instanceof HTMLCanvasElement) {
          img = await blobToImage(
            await new Promise<Blob>((resolve, reject) => {
              source.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo serializar la imagen'))), 'image/jpeg', 0.92);
            })
          );
        } else {
          img = source;
        }
        const w = Math.max(1, Math.round(img.naturalWidth || img.width));
        const h = Math.max(1, Math.round(img.naturalHeight || img.height));

        const originalCanvas = document.createElement('canvas');
        originalCanvas.width = w;
        originalCanvas.height = h;
        const octx = originalCanvas.getContext('2d');
        if (!octx) throw new Error('No se pudo preparar imagen original');
        octx.drawImage(img, 0, 0, w, h);

        const blurCanvas = document.createElement('canvas');
        blurCanvas.width = w;
        blurCanvas.height = h;
        const bctx = blurCanvas.getContext('2d');
        if (!bctx) throw new Error('No se pudo preparar imagen blur');
        const blurPx = Math.max(8, Math.round(Math.min(w, h) * 0.03));
        bctx.filter = `blur(${blurPx}px)`;
        bctx.drawImage(img, 0, 0, w, h);
        bctx.filter = 'none';

        const headers = await dashboardAuthJsonHeaders();
        const res = await fetch(`/api/exams/${examId}/answer-key-image`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sheetIndex: sheetIdx,
            originalImageBase64: canvasToDataUrl(originalCanvas, 0.92),
            blurImageBase64: canvasToDataUrl(blurCanvas, 0.9),
            width: w,
            height: h,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(payload.error || 'No se pudo guardar la foto de la hoja clave');
        }
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'No se pudo guardar foto de clave';
        toast.error('No se pudo guardar la foto de la hoja clave', {
          description: toSpanishAuthMessage(msg),
        });
        return false;
      } finally {
        setKeyImageUploading(false);
      }
    },
    [examId]
  );

  const loadMasterBlurOverlay = useCallback(async () => {
    if (!examId || gradeMode !== 'student' || !canGradeStudents) {
      setMasterBlurOverlayUrl(null);
      return;
    }
    try {
      const headers = await dashboardAuthJsonHeaders();
      const res = await fetch(
        `/api/exams/${examId}/answer-key-image?sheetIndex=${sheetIndex}`,
        { method: 'GET', headers }
      );
      const payload = (await res.json().catch(() => ({}))) as {
        hasImage?: boolean;
        blurSignedUrl?: string;
      };
      if (res.ok && payload.hasImage && payload.blurSignedUrl) {
        setMasterBlurOverlayUrl(payload.blurSignedUrl);
      } else {
        setMasterBlurOverlayUrl(null);
      }
    } catch {
      setMasterBlurOverlayUrl(null);
    }
  }, [canGradeStudents, examId, gradeMode, sheetIndex]);

  useEffect(() => {
    void loadMasterBlurOverlay();
  }, [loadMasterBlurOverlay]);

  const handleGalleryFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!examId || !exam || !supportsCalifacil || phase !== 'capturar') {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return;
    }
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

  const startLiveCamera = useCallback(async () => {
    if (!examId || !exam || !supportsCalifacil || phase !== 'capturar') {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return;
    }
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
        if (!examId || !exam || phase !== 'capturar') {
          stopScanningHum();
          return;
        }
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
          if (chunk.length === 0) return;
          const oriented = autoOrientCalifacilSheet(frame, omrCols) ?? frame;
          if (!isCalifacilExamSheetLikely(oriented, omrCols)) {
            stopScanningHum();
            stablePartialTicksRef.current = 0;
            stableFullTicksRef.current = 0;
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
              'Detección completa. Capturando automáticamente...'
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
          if (mergedResolved >= chunk.length && chunk.length > 0) {
            stableFullTicksRef.current += 1;
          } else {
            stableFullTicksRef.current = 0;
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

          if (
            stableFullTicksRef.current >= STABLE_FULL_TICKS &&
            chunk.length > 0 &&
            !scanBusyRef.current &&
            !autoFinalizeInProgressRef.current
          ) {
            stableFullTicksRef.current = 0;
            await showAutoCaptureSnapshot(oriented);
            await autoCaptureAndCompareRef.current(
              mergedLive,
              gradeMode === 'master_key' ? oriented : undefined
            );
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
  }, [
    attachStreamToVideo,
    cameraOpen,
    exam,
    examId,
    mapRawToDraft,
    omrCols,
    phase,
    gradeMode,
    resetLiveReadings,
    showAutoCaptureSnapshot,
    setTorchEnabled,
    sheets,
    supportsCalifacil,
  ]);

  useEffect(() => {
    if (!isMobile) return;
    if (!examId || !exam || !supportsCalifacil) return;
    if (phase !== 'capturar' || cameraOpen || scanBusy) return;
    void startLiveCamera();
  }, [isMobile, examId, exam, supportsCalifacil, cameraOpen, phase, scanBusy, startLiveCamera]);

  const confirmCurrentSheet = async (
    autoSource?: HTMLCanvasElement | HTMLImageElement,
    providedDraft?: Record<string, string>
  ) => {
    if (!examId || !exam) {
      toast.error('Selecciona un examen antes de confirmar.');
      return;
    }
    const chunk = sheets[sheetIndex] ?? [];
    if (chunk.length === 0) {
      toast.error('No hay preguntas para esta hoja.');
      return;
    }
    const effectiveDraft = providedDraft ?? draftSelections;
    for (const q of chunk) {
      const v = effectiveDraft[q.id]?.trim() ?? '';
      if (!v) {
        toast.error(`Falta la respuesta de la pregunta ${questions.findIndex((x) => x.id === q.id) + 1}`);
        return;
      }
    }

    if (gradeMode === 'master_key') {
      const sourceForUpload = autoSource ?? previewUrl;
      if (!sourceForUpload) {
        toast.error('No hay foto de hoja para guardar como clave. Vuelve a escanear.');
        return;
      }
      const ok = await uploadMasterKeyImage(sheetIndex, sourceForUpload);
      if (!ok) return;
    }

    const mergedNow: Record<string, string> = { ...confirmedByQuestionId };
    for (const q of chunk) {
      mergedNow[q.id] = effectiveDraft[q.id]!;
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

    await submitAll(mergedNow);
  };

  const autoCaptureAndCompare = async (
    mergedDraft: Record<string, string>,
    sourceForKey?: HTMLCanvasElement | HTMLImageElement
  ) => {
    if (autoFinalizeInProgressRef.current) return;
    autoFinalizeInProgressRef.current = true;
    try {
      setDraftSelections(mergedDraft);
      setLiveDraftSelections(mergedDraft);
      setLiveStatus('Hoja detectada y capturada automáticamente. Procesando...');
      await confirmCurrentSheet(sourceForKey, mergedDraft);
    } finally {
      autoFinalizeInProgressRef.current = false;
    }
  };

  const submitAll = async (merged: Record<string, string>) => {
    if (!exam || !examId) return;

    for (const q of questions) {
      if (!merged[q.id]?.trim()) {
        toast.error('Faltan respuestas por confirmar.');
        return;
      }
    }

    if (gradeMode === 'student' && (!selectedStudentId || !sortedStudents.some((s) => s.id === selectedStudentId))) {
      toast.error('Alumno no válido. Vuelve a seleccionar en la primera pantalla.');
      return;
    }
    if (gradeMode === 'student' && !canGradeStudents) {
      toast.error('Calificación bloqueada: primero captura y guarda la hoja clave del maestro.');
      return;
    }

    setPhase('guardando');

    try {
      if (gradeMode === 'master_key') {
        const teacherKeyPayload = questions.reduce<Record<string, string>>((acc, q) => {
          const answerText = (merged[q.id] ?? '').trim();
          if (answerText) acc[q.id] = answerText;
          return acc;
        }, {});
        const { error: keyError } = await supabase
          .from('exams')
          .update({
            answer_key_source: 'teacher_sheet',
            answer_key_by_question: teacherKeyPayload,
          })
          .eq('id', examId);
        if (keyError) throw keyError;
        toast.success('Hoja clave guardada. Las próximas calificaciones se compararán contra esta clave.');
      } else {
        const studentId = selectedStudentId;
        const effectiveKey = teacherSheetKeyByQuestionId;
        const mcQuestions = questions.filter((q) => q.type === 'multiple_choice');
        const mcTotal = mcQuestions.length;
        if (Object.keys(effectiveKey).length !== mcTotal) {
          toast.error('Clave del maestro incompleta. Vuelve a capturar la hoja clave antes de calificar.');
          setPhase('elegir');
          return;
        }

        let correctCount = 0;
        const rows = questions.map((question: Question) => {
          const answerText = (merged[question.id] ?? '').trim();
          const expected = (effectiveKey[question.id] ?? '').trim();
          const isCorrect =
            question.type === 'multiple_choice' ? Boolean(expected) && answerText === expected : null;
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
      }

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
      const isMissingKeyColumn =
        msg.includes('answer_key_source') || msg.includes('answer_key_by_question');
      toast.error('No se pudo guardar', {
        description: isMissingKeyColumn
          ? 'Falta actualizar la base de datos para hoja clave del maestro. Ejecuta la migración más reciente y vuelve a intentar.'
          : msg
            ? toSpanishAuthMessage(msg)
            : 'Revisa tu conexión y permisos.',
      });
      setPhase('revisar_hoja');
    }
  };

  const commitGradeFromLive = useCallback(async () => {
    if (!examId || !exam || phase !== 'capturar') {
      toast.error('Selecciona un examen válido antes de revisar y confirmar.');
      return;
    }
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
  }, [
    draftSelections,
    exam,
    examId,
    liveDraftSelections,
    omrCols,
    phase,
    setPreviewFromSource,
    setPreviewUrl,
    sheetIndex,
    sheets,
  ]);

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
  autoCaptureAndCompareRef.current = autoCaptureAndCompare;

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
          <CardTitle className="text-base sm:text-lg">Examen y modo de calificación</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Captura una hoja clave del maestro y luego califica alumnos por comparación con esa clave.
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

          {!examId && (
            <p className="text-xs text-gray-500">
              Selecciona un examen para habilitar las opciones de captura y calificación.
            </p>
          )}

          {examId && (
            <>
              <div className="space-y-2">
                <Label>Modo</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant={gradeMode === 'master_key' ? 'default' : 'outline'}
                    className={gradeMode === 'master_key' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                    disabled={phase === 'guardando'}
                    onClick={() => {
                      setGradeMode('master_key');
                      setSelectedStudentId('');
                      resetFlow();
                    }}
                  >
                    Capturar hoja clave
                  </Button>
                  <Button
                    type="button"
                    variant={gradeMode === 'student' ? 'default' : 'outline'}
                    className={gradeMode === 'student' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                    disabled={phase === 'guardando'}
                    onClick={() => {
                      if (!canGradeStudents) {
                        toast.error('Primero captura y guarda la hoja clave del maestro.');
                        setGradeMode('master_key');
                        return;
                      }
                      setGradeMode('student');
                    }}
                  >
                    Calificar alumno
                  </Button>
                </div>
              </div>

              {exam && supportsCalifacil && (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    usingTeacherSheetKey && teacherSheetKeyComplete
                      ? 'border-green-200 bg-green-50 text-green-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {usingTeacherSheetKey && teacherSheetKeyComplete ? (
                    <>Clave activa: hoja del maestro ({answeredByTeacherSheetCount}/{questions.length} reactivos).</>
                  ) : (
                    <>
                      Aún no hay hoja clave del maestro completa. La calificación de alumnos está bloqueada hasta
                      capturarla y guardarla.
                    </>
                  )}
                </div>
              )}

              {gradeMode === 'student' && (
                <div className="space-y-2">
                  <Label htmlFor="calif-alumno">Alumno</Label>
                  <StudentCombobox
                    id="calif-alumno"
                    students={sortedStudents}
                    value={selectedStudentId}
                    onValueChange={handleStudentChange}
                    disabled={phase === 'guardando' || !canGradeStudents}
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
                    {canGradeStudents
                      ? 'Solo puedes calificar a alumnos que estén en la lista del grupo del examen.'
                      : 'Bloqueado: captura primero la hoja clave del maestro para habilitar esta sección.'}
                  </p>
                </div>
              )}

              {gradeMode === 'master_key' && exam && supportsCalifacil && (
                <Button
                  type="button"
                  className="w-full bg-orange-600 hover:bg-orange-700 sm:w-auto"
                  disabled={phase === 'guardando'}
                  onClick={startSheetCapture}
                >
                  Capturar hoja clave del maestro
                </Button>
              )}
            </>
          )}

        </CardContent>
      </Card>

      {(phase === 'capturar' || phase === 'revisar_hoja') && exam && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {gradeMode === 'master_key' ? 'Hoja clave' : 'Hoja de alumno'} {sheetIndex + 1} de {totalSheets}
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
                          {showAutoSnapshot && autoSnapshotUrl ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={autoSnapshotUrl}
                                alt="Snapshot automático de captura"
                                className="absolute inset-0 z-[2] h-full w-full object-cover"
                              />
                              <div className="absolute left-1/2 top-3 z-[3] -translate-x-1/2 rounded-full bg-green-600/95 px-3 py-1 text-xs font-semibold text-white shadow">
                                Captura automática realizada
                              </div>
                            </>
                          ) : null}
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
                            onClick={
                              gradeMode === 'master_key'
                                ? () => {
                                    resetFlow();
                                    setPhase('elegir');
                                  }
                                : switchToAnotherStudentScan
                            }
                            disabled={scanBusy}
                          >
                            {gradeMode === 'master_key'
                              ? 'Volver a configuración'
                              : 'Escanear examen de otro alumno'}
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
              <div className="space-y-2">
                <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
                  <div className="relative inline-block max-h-96 max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Vista previa del recuadro CaliFacil"
                      className="relative z-0 block max-h-96 w-auto max-w-full"
                    />
                    {gradeMode === 'student' && masterBlurOverlayUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={masterBlurOverlayUrl}
                          alt="Superposición blur de hoja clave del maestro"
                          className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain"
                          style={{ opacity: overlayOpacity / 100 }}
                        />
                      </>
                    ) : null}
                    {reviewOmrGeometry ? (
                      <CalifacilOmrReviewOverlay
                        geometry={reviewOmrGeometry}
                        picks={draftSelectionsToColumnPicks(currentChunk, draftSelections)}
                        rowCount={currentChunk.length}
                      />
                    ) : null}
                  </div>
                </div>
                {gradeMode === 'student' && masterBlurOverlayUrl ? (
                  <div className="rounded-md border bg-white px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                      <span>Superposición blur de clave</span>
                      <span>{overlayOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={overlayOpacity}
                      onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                      className="w-full accent-orange-600"
                    />
                  </div>
                ) : null}
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
                <Alert variant="default" className="border-sky-200 bg-sky-50 text-sky-950">
                  <Info className="h-4 w-4" />
                  <AlertTitle className="text-sm">Exactitud de la lectura automática</AlertTitle>
                  <AlertDescription className="text-sm">
                    Ninguna cámara ni algoritmo garantiza un 100% de acierto en todos los casos (luz, sombras,
                    marca incompleta, etc.). La nota que se guardará es la que elijas aquí; revisa la foto y las
                    casillas resaltadas antes de confirmar. Si necesitas máxima ayuda automática, configura la
                    verificación por IA en el servidor (ver <code className="text-xs">.env.example</code>).
                  </AlertDescription>
                </Alert>
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
                          setReviewHumanAck(false);
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

                <div className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-3">
                  <Checkbox
                    id="review-human-ack"
                    checked={reviewHumanAck}
                    onCheckedChange={(c) => setReviewHumanAck(c === true)}
                  />
                  <Label htmlFor="review-human-ack" className="cursor-pointer text-sm font-normal leading-snug text-gray-800">
                    He revisado la foto y cada opción: la calificación guardada será la que figure arriba, no la
                    lectura automática por sí sola.
                  </Label>
                </div>

                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setPhase('capturar');
                      setReviewHumanAck(false);
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
                    disabled={!reviewHumanAck || scanBusy || keyImageUploading}
                    onClick={() => void confirmCurrentSheet()}
                  >
                    {keyImageUploading
                      ? 'Guardando foto clave...'
                      : gradeMode === 'master_key'
                        ? 'Guardar hoja clave'
                        : 'Guardar calificación'}
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
