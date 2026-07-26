'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, FileUp, Info, LayoutDashboard, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useExam, useExams } from '@/hooks/useExams';
import { downloadCalificacionCsv } from '@/lib/calificarExport';
import {
  canvasToJpegFile,
  createPdfGradingHandle,
  PDF_OMR_RENDER_MAX_SIDE,
  renderPdfGradingPageCanvas,
  type PdfGradingHandle,
} from '@/lib/pdfClientPreview';
import { supabase } from '@/lib/supabase';
import {
  buildCalifacilVirtualKey,
  buildCalifacilAnswerSheetOmrTemplate,
  califacilOmrColumnCount,
  chunkQuestions,
  CALIFACIL_PRINT_MAX_QUESTIONS,
  examSupportsCalifacilOmr,
  getCalifacilOmrSheetQuestions,
} from '@/lib/printExam';
import {
  classifyAnswerSheetFormat,
  scanZipGradeAnswerSheet,
  warpZipGradeAnswerSheet,
  type ZipGradeSheetKind,
} from '@/lib/omrZipGrade';
import {
  autoOrientCalifacilSheet,
  califacilImageToJpegDataUrl,
  califacilMobileAnswerSheetGuideInViewportPx,
  captureVideoFullFrame,
  captureImageFullFrame,
  captureVideoFrameForDocumentDetect,
  detectAnswerSheetFiducialsInRoi,
  detectMobileLiveSheetQuad,
  estimateCanvasShadowAsymmetry,
  detectLargestQuadInRoiCanvas,
  detectAnswerSheetQuadViaAlignStrips,
  estimateCanvasMeanLuminance,
  estimateCanvasSharpness,
  fileToImage,
  getObjectCoverVideoLetterbox,
  isCalifacilExamSheetLikely,
  isCalifacilExamSheetStrict,
  isCalifacilAnswerSheetReadyForGrading,
  diagnoseCalifacilAnswerSheetReadiness,
  isValidMobileRoiQuad,
  mapRoiQuadToFrame,
  mapRoiQuadPolygonToViewportPx,
  scaleQuadToCanvas,
  measureRoiSheetFillRatio,
  measureWarpedFiducialAlignment,
  MAX_WARP_ALIGNMENT_ERROR_PX,
  MOBILE_MIN_FIDUCIAL_CORNERS,
  MOBILE_LIVE_MIN_FIDUCIAL_CORNERS,
  MOBILE_MIN_ROI_FILL_RATIO,
  isMobileExamSheetReadyForCapture,
  isCalifacilWarpedLetterCanvas,
  isMobileWarpedAnswerSheetAcceptable,
  countCalifacilCornerMarkers,
  hasCalifacilAlignStrips,
  mobileRoiQuadsAreStable,
  MOBILE_ROI_DETECT_MAX_SIDE,
  type MobileGuideRoiCapture,
  prepareMobileScannedDocumentCanvas,
  prepareMobileScannedDocumentCanvasFast,
  prepareCalifacilScanInput,
  probeCalifacilSheetQuality,
  refineWarpedCalifacilSheet,
  scanCalifacilOmrSheetWithMeta,
  scanWarpedMobileAnswerSheetFast,
  scanWarpedWithBestTableFrame,
  readAnswerSheetControlNumberFromCanvas,
  califacilOmrTableFrameNormRect,
  canvasPreviewDataUrl,
  canvasPreviewJpeg,
  cropAnswerSheetNameSnippetDataUrl,
  isAnswerSheetOmrMostlyBlank,
  sanitizeAnswerSheetOmrMeta,
  downscaleCanvasForOmrScan,
  syncCalifacilOmrGeometryImageSize,
  buildLetterDisplayOverlayGeometry,
  buildAnswerSheetOmrGeometry,
  smoothMobileRoiQuad,
  warpCalifacilSheetFromCornerMarkers,
  type WarpAlignmentReport,
  type CalifacilOmrScanGeometry,
  type OmrNormRect,
  type OmrScanMetaResult,
  type CalifacilSheetQualityProbe,
} from '@/lib/omrScan';
import { findStudentByControlNumber } from '@/lib/controlNumberOmr';
import {
  CALIFICAR_AUTO_STUDENT_ID,
  isCalificarAutoStudentMode,
  normalizeCalificarStudentSelection,
  resolveCalificarStudentId,
} from '@/lib/calificarStudentMode';
import {
  buildVirtualKeyMaps,
  draftSelectionsToColumnPicks,
  expectedPicksForChunk,
  gradeMcDraftAgainstVirtualKey,
  gradeMcQuestionForPersist,
  gradeOmrChunkPicksAgainstVirtualKey,
  isMcPickCorrect,
  mapOmrPicksToMcDraftDetailed,
  resolveStudentPickIndex,
} from '@/lib/calificarGrading';
import {
  classifyDesktopUploadCanvas,
  normalizeCalifacilGradeDocumentCanvas,
  prepareCalifacilGradeScanCanvases,
  isMobileLetterGradeCanvasReady,
  warpCalifacilMobileCaptureFast,
} from '@/lib/omr/pipeline';
import {
  buildDesktopDisplayOverlayGeometry,
  isReferenceGradeCanvasAnchor,
} from '@/lib/omr/reference-grade';
import { scanWarpedGradeMobileAsync, resolveMobileGradeDisplay } from '@/lib/omr/unified-grade-scan';
import { setCameraTorch, trackReportsTorchCapability } from '@/lib/cameraTorch';
import { type LiveVideoLetterbox } from '@/components/califacil-live-scan-overlay';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';
import {
  CalifacilOmrDebugOverlay,
  formatWarpAlignmentSummary,
} from '@/components/califacil-omr-debug-overlay';
import { ExamScannerScreen, type CameraPermissionPhase } from '@/components/exam-scanner';
import {
  createStaticScannerGuide,
  readScannerViewportPx,
} from '@/components/exam-scanner/document-detector';
import {
  CAPTURE_STABLE_TICKS_REQUIRED,
  MOBILE_CAPTURE_STABLE_TICKS_REQUIRED,
  mobileCaptureMinResolvedRows,
  shouldTriggerAutoCapture,
} from '@/components/exam-scanner/capture-controller';
import type { ScannerActions } from '@/components/exam-scanner/scanner-actions';
import { CalificarMobileHome } from '@/components/calificar-mobile-home';
import { MobileSheetScanReview } from '@/components/mobile-sheet-scan-review';
import {
  MobileZipGradeReviewScreen,
  MobileZipGradeScanCompleteModal,
  MobileZipGradeStudentPicker,
  type ZipGradeSheetData,
} from '@/components/mobile-zipgrade-results';
import {
  type ExamFullscreenMode,
  EXAM_PSEUDO_FULLSCREEN_CLASS,
  enterExamFullscreen,
  exitExamFullscreenSafe,
} from '@/lib/examFullscreen';
import {
  calculatePercentage,
  questionPoints,
  cn,
  getGradeColor,
  getGradeLabel,
  resolveOptionIndexFromValue,
} from '@/lib/utils';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Exam, Question, Student } from '@/types';
import { toSpanishAuthMessage } from '@/lib/authErrors';
import {
  isDesktopPointerDevice,
  useCalificarLiveCamera,
  useIsMobile,
} from '@/hooks/use-mobile';
import {
  CALIFACIL_AMBIGUOUS_ROW_WARN_RATIO,
  CALIFACIL_MIN_AUTO_READ_RATIO,
  buildCalifacilOmrReadingOverride,
  runCalifacilOmrReadingPipeline,
  type CalifacilOmrReadingResult,
  type DesktopUploadKind,
} from '@/lib/calificarOmrReading';
import {
  playAutoCaptureClickSound,
  playScanCompleteChime,
  resumeScanAudioContext,
  startScanningHum,
  stopScanningHum,
} from '@/lib/scanSounds';

type Phase = 'elegir' | 'capturar' | 'revisar_hoja' | 'guardando' | 'ver_resultados';

type FlashMode = 'auto' | 'on' | 'off';

type MobileCaptureReviewState = {
  sourceCanvas: HTMLCanvasElement;
  frameQuad: RoiQuad;
  warped: HTMLCanvasElement;
  alignment: WarpAlignmentReport | null;
};

type MobileReviewAlignPreview = {
  warped: HTMLCanvasElement;
  alignment: WarpAlignmentReport | null;
  geometry: CalifacilOmrScanGeometry;
  picks: (number | null)[];
  draft: Record<string, string>;
  previewUrl: string;
  orangeFrameNorm: OmrNormRect;
};

type MobileSheetSnapshot = {
  sheetIndex: number;
  previewUrl: string;
  geometry: CalifacilOmrScanGeometry;
  questionIds: string[];
  selectionsByQuestionId: Record<string, string>;
  /** Índice de columna OMR leído por fila (0 = A), alineado con la plantilla naranja. */
  columnPicks: (number | null)[];
  /** Hoja de respuestas enderezada por fiduciales (plantilla calibrada). */
  answerSheetLayout?: boolean;
  /** Métricas de alineación homografía (depuración / validación). */
  warpAlignment?: WarpAlignmentReport | null;
  /** Recorte de la línea de nombre manuscrito (estilo ZipGrade). */
  nameCropUrl?: string | null;
};

async function cloneObjectUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Umbral mínimo de reactivos leídos para fijar borrador y habilitar guardado en cámara en vivo. */
const MIN_AUTO_READ_RATIO = CALIFACIL_MIN_AUTO_READ_RATIO;
/** Fotogramas consecutivos con lectura estable antes de fijar borrador (consenso en vivo). */
const STABLE_PARTIAL_TICKS = 3;
/** Fotogramas consecutivos con hoja completa para disparar captura automática. */
const STABLE_FULL_TICKS = 3;
/** Lecturas idénticas consecutivas para fijar una respuesta en el loop en vivo. */
const CONSENSUS_LOCK_TICKS = 4;
/** Mínimo de filas leídas (ratio) para auto-captura móvil. */
const MOBILE_AUTO_CAPTURE_MIN_RATIO = 0.9;
/** Si más filas ambiguas que esto, aviso explícito en revisión. */
const AMBIGUOUS_ROW_WARN_RATIO = CALIFACIL_AMBIGUOUS_ROW_WARN_RATIO;
/** Resolución máxima usada para escaneo en vivo móvil (menos píxeles = UI más fluida). */
const MOBILE_SCAN_MAX_WIDTH = 1920;
/** Resolución máxima al capturar foto final en móvil. */
const MOBILE_CAPTURE_MAX_SIDE = 1280;
/** Galería: un poco más de resolución para warp/OMR sin deskew lento. */
const MOBILE_GALLERY_CAPTURE_MAX_SIDE = 1440;
/** Calidad JPEG de vista previa y resultados móvil (ligera para no bloquear el popup). */
const MOBILE_PREVIEW_JPEG_QUALITY = 0.82;
/** Nitidez mínima del frame live (ROI) antes de disparar. */
const MOBILE_MIN_LIVE_SHARPNESS = 14;
/** Nitidez mínima del fotograma enderezado (Laplaciano). */
const MOBILE_MIN_WARPED_SHARPNESS = 12;
/** Tras varios ticks sin detección, intentamos flash en móvil si está disponible. */
const LOW_VISIBILITY_AUTOTORCH_TICKS = 3;
/** Asimetría de luminancia izq/der que sugiere sombra fuerte en la hoja. */
const SHADOW_ASYMMETRY_TORCH = 0.14;
/** Ticks con sombra antes de activar flash automático. */
const SHADOW_AUTOTORCH_TICKS = 2;
/** Ticks consecutivos en validación estricta antes de mostrar burbujas en vivo. */
const LIVE_STRICT_OVERLAY_TICKS = 2;
/** Fotogramas estables antes de auto-captura (~0,2 s con loop a 50 ms). */
/** Intervalo del loop de detección de documento en móvil (ms). */
const MOBILE_CORNER_LOOP_MS = 50;
/** Mantiene el polígono visible un instante si la detección parpadea (fluidez iOS). */
const DOCUMENT_POLYGON_HOLD_MS = 420;
/** Tiempo mínimo de espera con hoja alineada antes de auto-captura. */
const MOBILE_ALIGN_HOLD_MS = CAPTURE_STABLE_TICKS_REQUIRED * MOBILE_CORNER_LOOP_MS;
/** Tolerancia de alineación fiducial en captura móvil (más permisivo que escritorio). */
const MOBILE_WARP_FALLBACK_MAX_ERROR_PX = 10;
/** Luminancia mínima del fotograma; por debajo se considera cámara negra. */
const MIN_FRAME_LUMINANCE = 0.11;
/** Superpone plantilla PDF y error fiducial en px (`.env`: `NEXT_PUBLIC_CALIFACIL_OMR_DEBUG=true`). */
const OMR_DEBUG_ENABLED = process.env.NEXT_PUBLIC_CALIFACIL_OMR_DEBUG === 'true';
/** Etiquetas de cámaras virtuales comunes que no queremos priorizar en escritorio. */

/** Valores centinela para que Radix Select sea siempre controlado (evita uncontrolled→controlled). */
const SELECT_NO_EXAM = '__califacil_no_exam__';
const SELECT_NO_OPTION = '__califacil_no_option__';

type RoiQuad = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
];

function resolveCaptureFrameQuad(
  fullCanvas: HTMLCanvasElement,
  roiQuad?: RoiQuad | null,
  roiCapture?: MobileGuideRoiCapture | null
): RoiQuad {
  if (roiQuad && roiCapture) {
    const mapped = mapRoiQuadToFrame(
      roiQuad,
      roiCapture.roiRect,
      roiCapture.roiCanvas.width,
      roiCapture.roiCanvas.height
    );
    return scaleQuadToCanvas(
      mapped,
      roiCapture.frameW,
      roiCapture.frameH,
      fullCanvas.width,
      fullCanvas.height
    );
  }
  const w = fullCanvas.width;
  const h = fullCanvas.height;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

/** Foto de cámara subida en desktop: warp vía normalizeCalifacilGradeDocumentCanvas. */
function defaultDocumentQuad(canvasW: number, canvasH: number): RoiQuad {
  const m = 0.035;
  return [
    { x: canvasW * m, y: canvasH * m },
    { x: canvasW * (1 - m), y: canvasH * m },
    { x: canvasW * (1 - m), y: canvasH * (1 - m) },
    { x: canvasW * m, y: canvasH * (1 - m) },
  ];
}

function frameQuadOnFullCanvas(
  roiQuad: RoiQuad,
  roiCapture: MobileGuideRoiCapture,
  fullCanvas: HTMLCanvasElement
): RoiQuad {
  const frameQuad = mapRoiQuadToFrame(
    roiQuad,
    roiCapture.roiRect,
    roiCapture.roiCanvas.width,
    roiCapture.roiCanvas.height
  );
  return scaleQuadToCanvas(
    frameQuad,
    roiCapture.frameW,
    roiCapture.frameH,
    fullCanvas.width,
    fullCanvas.height
  );
}

function buildMcDraftFromChunk(
  chunk: Question[],
  source: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of chunk) {
    if (q.type !== 'multiple_choice') continue;
    out[q.id] = source[q.id]?.trim() ?? '';
  }
  return out;
}

/**
 * Permite que React y el navegador pinten el spinner antes de trabajo pesado en el hilo principal;
 * si no, la animación CSS parece “congelada”.
 */
function yieldForSpinnerPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 16);
      });
    });
  });
}

function countResolvedOmrPicks(picks: (number | null)[]): number {
  let n = 0;
  for (const p of picks) {
    if (p !== null) n += 1;
  }
  return n;
}

function omrPicksMeetInstantThreshold(picks: (number | null)[], minRatio = 0.7): boolean {
  if (picks.length === 0) return false;
  return countResolvedOmrPicks(picks) >= picks.length * minRatio;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Detiene el stream en vivo mientras se muestra el documento escaneado. */
function pauseLiveVideoForScan(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    /* ignore */
  }
  const stream = video.srcObject as MediaStream | null;
  stream?.getVideoTracks().forEach((track) => {
    track.enabled = false;
  });
}

/** Reanuda la cámara tras un escaneo fallido o cancelado. */
function resumeLiveVideoAfterScan(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getVideoTracks().forEach((track) => {
    track.enabled = true;
  });
  void video.play().catch(() => {});
}

function clearMobileScanPreview(
  video: HTMLVideoElement | null,
  setters: {
    setPreviewUrl: (url: string | null) => void;
    setPreviewGeometry: (g: CalifacilOmrScanGeometry | null) => void;
    setPreviewPicks: (p: (number | null)[]) => void;
    setPreviewOrangeFrame: (r: { x: number; y: number; w: number; h: number } | null) => void;
  }
): void {
  setters.setPreviewUrl(null);
  setters.setPreviewGeometry(null);
  setters.setPreviewPicks([]);
  setters.setPreviewOrangeFrame(null);
  if (video) resumeLiveVideoAfterScan(video);
}

function CalifacilReviewImageStack({
  previewUrl,
  alt,
  geometry,
  overlay,
}: {
  previewUrl: string;
  alt: string;
  geometry: CalifacilOmrScanGeometry;
  overlay: ReactNode;
}) {
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  return (
    <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
      <div
        className="relative overflow-hidden rounded-md bg-neutral-200/50"
        style={{
          width: `min(100%, calc(24rem * ${W} / ${H}))`,
          aspectRatio: `${W} / ${H}`,
          maxHeight: '24rem',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt={alt}
          className="absolute inset-0 z-0 h-full w-full object-contain object-center"
        />
        <div className="pointer-events-none absolute inset-0 z-[2]">{overlay}</div>
      </div>
    </div>
  );
}

export default function CalificarPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  // Cámara solo en móvil táctil; en escritorio (ratón) solo subida de archivos.
  const useLiveCameraUi = useCalificarLiveCamera();
  const { user } = useAuth();
  const { exams, loading: examsLoading } = useExams(user?.id);

  const [examId, setExamId] = useState<string>('');
  const { exam, loading: examLoading } = useExam(examId || undefined);

  const [selectedStudentId, setSelectedStudentId] = useState(CALIFICAR_AUTO_STUDENT_ID);
  const [detectedControlNumber, setDetectedControlNumber] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [allowedGroupIds, setAllowedGroupIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('elegir');
  const [sheetIndex, setSheetIndex] = useState(0);
  /** Respuestas confirmadas por id de pregunta (todas las hojas) */
  const [confirmedByQuestionId, setConfirmedByQuestionId] = useState<Record<string, string>>({});
  /** Lectura OMR de la hoja actual (antes de confirmar) */
  const [draftSelections, setDraftSelections] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** Geometría de celdas del último escaneo (misma relación de aspecto que la vista previa). */
  const [reviewOmrGeometry, setReviewOmrGeometry] = useState<CalifacilOmrScanGeometry | null>(null);
  const [reviewOmrPicks, setReviewOmrPicks] = useState<(number | null)[]>([]);
  const [scanBusy, setScanBusy] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Sube una imagen escaneada para leer respuestas.');
  const [liveResolvedCount, setLiveResolvedCount] = useState(0);
  const [liveDraftSelections, setLiveDraftSelections] = useState<Record<string, string>>({});
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [flashMode, setFlashMode] = useState<FlashMode>('auto');
  const [autoShutterEnabled, setAutoShutterEnabled] = useState(true);
  const [liveFilterMenuOpen, setLiveFilterMenuOpen] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [mobileScanPreviewUrl, setMobileScanPreviewUrl] = useState<string | null>(null);
  const [mobileScanPreviewGeometry, setMobileScanPreviewGeometry] =
    useState<CalifacilOmrScanGeometry | null>(null);
  const [mobileScanPreviewPicks, setMobileScanPreviewPicks] = useState<(number | null)[]>([]);
  const [mobileScanPreviewOrangeFrame, setMobileScanPreviewOrangeFrame] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [cameraPermissionPhase, setCameraPermissionPhase] =
    useState<CameraPermissionPhase>('granted');
  const [mobileDocumentPolygon, setMobileDocumentPolygon] = useState<
    Array<{ x: number; y: number }> | null
  >(null);
  const [cameraFullscreenMode, setCameraFullscreenMode] = useState<ExamFullscreenMode>('none');
  const [liveScanGeometry, setLiveScanGeometry] = useState<CalifacilOmrScanGeometry | null>(null);
  const [liveScanPicks, setLiveScanPicks] = useState<(number | null)[]>([]);
  const [liveScanLockedRows, setLiveScanLockedRows] = useState<boolean[]>([]);
  const [liveScanAmbiguousRows, setLiveScanAmbiguousRows] = useState<boolean[]>([]);
  const [liveVideoLayout, setLiveVideoLayout] = useState<LiveVideoLetterbox | null>(null);
  const [staticScannerGuideRect, setStaticScannerGuideRect] = useState(() => {
    if (typeof window === 'undefined') return null;
    const { w, h } = readScannerViewportPx();
    return createStaticScannerGuide(w, h);
  });
  const [liveShowBubbleOverlay, setLiveShowBubbleOverlay] = useState(false);
  const [cornersAlignedView, setCornersAlignedView] = useState(false);
  const [mobileSheetFillRatio, setMobileSheetFillRatio] = useState(0);
  const [mobileFiducialCount, setMobileFiducialCount] = useState(0);
  const [mobileFiducialCorners, setMobileFiducialCorners] = useState<
    [boolean, boolean, boolean, boolean]
  >([false, false, false, false]);
  const [mobileStripAligned, setMobileStripAligned] = useState(false);
  const [mobileShadowWarning, setMobileShadowWarning] = useState(false);
  const [mobileScannerLowLight, setMobileScannerLowLight] = useState(false);
  const [mobileStableTicks, setMobileStableTicks] = useState(0);
  const [mobileExamReadyForCapture, setMobileExamReadyForCapture] = useState(false);
  const [cameraPortalReady, setCameraPortalReady] = useState(false);

  const mobileStripAlignedRef = useRef(false);
  const mobileCaptureGateRef = useRef<{
    fiducialCount: number;
    fiducialCorners: [boolean, boolean, boolean, boolean];
    stripAligned: boolean;
    quad: RoiQuad | null;
    roiW: number;
    roiH: number;
    fillRatio: number;
    roiCanvas: HTMLCanvasElement | null;
  }>({
    fiducialCount: 0,
    fiducialCorners: [false, false, false, false],
    stripAligned: false,
    quad: null,
    roiW: 0,
    roiH: 0,
    fillRatio: 0,
    roiCanvas: null,
  });
  useEffect(() => {
    mobileStripAlignedRef.current = mobileStripAligned;
  }, [mobileStripAligned]);

  const mobileAlignedForCapture = mobileExamReadyForCapture;

  const videoRef = useRef<HTMLVideoElement>(null);
  const liveVideoLayoutRef = useRef<LiveVideoLetterbox | null>(null);
  const autoShutterEnabledRef = useRef(true);
  const flashModeRef = useRef<FlashMode>('auto');
  const mobileVideoViewportRef = useRef<HTMLDivElement>(null);
  const mobileCameraShellRef = useRef<HTMLDivElement>(null);
  const scannerActionsRef = useRef<ScannerActions>({
    capture: () => {},
    flash: () => {},
    changeExam: () => {},
    gallery: () => {},
    close: () => {},
  });
  const streamRef = useRef<MediaStream | null>(null);
  const liveTickRef = useRef<number | null>(null);
  const liveBusyRef = useRef(false);
  const liveDraftDisplaySigRef = useRef('');
  const liveResolvedDisplayedRef = useRef(-1);
  const stablePartialTicksRef = useRef(0);
  const stableFullTicksRef = useRef(0);
  const lowVisibilityTicksRef = useRef(0);
  const autotorchTriedRef = useRef(false);
  const shadowTorchTicksRef = useRef(0);
  const glareHintShownRef = useRef(false);
  const autoFinalizeInProgressRef = useRef(false);
  /** Respuestas ya capturadas en vivo por id de pregunta; no se sobrescriben hasta «Escanear otra vez». */
  const liveLockedAnswersRef = useRef<Record<string, string>>({});
  /** Racha de lecturas idénticas por pregunta antes de bloquear respuesta. */
  const liveReadingStreakRef = useRef<Record<string, { value: string; streak: number }>>({});
  /** Ticks consecutivos con hoja detectada en vivo. */
  const strictValidationTicksRef = useRef(0);
  const cornerStableTicksRef = useRef(0);
  const fiducialStableTicksRef = useRef(0);
  /** Último cuadrilátero detectado en el ROI (coordenadas del canvas ROI). */
  const lastRoiQuadRef = useRef<RoiQuad | null>(null);
  const lastRawRoiQuadRef = useRef<RoiQuad | null>(null);
  const smoothedRoiQuadRef = useRef<RoiQuad | null>(null);
  /** Metadatos del último ROI válido (para warp en alta resolución). */
  const lastRoiCaptureMetaRef = useRef<MobileGuideRoiCapture | null>(null);
  /** Polígono en pantalla retenido brevemente si la detección falla un frame. */
  const documentPolygonHoldRef = useRef<{
    polygon: Array<{ x: number; y: number }>;
    until: number;
  } | null>(null);
  /** Último sondeo de calidad OMR del loop en vivo (líneas/columnas detectadas). */
  const lastQualityProbeRef = useRef<CalifacilSheetQualityProbe | null>(null);
  /** Evita repetir el sonido de «hoja completa» en cada fotograma. */
  const liveCompleteSoundPlayedRef = useRef(false);
  const scanBusyRef = useRef(false);
  const startingCameraRef = useRef(false);
  /** Permite abrir la cámara en el mismo clic que pone `phase` en `capturar` (evita doble toque). */
  const startLiveCameraRef = useRef<
    ((opts?: { skipPhaseGuard?: boolean }) => Promise<boolean>) | undefined
  >(undefined);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  /** Cancela lecturas desktop JPG/PDF tardías (timeout / nueva subida). */
  const gradeReadAbortRef = useRef<AbortController | null>(null);
  const gradeReadGenRef = useRef(0);
  const pendingPdfGradingRef = useRef<{
    handle: PdfGradingHandle;
    nextPage: number;
    lastPage: number;
  } | null>(null);
  const prefetchedPdfCanvasRef = useRef<{ page: number; canvas: HTMLCanvasElement } | null>(null);
  const prefetchPdfPageTaskRef = useRef(0);
  const confirmedAnswersRef = useRef<Record<string, string>>({});
  const sheetIndexRef = useRef(0);
  const prevPhaseRef = useRef<Phase>('elegir');

  const [reviewQualityHint, setReviewQualityHint] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(55);
  const [autoSnapshotUrl, setAutoSnapshotUrl] = useState<string | null>(null);
  const [showAutoSnapshot, setShowAutoSnapshot] = useState(false);

  const [autoGradeDialogOpen, setAutoGradeDialogOpen] = useState(false);
  const [autoGradePersisted, setAutoGradePersisted] = useState(false);
  const [virtualKeyTableDialogOpen, setVirtualKeyTableDialogOpen] = useState(false);
  const [autoGradeStats, setAutoGradeStats] = useState<{
    pct: number;
    correct: number;
    wrong: number;
    total: number;
  } | null>(null);

  const [mobileSheetSnapshots, setMobileSheetSnapshots] = useState<MobileSheetSnapshot[]>([]);
  const [zipGradeModalOpen, setZipGradeModalOpen] = useState(false);
  const [zipGradeReviewOpen, setZipGradeReviewOpen] = useState(false);
  const [zipGradeStudentPickerOpen, setZipGradeStudentPickerOpen] = useState(false);
  const [mobileResultsDraft, setMobileResultsDraft] = useState<Record<string, string>>({});
  const [resultsSheetIdx, setResultsSheetIdx] = useState(0);
  const [mobileCaptureReview, setMobileCaptureReview] = useState<MobileCaptureReviewState | null>(
    null
  );
  const [mobileReviewAlign, setMobileReviewAlign] = useState<MobileReviewAlignPreview | null>(
    null
  );
  const [reviewScanning, setReviewScanning] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const mobileCaptureBusyRef = useRef(false);
  const autoCaptureTriggeredRef = useRef(false);
  const mobileReviewOpenRef = useRef(false);
  const reviewScanGenRef = useRef(0);
  const autoFinalizeTokenRef = useRef(0);
  const finalizeMobileReviewGradeRef = useRef<() => Promise<void>>(async () => {});
  const triggerMobileSheetCaptureRef = useRef<
    (
      video: HTMLVideoElement,
      opts?: {
        roiQuad?: RoiQuad | null;
        roiCapture?: MobileGuideRoiCapture | null;
      }
    ) => void
  >(() => {});
  const phaseRef = useRef<Phase>('elegir');
  const presentInstantCaptureGradeRef = useRef<
    (draft: Record<string, string>, studentIdOverride?: string) => Promise<void>
  >(
    async () => {}
  );
  const previewMobileCaptureAlignmentRef = useRef<
    (warped: HTMLCanvasElement, alignment: WarpAlignmentReport | null) => Promise<void>
  >(async () => {});
  const finalizeCapturedSheetRef = useRef<
    (
      source: HTMLImageElement | HTMLCanvasElement,
      fallbackFile?: File,
      opts?: {
        skipReviewUi?: boolean;
        preWarped?: boolean;
        warpAlignment?: WarpAlignmentReport | null;
        skipSheetValidation?: boolean;
        precomputedDraft?: Record<string, string>;
        precomputedPicks?: (number | null)[];
        precomputedGeometry?: CalifacilOmrScanGeometry | null;
        precomputedControlNumber?: string | null;
        displaySource?: HTMLCanvasElement;
      }
    ) => Promise<{ success: boolean; chunkDraft?: Record<string, string> }>
  >(async () => ({ success: false }));

  const publishedExams = useMemo(
    () => (exams as Exam[]).filter((e) => e.status === 'published'),
    [exams]
  );

  const questions = useMemo(() => exam?.questions ?? [], [exam]);
  const omrQuestions = useMemo(() => getCalifacilOmrSheetQuestions(questions), [questions]);
  const omrCols = califacilOmrColumnCount(questions);
  const supportsCalifacil = exam ? examSupportsCalifacilOmr(questions) : false;
  const virtualKey = useMemo(() => buildCalifacilVirtualKey(questions), [questions]);
  const virtualKeyMaps = useMemo(() => buildVirtualKeyMaps(virtualKey.rows), [virtualKey.rows]);
  const examVirtualKeyByQuestionId = virtualKeyMaps.byQuestionId;
  const virtualKeyCorrectIndexByQuestionId = virtualKeyMaps.indexByQuestionId;
  /** Hojas MC (chunk de preguntas reales); la rejilla OMR impresa/escaneada es siempre 30. */
  const sheets = useMemo(
    () =>
      omrQuestions.length > 0
        ? chunkQuestions(omrQuestions, CALIFACIL_PRINT_MAX_QUESTIONS)
        : [],
    [omrQuestions]
  );
  const totalSheets = sheets.length;
  const currentChunk = useMemo(() => sheets[sheetIndex] ?? [], [sheets, sheetIndex]);
  /** Filas de la plantilla OMR (fija 30). Las preguntas reales son currentChunk.length. */
  const omrRowCount = CALIFACIL_PRINT_MAX_QUESTIONS;
  const chunkQuestionOffset = useMemo(() => {
    let offset = 0;
    for (let i = 0; i < sheetIndex; i++) offset += sheets[i]?.length ?? 0;
    return offset;
  }, [sheets, sheetIndex]);
  const expectedChunkPicks = useMemo(
    () => expectedPicksForChunk(currentChunk, virtualKeyCorrectIndexByQuestionId),
    [currentChunk, virtualKeyCorrectIndexByQuestionId]
  );
  const expectedChunkPicksRef = useRef(expectedChunkPicks);
  useEffect(() => {
    expectedChunkPicksRef.current = expectedChunkPicks;
  }, [expectedChunkPicks]);
  const mobileAlignPreviewProp = useMemo(() => {
    if (!mobileReviewAlign) return null;
    const stats = gradeMcDraftAgainstVirtualKey(
      mobileReviewAlign.draft,
      currentChunk,
      virtualKeyMaps
    );
    return {
      geometry: mobileReviewAlign.geometry,
      picks: mobileReviewAlign.picks,
      expectedPicks: expectedChunkPicks,
      previewCanvas: mobileReviewAlign.warped,
      previewUrl: mobileReviewAlign.previewUrl,
      orangeFrameNorm: mobileReviewAlign.orangeFrameNorm,
      score: { correct: stats.correct, total: stats.total, pct: stats.pct },
    };
  }, [mobileReviewAlign, expectedChunkPicks, currentChunk, virtualKeyMaps]);
  const lockStaticScannerGuide = useCallback(() => {
    setStaticScannerGuideRect((prev) => {
      if (prev) return prev;
      const container = mobileVideoViewportRef.current;
      const measured = container?.getBoundingClientRect();
      const w =
        measured && measured.width >= 40 ? measured.width : readScannerViewportPx().w;
      const h =
        measured && measured.height >= 40 ? measured.height : readScannerViewportPx().h;
      return createStaticScannerGuide(w, h);
    });
  }, []);

  useLayoutEffect(() => {
    if (!isMobile || phase !== 'capturar') return;
    lockStaticScannerGuide();
  }, [isMobile, phase, cameraOpen, cameraPortalReady, lockStaticScannerGuide]);

  /** Comparación borrador vs clave automática (vacío = incorrecto). */
  const chunkKeyComparison = useMemo(() => {
    const draft = buildMcDraftFromChunk(currentChunk, draftSelections);
    return gradeMcDraftAgainstVirtualKey(draft, currentChunk, virtualKeyMaps);
  }, [currentChunk, draftSelections, virtualKeyMaps]);

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [students]
  );
  const studentAutoDetect = isCalificarAutoStudentMode(selectedStudentId);

  const applyControlNumberFromRead = useCallback(
    (
      controlRead: { controlNumber: string | null },
      opts?: { silent?: boolean }
    ): string | null => {
      if (controlRead.controlNumber) {
        setDetectedControlNumber(controlRead.controlNumber);
        const matched = findStudentByControlNumber(sortedStudents, controlRead.controlNumber);
        if (matched) {
          setSelectedStudentId(matched.id);
          if (!opts?.silent) {
            toast.success(`Alumno identificado (${controlRead.controlNumber}): ${matched.name}`);
          }
          return matched.id;
        }
        if (!opts?.silent) {
          toast.error(
            `El control ${controlRead.controlNumber} no coincide con ningún alumno del examen. Elige al alumno manualmente.`
          );
        }
        return null;
      }
      setDetectedControlNumber(null);
      return null;
    },
    [sortedStudents]
  );

  const runFastWarpedScan = useCallback(
    async (warped: HTMLCanvasElement, warpAlignment?: WarpAlignmentReport | null) => {
      // displayCanvas = carta (UI); scanCanvas = referencia (lectura OMR).
      const { displayCanvas, scanCanvas } = prepareCalifacilGradeScanCanvases(
        warped,
        omrCols,
        omrRowCount,
        { preWarped: true, warpAlignment }
      );
      const acceptable =
        isMobileLetterGradeCanvasReady(displayCanvas) ||
        isMobileWarpedAnswerSheetAcceptable(warped) ||
        isMobileWarpedAnswerSheetAcceptable(displayCanvas);
      if (!acceptable) {
        const corners = Math.max(
          countCalifacilCornerMarkers(displayCanvas),
          countCalifacilCornerMarkers(warped)
        );
        const strips =
          hasCalifacilAlignStrips(displayCanvas) || hasCalifacilAlignStrips(warped);
        const letterOk =
          isCalifacilWarpedLetterCanvas(displayCanvas) ||
          isCalifacilWarpedLetterCanvas(warped);
        // Evita toast falso si hay franjas + ≥3 esquinas útiles (casi Acceptable).
        const softOk = letterOk && strips && corners >= 3;
        if (!softOk) {
          return {
            meta: null as OmrScanMetaResult | null,
            orangeFrameNorm: null as OmrNormRect | null,
            docCanvas: scanCanvas,
            displayCanvas,
            rejectedCorners: true as const,
          };
        }
      }
      const activeRows =
        sheets[sheetIndexRef.current]?.length ?? omrRowCount;
      const meta = await scanWarpedGradeMobileAsync(scanCanvas, omrCols, omrRowCount, {
        activeRows,
      });
      // Marco naranja en coords carta (preview), no en canvas de referencia.
      const orangeFrameNorm = califacilOmrTableFrameNormRect(omrRowCount);
      return {
        meta,
        orangeFrameNorm,
        docCanvas: scanCanvas,
        displayCanvas,
        rejectedCorners: false as const,
      };
    },
    [omrCols, omrRowCount, sheets]
  );

  const mobileScanPreviewSetters = useMemo(
    () => ({
      setPreviewUrl: setMobileScanPreviewUrl,
      setPreviewGeometry: setMobileScanPreviewGeometry,
      setPreviewPicks: setMobileScanPreviewPicks,
      setPreviewOrangeFrame: setMobileScanPreviewOrangeFrame,
    }),
    []
  );

  const clearMobileScanPreviewState = useCallback(
    (video: HTMLVideoElement | null) => {
      clearMobileScanPreview(video, mobileScanPreviewSetters);
    },
    [mobileScanPreviewSetters]
  );

  useEffect(() => {
    confirmedAnswersRef.current = confirmedByQuestionId;
  }, [confirmedByQuestionId]);

  useEffect(() => {
    sheetIndexRef.current = sheetIndex;
  }, [sheetIndex]);

  const selectedStudentName = studentAutoDetect
    ? ''
    : (sortedStudents.find((s) => s.id === selectedStudentId)?.name ?? '');

  const zipGradeSheets = useMemo((): ZipGradeSheetData[] => {
    return mobileSheetSnapshots.map((snap) => {
      const chunk = sheets[snap.sheetIndex] ?? [];
      const expectedPicksRaw = expectedPicksForChunk(chunk, virtualKeyCorrectIndexByQuestionId);
      const picksRaw =
        snap.columnPicks.length > 0
          ? snap.columnPicks
          : draftSelectionsToColumnPicks(chunk, snap.selectionsByQuestionId);
      const chunkStats = gradeOmrChunkPicksAgainstVirtualKey(chunk, picksRaw, virtualKeyMaps);
      // Overlay visual: plantilla 30 filas; scoring usa solo el chunk activo.
      const padToOmr = (arr: (number | null)[]) => {
        const out = arr.slice(0, omrRowCount);
        while (out.length < omrRowCount) out.push(null);
        return out;
      };
      return {
        previewUrl: snap.previewUrl,
        nameCropUrl: snap.nameCropUrl,
        geometry: snap.geometry,
        picks: padToOmr(picksRaw),
        expectedPicks: padToOmr(expectedPicksRaw),
        rowCount: omrRowCount,
        correct: chunkStats.correct,
        total: chunkStats.total > 0 ? chunkStats.total : chunk.length,
        pct: chunkStats.pct,
      };
    });
  }, [
    mobileSheetSnapshots,
    sheets,
    virtualKeyMaps,
    virtualKeyCorrectIndexByQuestionId,
    mobileResultsDraft,
    omrRowCount,
  ]);

  const currentZipGradeSheet = zipGradeSheets[resultsSheetIdx] ?? null;

  const virtualKeyMcTotal = questions.filter((q) => q.type === 'multiple_choice').length;
  const virtualKeyReadyCount = Object.keys(examVirtualKeyByQuestionId).length;
  const virtualKeyComplete =
    supportsCalifacil &&
    virtualKey.issues.length === 0 &&
    virtualKeyMcTotal > 0 &&
    virtualKeyReadyCount === virtualKeyMcTotal;
  const canGradeStudents = virtualKeyComplete;

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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await video.play();
        if (!video.paused) break;
      } catch {
        await sleep(120);
      }
    }
  }, []);

  const updateLiveVideoLayout = useCallback(() => {
    const container = mobileVideoViewportRef.current;
    const video = videoRef.current;
    if (!container || !video || video.videoWidth < 40 || video.videoHeight < 40) return;
    const { width: cw, height: ch } = container.getBoundingClientRect();
    if (cw < 20 || ch < 20) return;
    lockStaticScannerGuide();
    setLiveVideoLayout(
      getObjectCoverVideoLetterbox(video.videoWidth, video.videoHeight, cw, ch)
    );
  }, [lockStaticScannerGuide]);

  const bindVideoElement = useCallback(
    (node: HTMLVideoElement | null) => {
      const stream = streamRef.current;
      if (!node || !stream) return;
      if (node.srcObject !== stream) {
        node.srcObject = stream;
      }
      node.muted = true;
      node.playsInline = true;
      node.setAttribute('playsinline', 'true');
      node.setAttribute('webkit-playsinline', 'true');
      void node.play().catch(() => {});
      window.requestAnimationFrame(() => updateLiveVideoLayout());
    },
    [updateLiveVideoLayout]
  );

  const setTorchEnabled = useCallback(
    async (enabled: boolean) => {
      const ok = await setCameraTorch({
        streamRef,
        videoEl: videoRef.current,
        enabled,
      });
      if (ok) {
        setFlashOn(enabled);
        setFlashSupported(true);
        await attachStreamToVideo();
        updateLiveVideoLayout();
      }
      return ok;
    },
    [attachStreamToVideo, updateLiveVideoLayout]
  );

  useEffect(() => {
    liveVideoLayoutRef.current = liveVideoLayout;
  }, [liveVideoLayout]);

  useEffect(() => {
    autoShutterEnabledRef.current = autoShutterEnabled;
  }, [autoShutterEnabled]);

  useEffect(() => {
    flashModeRef.current = flashMode;
  }, [flashMode]);

  const applyFlashMode = useCallback(
    async (mode: FlashMode): Promise<boolean> => {
      if (mode === 'on') {
        autotorchTriedRef.current = true;
        return setTorchEnabled(true);
      }
      if (mode === 'off') {
        autotorchTriedRef.current = true;
        return setTorchEnabled(false);
      }
      autotorchTriedRef.current = false;
      shadowTorchTicksRef.current = 0;
      lowVisibilityTicksRef.current = 0;
      return setTorchEnabled(false);
    },
    [setTorchEnabled]
  );

  const cycleFlashMode = useCallback(async () => {
    const order: FlashMode[] = ['auto', 'on', 'off'];
    const idx = order.indexOf(flashModeRef.current);
    const next = order[(idx + 1) % order.length]!;
    setFlashMode(next);
    flashModeRef.current = next;
    if (next === 'on') {
      const ok = await applyFlashMode(next);
      if (!ok) {
        toast.error('No se pudo activar el flash en este dispositivo.');
      }
    } else {
      await applyFlashMode(next);
    }
  }, [applyFlashMode]);

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
    lowVisibilityTicksRef.current = 0;
    autotorchTriedRef.current = false;
    shadowTorchTicksRef.current = 0;
    glareHintShownRef.current = false;
    autoFinalizeInProgressRef.current = false;
    liveLockedAnswersRef.current = {};
    liveReadingStreakRef.current = {};
    strictValidationTicksRef.current = 0;
    cornerStableTicksRef.current = 0;
    fiducialStableTicksRef.current = 0;
    lastRoiQuadRef.current = null;
    lastRawRoiQuadRef.current = null;
    smoothedRoiQuadRef.current = null;
    lastRoiCaptureMetaRef.current = null;
    documentPolygonHoldRef.current = null;
    lastQualityProbeRef.current = null;
    liveDraftDisplaySigRef.current = '';
    liveResolvedDisplayedRef.current = -1;
    liveCompleteSoundPlayedRef.current = false;
    stopScanningHum();
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveScanGeometry(null);
    setLiveScanPicks([]);
    setLiveScanLockedRows([]);
    setLiveScanAmbiguousRows([]);
    setLiveVideoLayout(null);
    setLiveShowBubbleOverlay(false);
    setCornersAlignedView(false);
    setMobileSheetFillRatio(0);
    setMobileFiducialCount(0);
    setMobileFiducialCorners([false, false, false, false]);
    setMobileStripAligned(false);
    setMobileShadowWarning(false);
    setMobileStableTicks(0);
    setMobileDocumentPolygon(null);
    setLiveFilterMenuOpen(false);
    setLiveStatus(
      isMobile
        ? 'Coloca la hoja dentro del marco naranja de la cámara. La captura es automática.'
        : 'Elige una imagen: puede ser la hoja completa o solo el recuadro CaliFacil; se leerá la tabla y se comparará con la clave del examen.'
    );
    clearAutoSnapshot();
  }, [clearAutoSnapshot, isMobile]);

  const stopLiveCamera = useCallback(() => {
    stopScanningHum();
    if (liveTickRef.current !== null) {
      window.clearTimeout(liveTickRef.current);
      liveTickRef.current = null;
    }
    void exitExamFullscreenSafe();
    setCameraFullscreenMode('none');
    void setTorchEnabled(false);
    mobileReviewOpenRef.current = false;
    setMobileCaptureReview(null);
    setMobileReviewAlign(null);
    setReviewScanning(false);
    setReviewStatus(null);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    stablePartialTicksRef.current = 0;
    stableFullTicksRef.current = 0;
    lowVisibilityTicksRef.current = 0;
    autotorchTriedRef.current = false;
    shadowTorchTicksRef.current = 0;
    glareHintShownRef.current = false;
    autoFinalizeInProgressRef.current = false;
    setFlashSupported(false);
    setFlashOn(false);
    setFlashMode('auto');
    flashModeRef.current = 'auto';
    setMobileDocumentPolygon(null);
    setStaticScannerGuideRect(null);
    autoCaptureTriggeredRef.current = false;
    setLiveFilterMenuOpen(false);
    setCameraOpen(false);
    setMobileScanPreviewUrl(null);
    setMobileScanPreviewGeometry(null);
    setMobileScanPreviewPicks([]);
    setMobileScanPreviewOrangeFrame(null);
    setCameraPermissionPhase('granted');
    clearAutoSnapshot();
  }, [clearAutoSnapshot, setTorchEnabled]);

  const mapRawToDraft = useCallback((raw: (number | null)[], chunk: Question[]) => {
    const mapped = mapOmrPicksToMcDraftDetailed(chunk, raw);
    return {
      draft: mapped.draft,
      unresolvedCount: mapped.unresolvedCount,
      resolvedCount: mapped.resolvedCount,
    };
  }, []);

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
      opts?: {
        skipReviewUi?: boolean;
        preWarped?: boolean;
        warpAlignment?: WarpAlignmentReport | null;
        skipSheetValidation?: boolean;
        displaySource?: HTMLCanvasElement;
        readingOverride?: CalifacilOmrReadingResult;
      }
    ): Promise<{ success: boolean; chunkDraft?: Record<string, string> }> => {
      if (!examId || !exam || !supportsCalifacil) {
        toast.error('Selecciona un examen válido antes de escanear.');
        return { success: false };
      }
      const skipReviewUi = opts?.skipReviewUi;
      const preWarped = Boolean(opts?.preWarped);
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) {
        toast.error('No hay preguntas para escanear en esta hoja.');
        return { success: false };
      }

      const isServerRenderedPdfPage =
        fallbackFile != null &&
        source instanceof HTMLCanvasElement &&
        /^pdf-pagina-\d+\.jpg$/i.test(fallbackFile.name);

      let gradeSource: HTMLImageElement | HTMLCanvasElement = source;
      let gradePreWarped = preWarped;
      let gradeWarpAlignment = opts?.warpAlignment ?? null;
      let gradeReadingOverride = opts?.readingOverride;
      let gradeSkipSheetValidation = opts?.skipSheetValidation;
      let gradeDisplaySource: HTMLCanvasElement | null =
        opts?.displaySource instanceof HTMLCanvasElement ? opts.displaySource : null;

      /** PDF rasterizado: plano. Foto de cámara: auto-orientar y/o warp previo. */
      const isMobileCamera = useLiveCameraUi && !fallbackFile;
      const isDesktopFileUpload = !isMobile && Boolean(fallbackFile);

      let classifiedUploadKind: DesktopUploadKind | undefined;

      // PDF renderizado en servidor: ya viene plano y normalizado; no re-clasificar ni pedir visión.
      if (isServerRenderedPdfPage) {
        classifiedUploadKind = 'pdf';
        gradeSkipSheetValidation = true;
      } else if (
        !gradeReadingOverride &&
        (isDesktopFileUpload || (isMobile && Boolean(fallbackFile)))
      ) {
        const rawCanvas =
          source instanceof HTMLCanvasElement
            ? source
            : prepareCalifacilScanInput(source, { useGuideCrop: false });
        if (rawCanvas) {
          await yieldForSpinnerPaint();
          const uploadClass = classifyDesktopUploadCanvas(rawCanvas, omrCols, {
            isServerRenderedPdfPage: false,
          });
          const flatDocument =
            uploadClass === 'pdf' || uploadClass === 'flatScan';
          const normalized = normalizeCalifacilGradeDocumentCanvas(rawCanvas, omrCols, {
            maxSide: PDF_OMR_RENDER_MAX_SIDE,
            flatDocument,
            uploadClass,
            rowCount: omrRowCount,
          });
          await yieldForSpinnerPaint();
          // Foto sin hoja sola: no calificar con mesa/fondo.
          if (!flatDocument && !normalized.sheetDetected) {
            toast.error(
              'No se detectó la hoja. Encuadra franjas laterales y esquinas negras, con buena luz.'
            );
            setLiveStatus('No se detectó la hoja completa. Sube otra foto más centrada.');
            return { success: false };
          }
          if (!normalized.canvas) {
            toast.error('No se pudo preparar la hoja para calificar.');
            return { success: false };
          }
          gradeSource = normalized.canvas;
          // Tras warp exitoso, tratar como hoja enderezada (preview/OMR sobre carta).
          gradePreWarped =
            uploadClass === 'warpedPhoto' ||
            normalized.normalized ||
            (uploadClass === 'photoCrop' && normalized.sheetDetected);
          if (normalized.alignment) gradeWarpAlignment = normalized.alignment;
          if (normalized.normalized || gradePreWarped) gradeSkipSheetValidation = true;
          classifiedUploadKind =
            uploadClass === 'flatScan'
              ? 'flatDocument'
              : gradePreWarped && uploadClass === 'photoCrop'
                ? 'warpedPhoto'
                : uploadClass;
          // Preview: hoja sola (carta), no el canvas de referencia ni el JPG crudo.
          if (!gradeDisplaySource && normalized.displayCanvas instanceof HTMLCanvasElement) {
            gradeDisplaySource = normalized.displayCanvas;
          }
        }
      }

      let desktopUploadKind: DesktopUploadKind | undefined;
      if (classifiedUploadKind) {
        desktopUploadKind = classifiedUploadKind;
      } else if (isServerRenderedPdfPage) {
        desktopUploadKind = 'pdf';
      } else if (!isMobile && gradePreWarped) {
        desktopUploadKind = 'warpedPhoto';
      }
      const preserveCapturedFrame = isMobileCamera
        ? false
        : isMobile || isDesktopFileUpload || gradePreWarped;
      const oriented =
        gradePreWarped
          ? gradeSource
          : isMobileCamera
            ? (autoOrientCalifacilSheet(gradeSource, omrCols, {
                useGuideCrop: false,
                allowTiltSweep: true,
              }) ?? gradeSource)
            : isDesktopFileUpload
              ? gradeSource
              : preserveCapturedFrame
                ? gradeSource
                : (autoOrientCalifacilSheet(gradeSource, omrCols, {
                    useGuideCrop: false,
                    allowTiltSweep: true,
                  }) ?? gradeSource);
      const examCanvas =
        oriented instanceof HTMLCanvasElement
          ? oriented
          : prepareCalifacilScanInput(oriented, { useGuideCrop: false });
      const sheetLikely = examCanvas
        ? gradeSkipSheetValidation || Boolean(gradeReadingOverride?.meta?.geometry)
          ? true
          : isMobileCamera && gradePreWarped
            ? isCalifacilAnswerSheetReadyForGrading(
                examCanvas,
                omrCols,
                omrRowCount,
                opts?.warpAlignment
              )
            : isCalifacilExamSheetLikely(examCanvas, omrCols)
        : false;
      const sheetStrict = examCanvas ? isCalifacilExamSheetStrict(examCanvas, omrCols) : false;
      if (!examCanvas || !sheetLikely) {
        const mobileDiag =
          isMobileCamera && gradePreWarped && examCanvas
            ? diagnoseCalifacilAnswerSheetReadiness(
                examCanvas,
                omrCols,
                omrRowCount,
                opts?.warpAlignment
              ).issues
            : [];
        const detail =
          mobileDiag.length > 0
            ? mobileDiag.slice(0, 2).join('; ')
            : 'Encuadra la hoja impresa con las esquinas y franjas negras.';
        setLiveStatus(
          isMobile
            ? `No se detectó una hoja CaliFacil válida. ${detail}`
            : 'No se detecta la tabla CaliFacil. Prueba una foto más nítida de la hoja completa o del pie con la tabla N.º / A–D.'
        );
        toast.error(
          isMobileCamera
            ? `No es una hoja CaliFacil válida. ${detail}`
            : isMobile
              ? 'No se reconoce el examen CaliFacil. Incluye la hoja impresa completa y que se vea el pie con las casillas A–D.'
              : 'No se reconoce el examen CaliFacil. Incluye bien la tabla del pie (página completa o solo el recuadro), buena luz y sin cortes.'
        );
        return { success: false };
      }

      const reading =
        gradeReadingOverride ??
        (await runCalifacilOmrReadingPipeline({
          source: gradeSource,
          oriented: examCanvas,
          chunk,
          examId,
          omrCols,
          omrRowCount,
          chunkQuestionOffset,
          preWarped: gradePreWarped,
          isMobileCamera,
          isMobile,
          fallbackFile,
          uploadKind: desktopUploadKind,
          disableVisionAssist:
            Boolean(skipReviewUi) ||
            Boolean(gradeReadingOverride) ||
            (desktopUploadKind
              ? desktopUploadKind === 'pdf' ||
                desktopUploadKind === 'flatDocument' ||
                desktopUploadKind === 'flatScan' ||
                desktopUploadKind === 'warpedPhoto' ||
                desktopUploadKind === 'photoCrop'
              : Boolean(isMobileCamera)),
          skipReviewUi,
          sheetStrict,
          preserveCapturedFrame,
          includeWarpAlignment: OMR_DEBUG_ENABLED || Boolean(gradeWarpAlignment),
          warpAlignment: gradeWarpAlignment,
          liveLockedAnswers: liveLockedAnswersRef.current,
        }));

      if (isMobileCamera && skipReviewUi && !reading.meta.geometry) {
        const hasPicks = reading.meta.picks.some((p) => p != null);
        if (!hasPicks) {
          toast.error('No se pudo leer la hoja. Encuadra de nuevo e intenta otra vez.');
          setLiveStatus('No se leyó la tabla. Vuelve a capturar.');
          return { success: false };
        }
        // Sin geometría del motor: se usará plantilla impresa (printExam) para el overlay.
        toast.message('Lectura parcial: se muestra el resultado con la plantilla de la hoja.');
      }

      const {
        meta,
        raw,
        mapped,
        mergedDraft,
        mergedResolved,
        picksInChunk,
        activeScanSource,
        warpAlignment,
        mostlyBlank,
        minResolved,
        ambiguousIdx,
        insufficientForReview,
        updatedLiveLocks,
      } = reading;

      if (
        isMobileCamera &&
        gradePreWarped &&
        warpAlignment &&
        !warpAlignment.ok
      ) {
        toast.message(
          `Alineación aproximada (${warpAlignment.maxErrorPx.toFixed(0)} px). Calificando con plantilla.`
        );
      }

      if (mostlyBlank && (!skipReviewUi || isMobileCamera)) {
        toast.message('Hoja sin respuestas marcadas — calificación 0%.');
      }

      if (
        isMobileCamera &&
        ambiguousIdx.length > Math.ceil(chunk.length * AMBIGUOUS_ROW_WARN_RATIO)
      ) {
        toast.message(
          'Algunas respuestas fueron ambiguas; las casillas sin lectura clara se tomarán como incorrectas.'
        );
      }

      if (insufficientForReview) {
        // Hoja en blanco (0 lecturas): no abortar; mostrar revisión 0% con burbujas de la clave.
        if (mergedResolved === 0 || mostlyBlank) {
          toast.message('Hoja sin respuestas marcadas — calificación 0%.');
        } else {
          setDraftSelections({});
          setLiveDraftSelections(mergedDraft);
          setLiveResolvedCount(mergedResolved);
          setLiveStatus(
            isMobile
              ? 'Lectura insuficiente: alinea las esquinas negras, mejora la luz y evita sombras.'
              : 'Lectura insuficiente: prueba una foto más nítida de la página completa o del pie CaliFacil, bien iluminada.'
          );
          if (!skipReviewUi) {
            toast.error(
              isMobile
                ? `Lectura insuficiente (${mergedResolved}/${chunk.length}). Vuelve a capturar con mejor encuadre.`
                : 'La imagen no permite leer bien la tabla. Incluye la hoja completa o el recuadro del pie, con buena luz.'
            );
            return { success: false };
          }
          // skipReviewUi: no abrir revisión; en móvil cámara se califica con parciales = incorrectas.
          if (isMobileCamera) {
            toast.message(
              `Lectura parcial (${mergedResolved}/${chunk.length}). Las casillas vacías se calificarán como incorrectas.`
            );
          } else {
            toast.message(
              `Lectura parcial (${mergedResolved}/${chunk.length}). Revisa las respuestas en el overlay antes de guardar.`
            );
          }
        }
      } else if (!isMobileCamera && mergedResolved < minResolved) {
        toast.message(
          `Lectura parcial (${mergedResolved}/${chunk.length}). Revisa las respuestas en el overlay antes de guardar.`
        );
      } else if (isMobileCamera && mergedResolved < minResolved) {
        toast.message(
          `Lectura parcial (${mergedResolved}/${chunk.length}). Las casillas vacías se calificarán como incorrectas.`
        );
      } else if (isMobileCamera && !sheetStrict && !skipReviewUi) {
        toast.message(
          'Lectura aceptable sin alineación perfecta de esquinas. Revisa las respuestas antes de guardar.'
        );
      }

      liveLockedAnswersRef.current = updatedLiveLocks;
      setDraftSelections(mapped.draft);
      setLiveDraftSelections(mapped.draft);
      setLiveResolvedCount(mapped.resolvedCount);

      let gradeStudentId = resolveCalificarStudentId(selectedStudentId, undefined, sortedStudents) ?? '';
      if (meta.controlNumber) {
        setDetectedControlNumber(meta.controlNumber);
        const matched = findStudentByControlNumber(sortedStudents, meta.controlNumber);
        if (matched) {
          gradeStudentId = matched.id;
          setSelectedStudentId(matched.id);
          if (!skipReviewUi) {
            toast.success(`Alumno identificado (${meta.controlNumber}): ${matched.name}`);
          }
        } else if (!skipReviewUi) {
          toast.error(
            `El control ${meta.controlNumber} no coincide con ningún alumno del examen. Elige al alumno manualmente.`
          );
        }
      } else {
        setDetectedControlNumber(null);
        const partialDigits = meta.controlNumberDigits.filter((d) => d !== null).length;
        if (partialDigits >= 4 && !skipReviewUi) {
          toast.message(
            'No se leyó completo el número de control. Puedes elegir al alumno manualmente.'
          );
        }
      }

      if (isMobile && skipReviewUi) {
        const fullChunkDraft = buildMcDraftFromChunk(chunk, mergedDraft);
        const reviewCanvas =
          gradeDisplaySource ??
          (opts?.displaySource instanceof HTMLCanvasElement ? opts.displaySource : null) ??
          meta.reviewSourceCanvas ??
          (activeScanSource instanceof HTMLCanvasElement ? activeScanSource : null);
        let snapUrl: string | null = null;
        let snapW = 0;
        let snapH = 0;
        let nameCropUrl: string | null = null;
        const geom = meta.geometry;
        if (reviewCanvas instanceof HTMLCanvasElement) {
          const preview = canvasPreviewJpeg(reviewCanvas, 900, 0.78);
          if (preview) {
            snapUrl = preview.dataUrl;
            snapW = preview.width;
            snapH = preview.height;
          } else {
            snapUrl = canvasPreviewDataUrl(reviewCanvas, 900, 0.65);
            snapW = reviewCanvas.width;
            snapH = reviewCanvas.height;
          }
          nameCropUrl = cropAnswerSheetNameSnippetDataUrl(reviewCanvas);
        }
        const previewW = snapW > 0 ? snapW : reviewCanvas instanceof HTMLCanvasElement ? reviewCanvas.width : 900;
        const previewH = snapH > 0 ? snapH : reviewCanvas instanceof HTMLCanvasElement ? reviewCanvas.height : 1165;
        // Overlay sobre el canvas de preview: referencia (paridad desktop) o carta.
        let geomClone: CalifacilOmrScanGeometry;
        if (reviewCanvas instanceof HTMLCanvasElement) {
          const refOverlay = isReferenceGradeCanvasAnchor(reviewCanvas.width, reviewCanvas.height)
            ? buildDesktopDisplayOverlayGeometry(reviewCanvas, omrCols, omrRowCount)
            : null;
          const letterOverlay =
            !refOverlay && isCalifacilWarpedLetterCanvas(reviewCanvas)
              ? buildLetterDisplayOverlayGeometry(reviewCanvas, omrCols, omrRowCount)
              : null;
          const overlayGeom =
            refOverlay ??
            letterOverlay ??
            (geom
              ? syncCalifacilOmrGeometryImageSize(geom, previewW, previewH)
              : buildLetterDisplayOverlayGeometry(reviewCanvas, omrCols, omrRowCount));
          geomClone = syncCalifacilOmrGeometryImageSize(overlayGeom, previewW, previewH);
        } else if (geom) {
          try {
            geomClone = structuredClone(geom);
          } catch {
            geomClone = JSON.parse(JSON.stringify(geom)) as CalifacilOmrScanGeometry;
          }
          geomClone = syncCalifacilOmrGeometryImageSize(geomClone, previewW, previewH);
        } else {
          geomClone = buildAnswerSheetOmrGeometry(omrRowCount, omrCols, previewW, previewH);
        }
        setMobileSheetSnapshots((prev) => {
          const next = [
            ...prev,
            {
              sheetIndex: sheetIndexRef.current,
              previewUrl: snapUrl ?? '',
              geometry: geomClone,
              questionIds: chunk.map((q) => q.id),
              selectionsByQuestionId: { ...fullChunkDraft },
              columnPicks: picksInChunk,
              answerSheetLayout: true,
              warpAlignment: OMR_DEBUG_ENABLED ? warpAlignment : undefined,
              nameCropUrl,
            },
          ];
          setResultsSheetIdx(next.length - 1);
          return next;
        });
        try {
          await advanceOrPresentMobileGradeRef.current(fullChunkDraft, gradeStudentId || undefined);
        } catch {
          toast.error('No se pudo mostrar el resultado. Intenta de nuevo.');
          return { success: false };
        }
        return { success: true, chunkDraft: fullChunkDraft };
      }

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

        setDraftSelections(mapped.draft);
        setReviewOmrPicks(raw.slice(0, chunk.length));
        // Preview: preferir hoja sola (displaySource / reviewSource), nunca fallback a archivo crudo si hay canvas.
        const previewCanvas =
          gradeDisplaySource ??
          (opts?.displaySource instanceof HTMLCanvasElement ? opts.displaySource : null) ??
          (meta.reviewSourceCanvas instanceof HTMLCanvasElement
            ? meta.reviewSourceCanvas
            : null) ??
          (activeScanSource instanceof HTMLCanvasElement ? activeScanSource : null);
        if (previewCanvas) {
          await setPreviewFromSource(previewCanvas, undefined);
        } else {
          await setPreviewFromSource(activeScanSource, fallbackFile);
        }
        // Desktop: overlay anclado a referencia o a carta warpeada (hoja sola).
        let reviewGeom = meta.geometry;
        if (
          previewCanvas &&
          isReferenceGradeCanvasAnchor(previewCanvas.width, previewCanvas.height)
        ) {
          const desktopOverlay = buildDesktopDisplayOverlayGeometry(
            previewCanvas,
            omrCols,
            omrRowCount
          );
          if (desktopOverlay) {
            reviewGeom = syncCalifacilOmrGeometryImageSize(
              desktopOverlay,
              previewCanvas.width,
              previewCanvas.height
            );
          }
        } else if (previewCanvas && isCalifacilWarpedLetterCanvas(previewCanvas)) {
          reviewGeom = syncCalifacilOmrGeometryImageSize(
            buildLetterDisplayOverlayGeometry(previewCanvas, omrCols, omrRowCount),
            previewCanvas.width,
            previewCanvas.height
          );
        } else if (reviewGeom && previewCanvas) {
          reviewGeom = syncCalifacilOmrGeometryImageSize(
            reviewGeom,
            previewCanvas.width,
            previewCanvas.height
          );
        }
        setReviewOmrGeometry(reviewGeom);
        setPhase('revisar_hoja');
        const picksKey = raw
          .slice(0, chunk.length)
          .map((p) => (p === null ? '?' : 'ABCD'[p]!))
          .join('');
        setLiveStatus(
          mostlyBlank
            ? 'Hoja sin respuestas marcadas (0%). Confirma para guardar.'
            : mapped.unresolvedCount > 0
              ? `Lectura parcial (${mergedResolved}/${chunk.length}): ${picksKey}`
              : `Lectura lista (${mergedResolved}/${chunk.length}): ${picksKey}`
        );
        const scanNote = mostlyBlank
          ? 'Hoja en blanco detectada (0%). Revisa la vista previa y confirma.'
          : mapped.unresolvedCount > 0
            ? `Lectura parcial (${mergedResolved}/${chunk.length}). Revisa la vista previa y confirma.`
            : `Lectura realizada (${mergedResolved}/${chunk.length}). Revisa la vista previa y confirma.`;
        toast.message(scanNote);
      } else {
        setLiveStatus('Hoja guardada automáticamente.');
      }

      return { success: true, chunkDraft: mapped.draft };
    },
    [exam, examId, isMobile, useLiveCameraUi, mapRawToDraft, omrCols, omrRowCount, chunkQuestionOffset, runFastWarpedScan, selectedStudentId, setPreviewFromSource, sheets, sortedStudents, supportsCalifacil]
  );

  finalizeCapturedSheetRef.current = finalizeCapturedSheet;

  useEffect(() => {
    if (!exam?.id) {
      setAllowedGroupIds([]);
      setStudents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: assignmentData } = await supabase
        .from('exam_group_assignments')
        .select('group_id')
        .eq('exam_id', exam.id);

      const assignedGroupIds = (assignmentData || [])
        .map((row) => row.group_id as string)
        .filter(Boolean);
      const fallbackGroupId = exam.group_id ? [exam.group_id] : [];
      const examGroupIds = assignedGroupIds.length > 0 ? assignedGroupIds : fallbackGroupId;

      if (!cancelled) {
        setAllowedGroupIds(examGroupIds);
      }

      if (examGroupIds.length === 0) {
        if (!cancelled) setStudents([]);
        return;
      }

      const { data, error } = await supabase
        .from('students')
        .select('*')
        .in('group_id', examGroupIds);
      if (!cancelled && !error) setStudents(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [exam?.id, exam?.group_id]);

  useEffect(() => {
    prevPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const clearMobileSnapshots = useCallback(() => {
    setMobileSheetSnapshots((prev) => {
      for (const s of prev) URL.revokeObjectURL(s.previewUrl);
      return [];
    });
  }, []);

  useEffect(() => {
    if (phase !== 'capturar' && cameraOpen) {
      stopLiveCamera();
    }
  }, [cameraOpen, phase, stopLiveCamera]);

  useEffect(() => {
    if (!useLiveCameraUi) {
      stopLiveCamera();
      setCameraPermissionPhase('granted');
    }
  }, [useLiveCameraUi, stopLiveCamera]);

  useEffect(() => {
    setCameraPortalReady(true);
  }, []);

  useEffect(() => {
    if (!isMobile || phase !== 'capturar') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isMobile, phase]);

  useLayoutEffect(() => {
    if (!cameraOpen || mobileCaptureReview) return;
    const syncVideo = async () => {
      await attachStreamToVideo();
      updateLiveVideoLayout();
      await applyFlashMode(flashModeRef.current);
    };
    void syncVideo();
    const video = videoRef.current;
    if (!video) return;
    const onLoadedMetadata = () => {
      void syncVideo();
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [
    applyFlashMode,
    attachStreamToVideo,
    cameraOpen,
    mobileCaptureReview,
    updateLiveVideoLayout,
  ]);

  useEffect(() => {
    if (!cameraOpen) {
      setLiveVideoLayout(null);
      return;
    }
    const container = mobileVideoViewportRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => updateLiveVideoLayout());
    ro.observe(container);
    updateLiveVideoLayout();
    const video = videoRef.current;
    const onVideoLayout = () => updateLiveVideoLayout();
    video?.addEventListener('loadedmetadata', onVideoLayout);
    video?.addEventListener('resize', onVideoLayout);
    return () => {
      ro.disconnect();
      video?.removeEventListener('loadedmetadata', onVideoLayout);
      video?.removeEventListener('resize', onVideoLayout);
    };
  }, [cameraOpen, updateLiveVideoLayout]);

  useEffect(() => {
    if (!isMobile || phase !== 'capturar') return;
    let cancelled = false;
    const tryEnter = async () => {
      if (cancelled) return;
      const el = mobileCameraShellRef.current;
      if (!el) return;
      const mode = await enterExamFullscreen(el);
      if (!cancelled) setCameraFullscreenMode(mode);
    };
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => void tryEnter());
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [isMobile, phase]);

  useEffect(() => {
    scanBusyRef.current = scanBusy;
  }, [scanBusy]);

  useEffect(() => {
    return () => {
      stopLiveCamera();
    };
  }, [stopLiveCamera]);

  const clearPendingPdfGrading = useCallback(() => {
    prefetchPdfPageTaskRef.current += 1;
    pendingPdfGradingRef.current?.handle.dispose();
    pendingPdfGradingRef.current = null;
    prefetchedPdfCanvasRef.current = null;
  }, []);

  const schedulePrefetchNextPdfPage = useCallback(() => {
    const pending = pendingPdfGradingRef.current;
    if (!pending) return;
    const page = pending.nextPage;
    if (page > pending.lastPage) return;
    const task = prefetchPdfPageTaskRef.current;
    void pending.handle.renderPageAsCanvas(page).then((canvas) => {
      if (task !== prefetchPdfPageTaskRef.current) return;
      if (!canvas || pendingPdfGradingRef.current !== pending) return;
      if (pending.nextPage !== page) return;
      prefetchedPdfCanvasRef.current = { page, canvas };
    });
  }, []);

  const takeNextPdfPageCanvas = useCallback(async (): Promise<{
    canvas: HTMLCanvasElement;
    page: number;
  } | null> => {
    const pending = pendingPdfGradingRef.current;
    if (!pending) return null;
    const page = pending.nextPage;
    if (page > pending.lastPage) {
      clearPendingPdfGrading();
      return null;
    }
    prefetchPdfPageTaskRef.current += 1;
    const prefetched = prefetchedPdfCanvasRef.current;
    let canvas: HTMLCanvasElement | null = null;
    if (prefetched?.page === page) {
      canvas = prefetched.canvas;
      prefetchedPdfCanvasRef.current = null;
    } else {
      canvas = await pending.handle.renderPageAsCanvas(page);
    }
    if (!canvas) return null;
    pending.nextPage += 1;
    if (pending.nextPage > pending.lastPage) {
      pending.handle.dispose();
      pendingPdfGradingRef.current = null;
    } else {
      schedulePrefetchNextPdfPage();
    }
    return { canvas, page };
  }, [clearPendingPdfGrading, schedulePrefetchNextPdfPage]);

  const finalizePdfPageForGrading = useCallback(
    async (rawCanvas: HTMLCanvasElement, pageNumber: number) => {
      const normalized = normalizeCalifacilGradeDocumentCanvas(rawCanvas, omrCols, {
        maxSide: PDF_OMR_RENDER_MAX_SIDE,
        flatDocument: true,
        uploadClass: 'pdf',
        rowCount: omrRowCount,
      });
      if (!normalized.canvas) {
        toast.error('No se pudo preparar la página del PDF.');
        return;
      }
      const scanCanvas =
        downscaleCanvasForOmrScan(normalized.canvas, PDF_OMR_RENDER_MAX_SIDE) ??
        normalized.canvas;
      const pseudoFile = await canvasToJpegFile(scanCanvas, `pdf-pagina-${pageNumber}.jpg`);
      flushSync(() => setLiveStatus('Leyendo examen…'));
      await yieldForSpinnerPaint();
      await finalizeCapturedSheet(scanCanvas, pseudoFile);
    },
    [finalizeCapturedSheet, omrCols, omrRowCount]
  );

  const resetFlow = useCallback(() => {
    stopLiveCamera();
    clearMobileSnapshots();
    setMobileResultsDraft({});
    setResultsSheetIdx(0);
    setReviewQualityHint(null);
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus(
      isMobile
        ? 'Elige el examen y pulsa «Calificar»; detectamos al alumno en la hoja.'
        : 'Sube una imagen escaneada para leer respuestas.'
    );
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setReviewOmrGeometry(null);
    setReviewOmrPicks([]);
    setSelectedStudentId(CALIFICAR_AUTO_STUDENT_ID);
    setDetectedControlNumber(null);
    clearPendingPdfGrading();
  }, [stopLiveCamera, isMobile, clearMobileSnapshots, clearPendingPdfGrading]);

  const handleStudentChange = (studentId: string) => {
    if (!canGradeStudents) {
      toast.error('No se puede calificar: este examen no tiene clave automática válida en todos sus reactivos.');
      return;
    }
    const mode = normalizeCalificarStudentSelection(studentId);
    setSelectedStudentId(mode);
    if (isCalificarAutoStudentMode(mode)) {
      setDetectedControlNumber(null);
      if (isMobile) {
        clearMobileSnapshots();
        setMobileResultsDraft({});
        setResultsSheetIdx(0);
        setPhase('elegir');
      }
      return;
    }
    const canSessionStart =
      Boolean(examId) &&
      Boolean(exam) &&
      !examLoading &&
      supportsCalifacil &&
      questions.length > 0 &&
      virtualKey.issues.length === 0 &&
      sortedStudents.some((s) => s.id === mode);
    if (!canSessionStart) return;
    resumeScanAudioContext();
    stopLiveCamera();
    if (isMobile) {
      clearMobileSnapshots();
      setPhase('elegir');
      setSheetIndex(0);
      setConfirmedByQuestionId({});
      setDraftSelections({});
      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      setLiveStatus('Alumno fijado manualmente. Pulsa «Calificar» para escanear.');
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setReviewOmrGeometry(null);
      setReviewOmrPicks([]);
      return;
    }
    flushSync(() => {
      setPhase('capturar');
      setSheetIndex(0);
      setConfirmedByQuestionId({});
      setDraftSelections({});
      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      setLiveStatus(
        'Sube una imagen escaneada para leer respuestas.'
      );
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setReviewOmrGeometry(null);
      setReviewOmrPicks([]);
    });
  };

  const handleGalleryFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!examId || !exam || !supportsCalifacil) {
      toast.error('Selecciona primero un examen válido.');
      return;
    }
    if (phase !== 'capturar' && phase !== 'elegir') {
      toast.error('Entra al escáner o selecciona examen antes de importar.');
      return;
    }
    const nameLower = file.name.toLowerCase();
    const extOk = /\.(jpe?g|png|webp|heic|heif)$/i.test(nameLower);
    const typeOk = file.type.startsWith('image/') || (file.type === '' && extOk);
    if (!typeOk) {
      toast.error('Elige un archivo de imagen (JPG, PNG, etc.).');
      return;
    }
    if (phase === 'elegir') {
      flushSync(() => setPhase('capturar'));
    }
    clearPendingPdfGrading();
    gradeReadAbortRef.current?.abort();
    gradeReadAbortRef.current = null;
    const gen = ++gradeReadGenRef.current;
    setScanBusy(true);
    // Solo móvil marca captura viva; en desktop el watchdog debe cancelar lectura.
    if (useLiveCameraUi) {
      mobileCaptureBusyRef.current = true;
    }
    setLiveStatus('Preparando imagen…');
    await yieldForSpinnerPaint();
    try {
      const img = await fileToImage(file);
      if (gen !== gradeReadGenRef.current) return;
      if (useLiveCameraUi) {
        const fullCanvas = captureImageFullFrame(img, {
          maxSide: MOBILE_GALLERY_CAPTURE_MAX_SIDE,
        });
        if (!fullCanvas) {
          toast.error('No se pudo leer la imagen.');
          return;
        }
        // Galería: calificar la imagen directa (no exigir cámara abierta).
        await processMobileCapturedCanvas(fullCanvas, videoRef.current, { fromGallery: true });
      } else {
        setLiveStatus('Leyendo examen…');
        await yieldForSpinnerPaint();
        if (gen !== gradeReadGenRef.current) return;
        await finalizeCapturedSheet(img, file);
      }
    } catch {
      if (gen === gradeReadGenRef.current) {
        toast.error('No se pudo leer la imagen. Prueba otra foto más nítida.');
      }
    } finally {
      if (gen === gradeReadGenRef.current) {
        mobileCaptureBusyRef.current = false;
        setScanBusy(false);
      }
    }
  };

  const handlePdfFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!examId || !exam || !supportsCalifacil) {
      toast.error('Selecciona primero un examen válido.');
      return;
    }
    if (phase !== 'capturar' && phase !== 'elegir') {
      toast.error('Termina la hoja actual antes de importar otro archivo.');
      return;
    }
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      toast.error('Elige un archivo PDF.');
      return;
    }
    if (phase === 'elegir') {
      setPhase('capturar');
    }
    gradeReadAbortRef.current?.abort();
    const abort = new AbortController();
    gradeReadAbortRef.current = abort;
    const gen = ++gradeReadGenRef.current;
    setScanBusy(true);
    await yieldForSpinnerPaint();
    try {
      clearPendingPdfGrading();
      flushSync(() => setLiveStatus('Renderizando página 1 del PDF en el servidor…'));
      await yieldForSpinnerPaint();
      const { canvas: firstCanvas, numPages } = await renderPdfGradingPageCanvas(file, 1, undefined, {
        signal: abort.signal,
        timeoutMs: 25000,
      });
      if (gen !== gradeReadGenRef.current || abort.signal.aborted) return;
      if (numPages === 0) {
        toast.error('El PDF no tiene páginas legibles.');
        return;
      }
      const handle = createPdfGradingHandle(file, numPages);
      const sheetsNeeded = Math.max(1, totalSheets - sheetIndexRef.current);
      const lastPage = Math.min(numPages, sheetsNeeded);
      if (numPages > lastPage) {
        toast.message(
          `PDF con ${numPages} páginas: se usarán ${lastPage} para las hojas restantes del examen.`
        );
      } else if (numPages > 1 && totalSheets === 1) {
        toast.message('PDF con varias páginas: se calificará la página 1.');
      } else if (numPages > 1) {
        toast.message(
          `PDF con ${numPages} página(s). Tras confirmar cada hoja se cargará la siguiente automáticamente.`
        );
      }
      await finalizePdfPageForGrading(firstCanvas, 1);
      if (gen !== gradeReadGenRef.current) return;
      if (lastPage > 1) {
        pendingPdfGradingRef.current = { handle, nextPage: 2, lastPage };
        schedulePrefetchNextPdfPage();
      } else {
        handle.dispose();
      }
    } catch (err) {
      if (abort.signal.aborted || gen !== gradeReadGenRef.current) return;
      clearPendingPdfGrading();
      const message =
        err instanceof Error ? err.message : 'No se pudo leer el PDF.';
      toast.error(
        message.includes('Sesión') || message.includes('tardó') || message.length < 120
          ? message
          : 'No se pudo leer el PDF. Prueba otro archivo o exporta las páginas como imagen.'
      );
    } finally {
      if (gen === gradeReadGenRef.current) {
        setScanBusy(false);
        if (gradeReadAbortRef.current === abort) gradeReadAbortRef.current = null;
      }
    }
  };

  const startLiveCamera = useCallback(async (opts?: { skipPhaseGuard?: boolean }): Promise<boolean> => {
    // Escritorio: solo PDF/JPG. Nunca pedir permiso de cámara (ni DroidCam / webcams).
    if (!useLiveCameraUi || !isMobile || isDesktopPointerDevice()) return false;
    if (!examId || !exam || !supportsCalifacil) {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return false;
    }
    if (!opts?.skipPhaseGuard && phaseRef.current !== 'capturar') {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return false;
    }
    if (cameraOpen || startingCameraRef.current) {
      if (opts?.skipPhaseGuard) {
        stopLiveCamera();
        startingCameraRef.current = false;
        mobileCaptureBusyRef.current = false;
        await sleep(80);
      } else {
        return true;
      }
    }
    startingCameraRef.current = true;
    try {
      resumeScanAudioContext();
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        toast.error('Tu navegador no permite cámara en vivo en esta pantalla.');
        startingCameraRef.current = false;
        return false;
      }
      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: { facingMode: 'environment' }, audio: false },
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
      resetLiveReadings();
      flushSync(() => {
        setCameraOpen(true);
      });
      for (let attempt = 0; attempt < 24; attempt++) {
        await attachStreamToVideo();
        const video = videoRef.current;
        if (video && video.videoWidth >= 40 && video.readyState >= 2) break;
        await sleep(50);
      }
      updateLiveVideoLayout();
      const track = stream.getVideoTracks()[0];
      const supportsTorch =
        trackReportsTorchCapability(track) || (isMobile && Boolean(track));
      setFlashSupported(isMobile || supportsTorch);
      if (flashModeRef.current !== 'on') {
        setFlashOn(false);
      }
      if (track && typeof track.applyConstraints === 'function' && !isMobile) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
        } catch {
          // Algunos navegadores no exponen focusMode vía applyConstraints.
        }
      }
      const scanCanvas = document.createElement('canvas');
      const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
      let hotLoopStatus = '';

      const scheduleLiveScan = (delayMs: number) => {
        if (liveTickRef.current !== null) {
          window.clearTimeout(liveTickRef.current);
        }
        liveTickRef.current = window.setTimeout(() => {
          void runLiveScanLoop();
        }, delayMs);
      };

      const runLiveScanLoop = async () => {
        let nextDelay = isMobile ? MOBILE_CORNER_LOOP_MS : 600;
        if (!streamRef.current || !examId || !exam || phaseRef.current !== 'capturar') {
          stopScanningHum();
          liveTickRef.current = null;
          return;
        }
        if (liveBusyRef.current) {
          scheduleLiveScan(100);
          return;
        }
        if (isMobile && mobileCaptureBusyRef.current) {
          scheduleLiveScan(200);
          return;
        }
        if (isMobile && mobileReviewOpenRef.current) {
          scheduleLiveScan(300);
          return;
        }

        liveBusyRef.current = true;
        try {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.videoWidth < 40 || video.videoHeight < 40) {
            nextDelay = 100;
            return;
          }
          if (isMobile && video.paused) {
            void attachStreamToVideo();
            nextDelay = 150;
            return;
          }
          if (isMobile && !liveVideoLayoutRef.current) {
            updateLiveVideoLayout();
          }
          if (!isMobile && !scanCtx) return;

          const chunk = sheets[sheetIndexRef.current] ?? [];
          if (chunk.length === 0) return;

          let oriented: HTMLCanvasElement | null = null;
          let sheetLikely = false;
          if (isMobile) {
            const roiCapture = captureVideoFrameForDocumentDetect(video, {
              maxSide: MOBILE_ROI_DETECT_MAX_SIDE,
            });
            if (!roiCapture) {
              nextDelay = 100;
              return;
            }
            const { roiCanvas } = roiCapture;
            if (estimateCanvasMeanLuminance(roiCanvas) < MIN_FRAME_LUMINANCE) {
              setCornersAlignedView(false);
              setMobileScannerLowLight(true);
              setMobileSheetFillRatio(0);
              setMobileFiducialCount(0);
              setMobileFiducialCorners([false, false, false, false]);
              setMobileStripAligned(false);
              setMobileShadowWarning(false);
              setMobileStableTicks(0);
              setMobileExamReadyForCapture(false);
              setLiveScanGeometry(null);
              setLiveScanPicks([]);
              setLiveScanLockedRows([]);
              setLiveScanAmbiguousRows([]);
              setLiveShowBubbleOverlay(false);
              cornerStableTicksRef.current = 0;
              lastRoiQuadRef.current = null;
              lastRawRoiQuadRef.current = null;
              smoothedRoiQuadRef.current = null;
              lastRoiCaptureMetaRef.current = null;
              nextDelay = 200;
              setLiveStatus('Mejora la iluminación o activa el flash.');
              return;
            }
            setMobileScannerLowLight(false);

            const stripQuad = detectAnswerSheetQuadViaAlignStrips(roiCanvas);
            let roiQuadRaw: RoiQuad | null = detectMobileLiveSheetQuad(roiCanvas);
            const roiW = roiCanvas.width;
            const roiH = roiCanvas.height;

            const fiducialQuad = roiQuadRaw ?? stripQuad;
            let fiducialCorners = detectAnswerSheetFiducialsInRoi(roiCanvas, fiducialQuad);
            let fiducialCount = fiducialCorners.filter(Boolean).length;

            if (!roiQuadRaw && fiducialCount >= MOBILE_MIN_FIDUCIAL_CORNERS) {
              roiQuadRaw = detectLargestQuadInRoiCanvas(roiCanvas);
              fiducialCorners = detectAnswerSheetFiducialsInRoi(
                roiCanvas,
                roiQuadRaw ?? stripQuad
              );
              fiducialCount = fiducialCorners.filter(Boolean).length;
            }

            const stripAligned = stripQuad !== null;
            setMobileStripAligned(stripAligned);
            const quadValid =
              roiQuadRaw !== null && isValidMobileRoiQuad(roiQuadRaw, roiW, roiH);
            const roiQuad =
              quadValid && roiQuadRaw
                ? smoothMobileRoiQuad(smoothedRoiQuadRef.current, roiQuadRaw, 0.38)
                : null;
            const fillRatio =
              roiQuad !== null ? measureRoiSheetFillRatio(roiQuad, roiW, roiH) : 0;
            const examReadyForCapture = isMobileExamSheetReadyForCapture({
              fiducialCount,
              fiducialCorners,
              stripAligned,
              quad: roiQuad,
              roiW,
              roiH,
              fillRatio,
              roiCanvas: roiCanvas,
            });
            mobileCaptureGateRef.current = {
              fiducialCount,
              fiducialCorners,
              stripAligned,
              quad: roiQuad,
              roiW,
              roiH,
              fillRatio,
              roiCanvas,
            };
            setMobileExamReadyForCapture(examReadyForCapture);
            if (quadValid && roiQuad) {
              smoothedRoiQuadRef.current = roiQuad;
              lastRoiCaptureMetaRef.current = roiCapture;
            }
            const layout = liveVideoLayoutRef.current;
            const now = performance.now();
            if ((stripAligned || quadValid) && roiCapture && layout && roiQuad) {
              const viewportPoly = mapRoiQuadPolygonToViewportPx(roiQuad, roiCapture, layout);
              documentPolygonHoldRef.current = {
                polygon: viewportPoly,
                until: now + DOCUMENT_POLYGON_HOLD_MS,
              };
              setMobileDocumentPolygon(viewportPoly);
            } else {
              const hold = documentPolygonHoldRef.current;
              if (hold && now < hold.until) {
                setMobileDocumentPolygon(hold.polygon);
              } else {
                documentPolygonHoldRef.current = null;
                setMobileDocumentPolygon(null);
              }
            }
            const shadowAsym = estimateCanvasShadowAsymmetry(roiCanvas);
            const shadowStrong = shadowAsym >= SHADOW_ASYMMETRY_TORCH;

            setMobileSheetFillRatio(fillRatio);
            setMobileFiducialCount(fiducialCount);
            setMobileFiducialCorners(fiducialCorners);
            setMobileShadowWarning(shadowStrong);

            if (shadowStrong && flashSupported && flashModeRef.current === 'auto' && !flashOn && !autotorchTriedRef.current) {
              shadowTorchTicksRef.current += 1;
              if (shadowTorchTicksRef.current >= SHADOW_AUTOTORCH_TICKS) {
                autotorchTriedRef.current = true;
                void setTorchEnabled(true);
              }
            } else if (!shadowStrong) {
              shadowTorchTicksRef.current = 0;
            }

            setLiveShowBubbleOverlay(false);
            setLiveScanGeometry(null);
            setLiveScanPicks([]);
            setLiveScanLockedRows([]);
            setLiveScanAmbiguousRows([]);

            if (!quadValid || !roiQuad) {
              fiducialStableTicksRef.current = 0;
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              setMobileExamReadyForCapture(false);
              if (!documentPolygonHoldRef.current) {
                lastRoiQuadRef.current = null;
                lastRawRoiQuadRef.current = null;
              }
              setCornersAlignedView(false);
              lowVisibilityTicksRef.current += 1;
              if (
                flashSupported &&
                flashModeRef.current === 'auto' &&
                !flashOn &&
                !autotorchTriedRef.current &&
                lowVisibilityTicksRef.current >= LOW_VISIBILITY_AUTOTORCH_TICKS
              ) {
                autotorchTriedRef.current = true;
                void setTorchEnabled(true);
                setLiveStatus('Activé el flash. Centra la hoja con las franjas negras visibles.');
              } else if (!stripAligned && fiducialCount >= MOBILE_MIN_FIDUCIAL_CORNERS) {
                setLiveStatus('Alinea las franjas negras laterales del examen.');
              } else if (
                stripAligned &&
                fiducialCount < MOBILE_LIVE_MIN_FIDUCIAL_CORNERS &&
                !fiducialCorners[0] &&
                !fiducialCorners[1] &&
                (fiducialCorners[2] || fiducialCorners[3])
              ) {
                setLiveStatus(
                  'Acerca las esquinas superiores y reduce el brillo arriba de la hoja.'
                );
              } else if (stripAligned) {
                setLiveStatus(
                  `Esquinas: ${fiducialCount}/4. Con franjas: basta 3 esquinas negras (o las 4).`
                );
              } else {
                setLiveStatus(
                  `Esquinas: ${fiducialCount}/4. Encuadra la hoja con las 4 esquinas negras visibles.`
                );
              }
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            fiducialStableTicksRef.current = 0;

            if (fillRatio < (stripAligned ? 0.06 : MOBILE_MIN_ROI_FILL_RATIO)) {
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              lastRoiQuadRef.current = roiQuad;
              setCornersAlignedView(false);
              setLiveStatus(
                fillRatio < 0.1
                  ? 'Acerca un poco el teléfono.'
                  : 'Centra la hoja en el visor.'
              );
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            if (!lastRawRoiQuadRef.current) {
              lastRawRoiQuadRef.current = roiQuadRaw;
              lastRoiQuadRef.current = roiQuad;
              cornerStableTicksRef.current = 1;
              setMobileStableTicks(1);
              setCornersAlignedView(true);
              setLiveStatus('Documento detectado — mantén quieto…');
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            const stable = mobileRoiQuadsAreStable(
              lastRawRoiQuadRef.current,
              roiQuadRaw!,
              roiW,
              roiH,
              0.15
            );
            lastRawRoiQuadRef.current = roiQuadRaw!;
            lastRoiQuadRef.current = roiQuad;
            if (!stable) {
              cornerStableTicksRef.current = Math.max(0, cornerStableTicksRef.current - 1);
              setMobileStableTicks(cornerStableTicksRef.current);
              if (cornerStableTicksRef.current === 0) {
                setCornersAlignedView(false);
                setLiveStatus('Mantén la hoja quieta…');
              }
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            cornerStableTicksRef.current += 1;
            lowVisibilityTicksRef.current = 0;
            setMobileStableTicks(cornerStableTicksRef.current);
            setCornersAlignedView(examReadyForCapture);
            if (!examReadyForCapture) {
              const minLiveCorners = stripAligned ? MOBILE_LIVE_MIN_FIDUCIAL_CORNERS : MOBILE_MIN_FIDUCIAL_CORNERS;
              setLiveStatus(
                !stripAligned
                  ? 'Centra el examen — deben verse las franjas negras laterales.'
                  : fiducialCount < minLiveCorners
                    ? !fiducialCorners[0] &&
                      !fiducialCorners[1] &&
                      (fiducialCorners[2] || fiducialCorners[3])
                      ? 'Acerca las esquinas superiores y reduce el brillo arriba de la hoja.'
                      : `Esquinas: ${fiducialCount}/4. Con franjas laterales bastan 3 esquinas negras.`
                    : fillRatio < MOBILE_MIN_ROI_FILL_RATIO
                      ? 'Acerca el teléfono hasta ver la hoja completa.'
                      : 'Ajusta la hoja — el interior debe verse blanco y nítido.'
              );
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            // Contrato: 4 esquinas + franjas estables N ticks + nitidez → foto.
            const readyToSnap = shouldTriggerAutoCapture({
              autoShutterEnabled: autoShutterEnabledRef.current,
              captureBusy: mobileCaptureBusyRef.current,
              stableTicks: cornerStableTicksRef.current,
              requiredTicks: MOBILE_CAPTURE_STABLE_TICKS_REQUIRED,
            });

            if (
              readyToSnap &&
              autoShutterEnabledRef.current &&
              !mobileCaptureBusyRef.current
            ) {
              const liveSharpness = estimateCanvasSharpness(roiCanvas);
              if (liveSharpness < MOBILE_MIN_LIVE_SHARPNESS) {
                setLiveStatus('Mantén el teléfono quieto');
                nextDelay = MOBILE_CORNER_LOOP_MS;
                return;
              }
              setLiveStatus('Capturando…');
              const captureQuad = smoothedRoiQuadRef.current ?? lastRoiQuadRef.current;
              const captureRoi = lastRoiCaptureMetaRef.current;
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              setShutterFlash(true);
              window.setTimeout(() => setShutterFlash(false), 160);
              triggerMobileSheetCaptureRef.current(video, {
                roiQuad: captureQuad,
                roiCapture: captureRoi,
              });
            } else if (!autoShutterEnabledRef.current) {
              setLiveStatus('Examen detectado — mantén quieto…');
            } else {
              setLiveStatus('Mantén el teléfono quieto');
            }
            nextDelay = MOBILE_CORNER_LOOP_MS;
            return;
          } else {
            if (!scanCtx) return;
            let targetW = video.videoWidth;
            let targetH = video.videoHeight;
            if (targetW > MOBILE_SCAN_MAX_WIDTH) {
              const s = MOBILE_SCAN_MAX_WIDTH / Math.max(1, targetW);
              targetW = MOBILE_SCAN_MAX_WIDTH;
              targetH = Math.max(1, Math.round(targetH * s));
            }
            if (scanCanvas.width !== targetW || scanCanvas.height !== targetH) {
              scanCanvas.width = targetW;
              scanCanvas.height = targetH;
            }
            scanCtx.drawImage(video, 0, 0, targetW, targetH);
            oriented = scanCanvas;
            sheetLikely = isCalifacilExamSheetLikely(oriented, omrCols);
          }

          if (!sheetLikely) {
            stopScanningHum();
            stablePartialTicksRef.current = 0;
            stableFullTicksRef.current = 0;
            strictValidationTicksRef.current = 0;
            lastQualityProbeRef.current = null;
            liveReadingStreakRef.current = {};
            if (isMobile) {
              setLiveScanGeometry(null);
              setLiveScanPicks([]);
              setLiveScanLockedRows([]);
              setLiveScanAmbiguousRows([]);
              setLiveShowBubbleOverlay(false);
            }
            lowVisibilityTicksRef.current += 1;
            const locksNoExam = liveLockedAnswersRef.current;
            const mergedNoExam: Record<string, string> = {};
            let resolvedNoExam = 0;
            let noExamSig = '';
            for (const q of chunk) {
              const locked = locksNoExam[q.id]?.trim();
              mergedNoExam[q.id] = locked || '';
              noExamSig += `${locked ?? ''}\n`;
              if (locked) resolvedNoExam++;
            }
            if (
              noExamSig !== liveDraftDisplaySigRef.current ||
              resolvedNoExam !== liveResolvedDisplayedRef.current
            ) {
              liveDraftDisplaySigRef.current = noExamSig;
              liveResolvedDisplayedRef.current = resolvedNoExam;
              setLiveDraftSelections(mergedNoExam);
              setLiveResolvedCount(resolvedNoExam);
            }
            const nextStatus = isMobile
              ? 'Alinea los 4 cuadros negros de esquina con las esquinas naranjas del marco.'
              : 'Encuadra toda la hoja dentro de la pantalla, con buena luz y la tabla de respuestas visible abajo.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }

            if (
              isMobile &&
              flashSupported &&
              flashModeRef.current === 'auto' &&
              !flashOn &&
              !autotorchTriedRef.current &&
              lowVisibilityTicksRef.current >= LOW_VISIBILITY_AUTOTORCH_TICKS
            ) {
              autotorchTriedRef.current = true;
              void setTorchEnabled(true);
              setLiveStatus(
                'Activé el flash automáticamente para mejorar detección. Mantén la hoja dentro del marco.'
              );
              if (!glareHintShownRef.current) {
                glareHintShownRef.current = true;
                toast.message('Si hay reflejo, inclina ligeramente el celular y evita brillo directo.');
              }
            }
            return;
          }

          const strictOk = isCalifacilExamSheetLikely(oriented, omrCols);
          if (strictOk) {
            strictValidationTicksRef.current += 1;
          } else {
            strictValidationTicksRef.current = 0;
          }
          const showBubbles =
            isMobile && strictValidationTicksRef.current >= LIVE_STRICT_OVERLAY_TICKS;
          if (isMobile) {
            setLiveShowBubbleOverlay(showBubbles);
          }

          lowVisibilityTicksRef.current = 0;
          const scanMeta = scanCalifacilOmrSheetWithMeta(oriented, omrCols, {
            skipGuideCrop: true,
            qnumSweep: 'live',
            columnShiftSweep: 'live',
            geometryMode: isMobile ? 'fullSheet' : 'fullSheet',
            preserveInputCanvas: isMobile,
            fixedTemplateAnchor: false,
            rowCount: omrRowCount,
          });
          const raw = [...scanMeta.picks];
          const mapped = mapRawToDraft(raw, chunk);
          if (isMobile) {
            lastQualityProbeRef.current = probeCalifacilSheetQuality(oriented, omrCols);
            if (showBubbles) {
              setLiveScanGeometry(scanMeta.geometry);
              setLiveScanPicks(raw.slice(0, chunk.length));
            } else {
              setLiveScanGeometry(null);
              setLiveScanPicks([]);
            }
          }
          const locks = liveLockedAnswersRef.current;
          const streaks = liveReadingStreakRef.current;
          const mergedLive: Record<string, string> = {};
          let mergedResolved = 0;
          let draftSig = '';
          for (const q of chunk) {
            const locked = locks[q.id]?.trim();
            if (locked) {
              mergedLive[q.id] = locked;
              mergedResolved++;
            } else {
              const v = mapped.draft[q.id]?.trim() ?? '';
              if (v) {
                const prev = streaks[q.id];
                if (prev?.value === v) {
                  prev.streak += 1;
                } else {
                  streaks[q.id] = { value: v, streak: 1 };
                }
                if (streaks[q.id]!.streak >= CONSENSUS_LOCK_TICKS) {
                  locks[q.id] = v;
                  mergedLive[q.id] = v;
                  mergedResolved++;
                } else {
                  mergedLive[q.id] = v;
                }
              } else {
                delete streaks[q.id];
                mergedLive[q.id] = '';
              }
            }
            draftSig += `${mergedLive[q.id] ?? ''}\n`;
          }
          let tentativeResolved = 0;
          for (const q of chunk) {
            if (mergedLive[q.id]?.trim()) tentativeResolved++;
          }
          if (isMobile) {
            const lockedRowFlags = chunk.map((q) => Boolean(locks[q.id]?.trim()));
            const ambiguousRowFlags = chunk.map((_, i) => Boolean(scanMeta.rows[i]?.ambiguous));
            if (showBubbles) {
              setLiveScanLockedRows(lockedRowFlags);
              setLiveScanAmbiguousRows(ambiguousRowFlags);
            } else {
              setLiveScanLockedRows([]);
              setLiveScanAmbiguousRows([]);
            }
          }
          if (draftSig !== liveDraftDisplaySigRef.current) {
            liveDraftDisplaySigRef.current = draftSig;
            setLiveDraftSelections(mergedLive);
          }
          if (mergedResolved !== liveResolvedDisplayedRef.current) {
            liveResolvedDisplayedRef.current = mergedResolved;
            setLiveResolvedCount(mergedResolved);
          }

          if (isMobile && mergedResolved >= chunk.length && chunk.length > 0) {
            nextDelay = 1050;
          }

          if (chunk.length > 0) {
            if (isMobile) {
              if (mergedResolved >= chunk.length && strictOk) {
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
            } else if (mergedResolved >= chunk.length) {
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
          if (mergedResolved < Math.ceil(chunk.length * 0.35)) {
            lowVisibilityTicksRef.current += 1;
          } else {
            lowVisibilityTicksRef.current = 0;
          }

          if (
            isMobile &&
            flashSupported &&
            flashModeRef.current === 'auto' &&
            !flashOn &&
            !autotorchTriedRef.current &&
            lowVisibilityTicksRef.current >= LOW_VISIBILITY_AUTOTORCH_TICKS
          ) {
            autotorchTriedRef.current = true;
            void setTorchEnabled(true);
            setLiveStatus('Poca luz detectada: activé flash automáticamente.');
          }
          const autoCaptureMin = Math.max(1, Math.ceil(chunk.length * MOBILE_AUTO_CAPTURE_MIN_RATIO));
          if (isMobile && !strictOk && chunk.length > 0) {
            const nextStatus =
              'Alinea los 4 cuadros negros de esquina con las esquinas naranjas del marco.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (isMobile && mergedResolved >= autoCaptureMin && strictOk && chunk.length > 0) {
            const nextStatus =
              'Lectura estable: capturando en automático o pulsa el botón naranja.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (mergedResolved >= chunk.length && chunk.length > 0) {
            const nextStatus = isMobile
              ? 'Lectura completa: capturando en automático o pulsa el botón naranja.'
              : 'Detección completa. Toca «Revisar y confirmar».';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (mergedResolved >= minResolved) {
            const nextStatus = isMobile
              ? 'Casi listo: mantén fijo el encuadre o pulsa el botón naranja.'
              : 'Lecturas capturadas. Completa faltantes o pulsa «Revisar y confirmar».';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (tentativeResolved >= Math.ceil(chunk.length * 0.25)) {
            const nextStatus = 'Detectando respuestas… mantén la hoja quieta y bien iluminada.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else {
            const nextStatus =
              'Encuadra toda la hoja dentro de la pantalla; debe verse la tabla de respuestas al pie.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          }

          if (mergedResolved >= minResolved && chunk.length > 0) {
            stablePartialTicksRef.current += 1;
          } else {
            stablePartialTicksRef.current = 0;
          }
          if (
            isMobile
              ? mergedResolved >= autoCaptureMin && strictOk && chunk.length > 0
              : mergedResolved >= chunk.length && chunk.length > 0
          ) {
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

          if (stableFullTicksRef.current >= STABLE_FULL_TICKS && chunk.length > 0) {
            stableFullTicksRef.current = 0;
            await showAutoCaptureSnapshot(oriented);
            const nextStatus =
              'Hoja completa detectada. Toca «Revisar y confirmar» para validar respuestas antes de guardar.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          }
        } finally {
          liveBusyRef.current = false;
          if (streamRef.current && examId && exam && phaseRef.current === 'capturar') {
            scheduleLiveScan(nextDelay);
          } else {
            if (liveTickRef.current !== null) {
              window.clearTimeout(liveTickRef.current);
              liveTickRef.current = null;
            }
          }
        }
      };

      scheduleLiveScan(100);
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'No se pudo abrir la cámara. Revisa permisos o usa "Subir foto".';
      toast.error('No se pudo abrir la cámara', {
        description: toSpanishAuthMessage(message),
      });
      setCameraOpen(false);
      return false;
    } finally {
      startingCameraRef.current = false;
    }
  }, [
    attachStreamToVideo,
    cameraOpen,
    exam,
    examId,
    flashOn,
    flashSupported,
    isMobile,
    mapRawToDraft,
    omrCols,
    omrRowCount,
    resetLiveReadings,
    setTorchEnabled,
    sheets,
    showAutoCaptureSnapshot,
    stopLiveCamera,
    supportsCalifacil,
    updateLiveVideoLayout,
    useLiveCameraUi,
  ]);

  startLiveCameraRef.current = startLiveCamera;

  const retakeMobileSheetPhoto = useCallback(
    (sheetIdx = sheetIndexRef.current) => {
      setMobileSheetSnapshots((prev) => prev.filter((snap) => snap.sheetIndex !== sheetIdx));
      setMobileResultsDraft((prev) => {
        const chunk = sheets[sheetIdx] ?? [];
        const next = { ...prev };
        for (const q of chunk) delete next[q.id];
        return next;
      });
      setReviewOmrGeometry(null);
      setReviewOmrPicks([]);
      setReviewQualityHint(null);
      setDraftSelections({});
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setAutoGradeDialogOpen(false);
      setSheetIndex(sheetIdx);
      sheetIndexRef.current = sheetIdx;
      stopLiveCamera();
      startingCameraRef.current = false;
      mobileCaptureBusyRef.current = false;
      setScanBusy(false);
      flushSync(() => {
        setPhase('capturar');
        setCameraPermissionPhase('granted');
      });
      phaseRef.current = 'capturar';
      if (!useLiveCameraUi) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void startLiveCamera({ skipPhaseGuard: true }).then((ok) => {
            if (!ok) {
              setCameraPermissionPhase('denied');
              setCameraOpen(false);
            }
          });
        });
      });
    },
    [useLiveCameraUi, sheets, startLiveCamera, stopLiveCamera]
  );

  const openMobileCapture = useCallback(() => {
    if (!useLiveCameraUi || isDesktopPointerDevice()) {
      flushSync(() => {
        setPhase('capturar');
        setCameraPermissionPhase('granted');
      });
      phaseRef.current = 'capturar';
      setLiveStatus('Sube una imagen escaneada para leer respuestas.');
      return;
    }
    if (examLoading) {
      toast.error('Cargando examen, espera un momento.');
      return;
    }
    if (!examId || !exam || !supportsCalifacil) {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return;
    }
    stopLiveCamera();
    startingCameraRef.current = false;
    mobileCaptureBusyRef.current = false;
    setScanBusy(false);
    setAutoShutterEnabled(true);
    autoShutterEnabledRef.current = true;
    clearMobileSnapshots();
    setMobileResultsDraft({});
    setResultsSheetIdx(0);
    setZipGradeModalOpen(false);
    setZipGradeReviewOpen(false);
    // Permiso ya concedido en sesiones previas: abrir cámara de inmediato (sin pantalla de gate).
    flushSync(() => {
      setPhase('capturar');
      setCameraPermissionPhase('granted');
      setCameraOpen(false);
    });
    phaseRef.current = 'capturar';
    setLiveStatus('Coloca la hoja en el visor…');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void startLiveCamera({ skipPhaseGuard: true }).then((ok) => {
          if (!ok) {
            setCameraPermissionPhase('denied');
            setCameraOpen(false);
          } else {
            setCameraPermissionPhase('granted');
          }
        });
      });
    });
  }, [
    clearMobileSnapshots,
    exam,
    examId,
    examLoading,
    startLiveCamera,
    useLiveCameraUi,
    stopLiveCamera,
    supportsCalifacil,
  ]);

  const requestCameraFromGate = useCallback(() => {
    if (!useLiveCameraUi || isDesktopPointerDevice()) return;
    setCameraPermissionPhase('requesting');
    void startLiveCamera({ skipPhaseGuard: true }).then((ok) => {
      setCameraPermissionPhase(ok ? 'granted' : 'denied');
    });
  }, [startLiveCamera, useLiveCameraUi]);

  const confirmCurrentSheet = async (providedDraft?: Record<string, string>) => {
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
    // Vacío = incorrecto (hoja en blanco → 0%). No exigir marcas para confirmar.

    const mergedNow: Record<string, string> = { ...confirmedByQuestionId };
    for (const q of chunk) {
      mergedNow[q.id] = effectiveDraft[q.id]?.trim() ?? '';
    }
    setConfirmedByQuestionId(mergedNow);

    const isLast = sheetIndex >= totalSheets - 1;

    const pushMobileSheetSnapshot = async () => {
      if (!isMobile || !previewUrl || !reviewOmrGeometry) return;
      const cloned = await cloneObjectUrl(previewUrl);
      if (!cloned) return;
      const selections: Record<string, string> = {};
      for (const q of chunk) selections[q.id] = (effectiveDraft[q.id] ?? '').trim();
      let geom: CalifacilOmrScanGeometry;
      try {
        geom = structuredClone(reviewOmrGeometry);
      } catch {
        geom = JSON.parse(JSON.stringify(reviewOmrGeometry)) as CalifacilOmrScanGeometry;
      }
      setMobileSheetSnapshots((prev) => [
        ...prev,
        {
          sheetIndex,
          previewUrl: cloned,
          geometry: geom,
          questionIds: chunk.map((q) => q.id),
          selectionsByQuestionId: selections,
          columnPicks: reviewOmrPicks.slice(0, chunk.length),
        },
      ]);
    };

    await pushMobileSheetSnapshot();

    if (!isLast) {
      const nextIdx = sheetIndex + 1;
      setSheetIndex(nextIdx);
      sheetIndexRef.current = nextIdx;
      setReviewOmrGeometry(null);
      setReviewOmrPicks([]);
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setDraftSelections({});
      resetLiveReadings();
      setPhase(isMobile ? 'elegir' : 'capturar');
      toast.success(
        isMobile
          ? `Hoja ${sheetIndex + 1} guardada. Pulsa «Tomar foto» para la siguiente hoja.`
          : `Hoja ${sheetIndex + 1} guardada. Importa la foto de la siguiente hoja.`
      );
      const nextPdf = !isMobile ? await takeNextPdfPageCanvas() : null;
      if (nextPdf) {
        setScanBusy(true);
        flushSync(() =>
          setLiveStatus(`Renderizando página ${nextPdf.page} del PDF en el servidor…`)
        );
        await yieldForSpinnerPaint();
        try {
          await finalizePdfPageForGrading(nextPdf.canvas, nextPdf.page);
        } catch {
          toast.error('No se pudo leer la siguiente página del PDF.');
        } finally {
          setScanBusy(false);
        }
      }
      return;
    }

    await submitAll(mergedNow);
  };

  const persistStudentAnswers = async (
    merged: Record<string, string>,
    studentIdOverride?: string
  ) => {
    const studentId = resolveCalificarStudentId(selectedStudentId, studentIdOverride, sortedStudents);
    if (!studentId || !exam || !examId) {
      throw new Error('missing_context');
    }
    const effectiveKey = examVirtualKeyByQuestionId;
    const mcQuestions = questions.filter((q) => q.type === 'multiple_choice');
    const mcTotal = mcQuestions.length;
    if (Object.keys(effectiveKey).length !== mcTotal) {
      throw new Error('incomplete_key');
    }

    let correctCount = 0;
    let earnedPoints = 0;
    let maxMcPoints = 0;
    const rows = questions.map((question: Question) => {
      const answerText = (merged[question.id] ?? '').trim();
      const { isCorrect, score } = gradeMcQuestionForPersist(question, answerText, virtualKeyMaps);
      const pts = questionPoints(question);
      if (question.type === 'multiple_choice') {
        maxMcPoints += pts;
        if (isCorrect) {
          correctCount++;
          earnedPoints += score;
        }
      }

      return {
        exam_id: examId,
        student_id: studentId,
        question_id: question.id,
        answer_text: answerText,
        is_correct: isCorrect,
        score,
      };
    });

    const { error: answersError } = await supabase.from('answers').upsert(rows, {
      onConflict: 'exam_id,student_id,question_id',
    });
    if (answersError) throw answersError;

    const pct = calculatePercentage(earnedPoints, maxMcPoints);
    const wrong = Math.max(0, mcTotal - correctCount);
    return { pct, correct: correctCount, wrong, total: mcTotal };
  };

  const presentInstantCaptureGrade = useCallback(
    async (fullDraft: Record<string, string>, studentIdOverride?: string) => {
      // Popup móvil: nota de la hoja actual (no del examen completo con vacías = error).
      const chunk = sheets[sheetIndexRef.current] ?? [];
      const stats =
        isMobile && chunk.length > 0
          ? gradeMcDraftAgainstVirtualKey(
              Object.fromEntries(chunk.map((q) => [q.id, fullDraft[q.id] ?? ''])),
              chunk,
              virtualKeyMaps
            )
          : gradeMcDraftAgainstVirtualKey(fullDraft, questions, virtualKeyMaps);
      setAutoGradeStats(stats);
      setMobileResultsDraft({ ...fullDraft });

      const studentId = resolveCalificarStudentId(selectedStudentId, studentIdOverride, sortedStudents);
      const canPersist = Boolean(studentId) && canGradeStudents;

      if (isMobile) {
        stopLiveCamera();
        setPhase('ver_resultados');
        setZipGradeReviewOpen(false);
        setZipGradeModalOpen(true);
      } else {
        setAutoGradeDialogOpen(true);
        setPhase('elegir');
        setSheetIndex(0);
        setConfirmedByQuestionId({});
        confirmedAnswersRef.current = {};
        setDraftSelections({});
        setPreviewUrl((u) => {
          if (u) URL.revokeObjectURL(u);
          return null;
        });
      }

      setAutoGradePersisted(false);

      if (canPersist) {
        void (async () => {
          try {
            await persistStudentAnswers(fullDraft, studentId ?? undefined);
            setAutoGradePersisted(true);
            if (!isMobile) {
              toast.success('Calificación guardada.');
            }
          } catch (err: unknown) {
            setAutoGradePersisted(false);
            const code = err instanceof Error ? err.message : '';
            if (code === 'incomplete_key') {
              toast.error('Clave automática incompleta. No se pudo guardar en la nube.');
            } else {
              toast.error(
                isMobile
                  ? 'No se pudo guardar la calificación. Revisa la conexión e inténtalo de nuevo desde Resultados.'
                  : 'No se pudo guardar en la nube. El resultado se muestra igual.'
              );
            }
          }
        })();
      } else {
        toast.message(
          studentId
            ? 'Resultado calculado (no se guardó: sin permiso de clave o alumno).'
            : 'Resultado calculado. Elige al alumno manualmente si no se identificó en la hoja.'
        );
      }

      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      liveLockedAnswersRef.current = {};
      setReviewOmrGeometry(null);
      setReviewOmrPicks([]);
      setReviewQualityHint(null);
    },
    [
      canGradeStudents,
      virtualKeyMaps,
      isMobile,
      questions,
      sheets,
      selectedStudentId,
      sortedStudents,
      stopLiveCamera,
    ]
  );

  presentInstantCaptureGradeRef.current = presentInstantCaptureGrade;

  const advanceOrPresentMobileGradeRef = useRef<
    (fullChunkDraft: Record<string, string>, gradeStudentId?: string) => Promise<void>
  >(() => Promise.resolve());

  const advanceOrPresentMobileGrade = useCallback(
    async (fullChunkDraft: Record<string, string>, gradeStudentId?: string) => {
      const si = sheetIndexRef.current;
      const mergedNow: Record<string, string> = {
        ...confirmedAnswersRef.current,
        ...fullChunkDraft,
      };
      setConfirmedByQuestionId(mergedNow);
      confirmedAnswersRef.current = mergedNow;

      const isLast = si >= sheets.length - 1;
      // Siempre mostrar popup de nota (también en multi-hoja con la hoja actual).
      await presentInstantCaptureGrade(mergedNow, gradeStudentId);
      if (!isLast) {
        toast.message(
          `Hoja ${si + 1} de ${sheets.length} lista. Pulsa «Calificar de nuevo» para la siguiente.`
        );
      }
    },
    [presentInstantCaptureGrade, sheets.length]
  );

  advanceOrPresentMobileGradeRef.current = advanceOrPresentMobileGrade;

  const submitAll = async (merged: Record<string, string>) => {
    if (!exam || !examId) return;

    // Vacío = incorrecto (hoja en blanco → 0%). No exigir marcas para guardar.

    if (!resolveCalificarStudentId(selectedStudentId, undefined, sortedStudents)) {
      toast.error('Identifica al alumno en la hoja o elígelo manualmente antes de guardar.');
      return;
    }
    if (!canGradeStudents) {
      toast.error('Calificación bloqueada: la clave automática del examen no está completa.');
      return;
    }

    setPhase('guardando');

    try {
      const stats = await persistStudentAnswers(merged);
      setAutoGradeStats(stats);
      setAutoGradePersisted(true);
      if (isMobile) {
        setMobileResultsDraft({ ...merged });
      }
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
      const code = err instanceof Error ? err.message : '';
      if (code === 'incomplete_key') {
        toast.error('Clave automática incompleta. Revisa que cada reactivo tenga respuesta correcta válida.');
        setPhase('elegir');
        return;
      }
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

  const saveMobileResultsEdits = async () => {
    if (!isMobile || phase !== 'ver_resultados') return;
    if (!exam || !examId) return;
    for (const q of questions) {
      if (!mobileResultsDraft[q.id]?.trim()) {
        toast.error(`Falta la respuesta de la pregunta ${questions.findIndex((x) => x.id === q.id) + 1}`);
        return;
      }
    }
    if (!resolveCalificarStudentId(selectedStudentId, undefined, sortedStudents)) {
      toast.error('Identifica al alumno en la hoja o elígelo manualmente antes de guardar.');
      return;
    }
    if (!canGradeStudents) {
      toast.error('Calificación bloqueada.');
      return;
    }
    setScanBusy(true);
    await yieldForSpinnerPaint();
    try {
      await persistStudentAnswers(mobileResultsDraft);
      const stats = gradeMcDraftAgainstVirtualKey(
        mobileResultsDraft,
        questions,
        virtualKeyMaps
      );
      setAutoGradeStats(stats);
      toast.success('Cambios guardados en la nube.');
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'incomplete_key') {
        toast.error('Clave automática incompleta.');
      } else {
        toast.error('No se pudo guardar', {
          description: 'Revisa tu conexión y permisos.',
        });
      }
    } finally {
      setScanBusy(false);
    }
  };

  const processMobileCapturedCanvas = useCallback(
    async (
      fullCanvas: HTMLCanvasElement,
      video: HTMLVideoElement | null,
      opts?: {
        /** Quad en coordenadas del fotograma completo (mismo canvas). */
        frameQuad?: RoiQuad | null;
        fromGallery?: boolean;
      }
    ) => {
      const clearPreview = () => clearMobileScanPreviewState(video);

      if (estimateCanvasMeanLuminance(fullCanvas) < MIN_FRAME_LUMINANCE) {
        clearPreview();
        toast.error('Imagen muy oscura. Mejora la luz o activa el flash.');
        setLiveStatus('Mejora la iluminación antes de escanear.');
        return;
      }

      // Galería: franjas/fiduciales antes que largest-quad (mesa/borde).
      // Live: frameQuad de cámara si viene; si no, strips → live → largest.
      const stripQuad = detectAnswerSheetQuadViaAlignStrips(fullCanvas);
      const frameQuad = opts?.fromGallery
        ? (opts?.frameQuad ?? stripQuad)
        : (opts?.frameQuad ??
          stripQuad ??
          detectMobileLiveSheetQuad(fullCanvas) ??
          detectLargestQuadInRoiCanvas(fullCanvas));

      const sheetFormatHint = classifyAnswerSheetFormat(fullCanvas);
      let sheetKind: ZipGradeSheetKind =
        sheetFormatHint === 'zipgrade' ? 'zipgrade' : 'califacil';

      let warped: HTMLCanvasElement | null = null;
      let alignment: WarpAlignmentReport | null = null;

      if (sheetKind !== 'zipgrade') {
        // Solo warp ultrarrápido — nunca warpCalifacilMobileCapture (deskew lento ~1 min).
        // Sin frameQuad (galería sin franjas), el fast path sigue con strips internos + corners.
        const fastWarp = warpCalifacilMobileCaptureFast(fullCanvas, {
          frameQuad: frameQuad ?? undefined,
          maxErrorPx: MOBILE_WARP_FALLBACK_MAX_ERROR_PX,
        });
        warped = fastWarp.warped;
        alignment = fastWarp.alignment;
        if (!warped) {
          const warpedOnly = warpCalifacilSheetFromCornerMarkers(fullCanvas);
          if (warpedOnly) {
            const refined = refineWarpedCalifacilSheet(warpedOnly, {
              maxAllowedPx: MOBILE_WARP_FALLBACK_MAX_ERROR_PX,
              fast: true,
            });
            // No devolver warp débil: solo Acceptable (o carta + franjas + ≥3).
            const cand = refined.canvas;
            const corners = countCalifacilCornerMarkers(cand);
            const soft =
              isCalifacilWarpedLetterCanvas(cand) &&
              hasCalifacilAlignStrips(cand) &&
              corners >= 3;
            if (isMobileWarpedAnswerSheetAcceptable(cand) || soft) {
              warped = cand;
              alignment = refined.alignment;
            }
          }
        }
      }

      if (!warped && sheetKind === 'zipgrade') {
        const zgWarp = warpZipGradeAnswerSheet(fullCanvas);
        if (zgWarp.warped) {
          warped = zgWarp.warped;
          alignment = zgWarp.alignment;
        }
      }

      if (!warped) {
        clearPreview();
        toast.error(
          'No se detectó la hoja. Centra 3 esquinas + franjas laterales (o las 4 esquinas), con buena luz.'
        );
        setLiveStatus('Centra la hoja: 3 esquinas negras + franjas laterales, o las 4.');
        return;
      }

      const warpedSharpness = estimateCanvasSharpness(warped);
      if (warpedSharpness < MOBILE_MIN_WARPED_SHARPNESS) {
        clearPreview();
        toast.error('Imagen borrosa. Toma otra foto más nítida, con buena luz.');
        setLiveStatus('Mantén el teléfono quieto al escanear.');
        if (video) resumeLiveVideoAfterScan(video);
        return;
      }

      const chunk = sheets[sheetIndexRef.current] ?? [];
      const chunkRows = chunk.length;
      if (chunkRows === 0) {
        clearPreview();
        toast.error('No hay preguntas para calificar en esta hoja.');
        return;
      }

      if (!opts?.fromGallery) {
        void setTorchEnabled(false);
        setFlashOn(false);
      }

      // Mantener freeze de captura; no regenerar JPEG warped (ahorra toDataURL).
      setLiveStatus('Calificando…');

      // Pausar video solo después de tener freeze en pantalla.
      if (video) {
        try {
          video.pause();
        } catch {
          /* ignore */
        }
      }

      let califacilFastScan: Awaited<ReturnType<typeof runFastWarpedScan>> | null = null;
      let zipPreviewMeta: Pick<OmrScanMetaResult, 'geometry' | 'picks'> | null = null;
      let scanCanvas: HTMLCanvasElement = warped;
      let displayCanvas: HTMLCanvasElement = warped;

      if (sheetKind === 'califacil') {
        califacilFastScan = await runFastWarpedScan(warped, alignment);
        scanCanvas = califacilFastScan.docCanvas;
        displayCanvas = califacilFastScan.displayCanvas;
        // Preview debe ser hoja carta enderezada (no foto cruda del monitor/mesa).
        if (
          !isCalifacilWarpedLetterCanvas(displayCanvas) &&
          isCalifacilWarpedLetterCanvas(warped)
        ) {
          displayCanvas =
            prepareMobileScannedDocumentCanvasFast(warped, { skipPrintCrop: false }) ?? warped;
        }
        if (califacilFastScan.rejectedCorners) {
          clearPreview();
          const corners = countCalifacilCornerMarkers(warped);
          const glareLikely = corners >= 2 && corners < 4;
          toast.error(
            glareLikely
              ? 'Mejora la luz y evita el brillo en las esquinas. Luego centra de nuevo.'
              : 'Centra la hoja: 3 esquinas + franjas laterales, o las 4 esquinas negras.'
          );
          setLiveStatus(
            glareLikely
              ? 'Reduce el brillo arriba y acerca las esquinas negras.'
              : 'Centra la hoja: 3 esquinas + franjas laterales, o las 4.'
          );
          if (video) resumeLiveVideoAfterScan(video);
          return;
        }
        // Sustituir freeze crudo por hoja sola lo antes posible.
        const letterFreeze = canvasPreviewDataUrl(displayCanvas, 900, 0.7);
        if (letterFreeze) setMobileScanPreviewUrl(letterFreeze);
      } else {
        const zgPreview = scanZipGradeAnswerSheet(warped, omrCols, chunkRows);
        zipPreviewMeta = { picks: zgPreview.picks, geometry: zgPreview.geometry };
        scanCanvas = warped;
        displayCanvas = warped;
      }

      const hasOmr =
        sheetKind === 'califacil'
          ? Boolean(
              califacilFastScan?.meta?.geometry ||
                califacilFastScan?.meta?.picks.some((p) => p != null)
            )
          : Boolean(zipPreviewMeta?.geometry || zipPreviewMeta?.picks.some((p) => p != null));

      // Con lectura OMR válida: ir directo al popup (sin review manual).
      if (sheetKind === 'califacil' && !hasOmr) {
        clearPreview();
        toast.error('No se pudo leer las burbujas. Encuadra de nuevo e intenta otra vez.');
        setLiveStatus('No se leyó la tabla. Vuelve a capturar.');
        if (video) resumeLiveVideoAfterScan(video);
        return;
      }

      // Sin preview JPEG bloqueante: ir directo a finalize → popup.
      // El preview del modal se genera ligero dentro de finalizeCapturedSheet.

      let readingOverride: CalifacilOmrReadingResult | undefined;
      let mobileDisplaySource: HTMLCanvasElement = displayCanvas;
      if (sheetKind === 'zipgrade' && zipPreviewMeta) {
        const zgRows = Array.from({ length: chunkRows }, () => ({
          pick: null as number | null,
          ambiguous: false,
          inkFractions: [] as number[],
        }));
        readingOverride = buildCalifacilOmrReadingOverride(
          {
            picks: zipPreviewMeta.picks,
            rows: zgRows,
            needsVisionAssist: false,
            maxSameColumnCount: 0,
            geometry: zipPreviewMeta.geometry,
            reviewSourceCanvas: displayCanvas,
            controlNumberDigits: [],
            controlNumber: null,
          },
          chunk,
          scanCanvas,
          liveLockedAnswersRef.current,
          alignment
        );
      } else if (sheetKind === 'califacil' && califacilFastScan?.meta) {
        const warpMeta = califacilFastScan.meta;
        // Siempre override tras el pase móvil (strip recovery ya incluido si era débil).
        // Preview = scanCanvas (referencia) cuando el align es válido — paridad desktop.
        const resolved = resolveMobileGradeDisplay(
          displayCanvas,
          scanCanvas,
          omrCols,
          omrRowCount,
          warpMeta
        );
        mobileDisplaySource = resolved.previewCanvas;
        readingOverride = buildCalifacilOmrReadingOverride(
          {
            ...warpMeta,
            reviewSourceCanvas: resolved.previewCanvas,
            geometry: resolved.geometry,
          },
          chunk,
          scanCanvas,
          liveLockedAnswersRef.current,
          alignment
        );
      }

      const result = await finalizeCapturedSheet(scanCanvas, undefined, {
        preWarped: true,
        warpAlignment: alignment,
        skipReviewUi: true,
        skipSheetValidation: true,
        displaySource: mobileDisplaySource,
        readingOverride,
      });
      if (result.success) {
        setMobileScanPreviewUrl(null);
        setMobileScanPreviewGeometry(null);
        setMobileScanPreviewPicks([]);
        setMobileScanPreviewOrangeFrame(null);
        playScanCompleteChime();
        return;
      }

      clearPreview();
      toast.error('No se pudo calificar esta captura. Intenta escanear de nuevo.');
      setLiveStatus('Intenta de nuevo — hoja completa y buena luz.');
      if (video) resumeLiveVideoAfterScan(video);
    },
    [
      clearMobileScanPreviewState,
      finalizeCapturedSheet,
      omrCols,
      omrRowCount,
      runFastWarpedScan,
      setTorchEnabled,
      sheets,
    ]
  );

  const processMobileSheetCapture = useCallback(
    async (
      video: HTMLVideoElement,
      _opts?: { roiQuad?: RoiQuad | null; roiCapture?: MobileGuideRoiCapture | null }
    ) => {
      playAutoCaptureClickSound();
      // Frame fresco del sensor (sin sleep largo).
      await new Promise<void>((resolve) => {
        const v = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        if (typeof v.requestVideoFrameCallback === 'function') {
          v.requestVideoFrameCallback(() => resolve());
          return;
        }
        window.requestAnimationFrame(() => resolve());
      });
      const fullCanvas = captureVideoFullFrame(video, { maxSide: MOBILE_CAPTURE_MAX_SIDE });
      if (!fullCanvas) {
        clearMobileScanPreview(video, mobileScanPreviewSetters);
        toast.error('No se pudo escanear. Intenta de nuevo.');
        setLiveStatus('Error de escaneo. Pulsa Capturar de nuevo.');
        return;
      }

      // Freeze inmediato: evita pantalla negra mientras califica.
      const freezeUrl = canvasPreviewDataUrl(fullCanvas, 900, 0.62);
      flushSync(() => {
        if (freezeUrl) setMobileScanPreviewUrl(freezeUrl);
        setMobileScanPreviewGeometry(null);
        setMobileScanPreviewPicks([]);
        setMobileScanPreviewOrangeFrame(null);
        setLiveStatus('Calificando…');
      });
      await yieldForSpinnerPaint();

      // Un solo frame: detectar quad sobre el canvas capturado (nunca smoothed del live).
      const frameQuad =
        detectMobileLiveSheetQuad(fullCanvas) ??
        detectAnswerSheetQuadViaAlignStrips(fullCanvas) ??
        detectLargestQuadInRoiCanvas(fullCanvas);

      await processMobileCapturedCanvas(fullCanvas, video, { frameQuad });
    },
    [processMobileCapturedCanvas, mobileScanPreviewSetters]
  );

  const retakeMobileCaptureReview = useCallback(() => {
    reviewScanGenRef.current += 1;
    autoFinalizeTokenRef.current += 1;
    mobileReviewOpenRef.current = false;
    setMobileCaptureReview(null);
    setMobileReviewAlign(null);
    setReviewScanning(false);
    setReviewStatus(null);
    setLiveStatus('Coloca el documento en el visor y pulsa el botón blanco');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (streamRef.current) {
          void (async () => {
            await attachStreamToVideo();
            updateLiveVideoLayout();
            await applyFlashMode(flashModeRef.current);
          })();
        } else if (useLiveCameraUi && phaseRef.current === 'capturar') {
          void startLiveCamera({ skipPhaseGuard: true });
        }
      });
    });
  }, [applyFlashMode, attachStreamToVideo, useLiveCameraUi, startLiveCamera, updateLiveVideoLayout]);

  const previewMobileCaptureAlignment = useCallback(
    async (warped: HTMLCanvasElement, alignment: WarpAlignmentReport | null) => {
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) {
        setReviewStatus('No hay preguntas en esta hoja.');
        toast.error('No hay preguntas en esta hoja.');
        return;
      }
      const scanGen = ++reviewScanGenRef.current;
      flushSync(() => {
        setReviewScanning(true);
        setReviewStatus('Leyendo respuestas…');
      });
      try {
        if (scanGen !== reviewScanGenRef.current) return;
        const controlRead = readAnswerSheetControlNumberFromCanvas(warped, omrRowCount);
        applyControlNumberFromRead(controlRead, { silent: true });
        const { meta, orangeFrameNorm, displayCanvas, docCanvas, rejectedCorners } =
          await runFastWarpedScan(warped, alignment);
        if (scanGen !== reviewScanGenRef.current) return;
        if (rejectedCorners || !meta) {
          setReviewStatus('Centra la hoja: 3 esquinas + franjas laterales, o las 4.');
          toast.error('Centra la hoja: 3 esquinas + franjas laterales, o las 4 esquinas negras.');
          return;
        }
        const mapped = mapRawToDraft([...meta.picks], chunk);
        const { previewCanvas, geometry } = resolveMobileGradeDisplay(
          displayCanvas,
          docCanvas,
          omrCols,
          omrRowCount,
          meta
        );
        const previewUrl =
          canvasPreviewDataUrl(previewCanvas, 2200, MOBILE_PREVIEW_JPEG_QUALITY) ?? '';
        setMobileReviewAlign({
          warped,
          alignment,
          geometry,
          picks: [...meta.picks],
          draft: mapped.draft,
          previewUrl,
          orangeFrameNorm: orangeFrameNorm!,
        });
        setReviewStatus(null);
      } catch {
        if (scanGen !== reviewScanGenRef.current) return;
        setReviewStatus('Error al leer la hoja. Intenta Ajustar las esquinas.');
        toast.error('No se pudo leer la hoja. Intenta ajustar las esquinas.');
      } finally {
        if (scanGen === reviewScanGenRef.current) setReviewScanning(false);
      }
    },
    [
      applyControlNumberFromRead,
      examVirtualKeyByQuestionId,
      mapRawToDraft,
      omrCols,
      omrRowCount,
      questions,
      runFastWarpedScan,
      sheets,
    ]
  );

  previewMobileCaptureAlignmentRef.current = previewMobileCaptureAlignment;

  const realignMobileCaptureOrangeFrame = useCallback(
    async (frame: OmrNormRect) => {
      if (!mobileReviewAlign) return;
      autoFinalizeTokenRef.current += 1;
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) return;
      const scanGen = ++reviewScanGenRef.current;
      setReviewScanning(true);
      setReviewStatus('Actualizando lectura…');
      try {
        if (scanGen !== reviewScanGenRef.current) return;
        const { meta, orangeFrameNorm, displayCanvas, docCanvas, rejectedCorners } =
          await runFastWarpedScan(mobileReviewAlign.warped, mobileReviewAlign.alignment);
        if (scanGen !== reviewScanGenRef.current) return;
        if (rejectedCorners || !meta) {
          setReviewStatus('Centra la hoja: 3 esquinas + franjas laterales, o las 4.');
          return;
        }
        const mapped = mapRawToDraft([...meta.picks], chunk);
        const { previewCanvas, geometry } = resolveMobileGradeDisplay(
          displayCanvas,
          docCanvas,
          omrCols,
          omrRowCount,
          meta
        );
        const previewUrl =
          canvasPreviewDataUrl(previewCanvas, 2200, MOBILE_PREVIEW_JPEG_QUALITY) ??
          mobileReviewAlign.previewUrl;
        setMobileReviewAlign({
          ...mobileReviewAlign,
          geometry,
          picks: [...meta.picks],
          draft: mapped.draft,
          previewUrl,
          // Conserva el marco que movió el usuario para la UI; la lectura es unified.
          orangeFrameNorm: frame ?? orangeFrameNorm,
        });
        setReviewStatus(null);
      } catch {
        if (scanGen !== reviewScanGenRef.current) return;
        setReviewStatus('Error al releer. Intenta mover el marco de nuevo.');
      } finally {
        if (scanGen === reviewScanGenRef.current) setReviewScanning(false);
      }
    },
    [mapRawToDraft, mobileReviewAlign, omrCols, omrRowCount, runFastWarpedScan, sheets]
  );

  const finalizeMobileReviewGrade = useCallback(async () => {
    if (!mobileReviewAlign) return;
    autoFinalizeTokenRef.current += 1;
    setReviewScanning(true);
    setReviewStatus('Calificando…');
    try {
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) {
        setReviewStatus('No hay preguntas en esta hoja.');
        return;
      }
      const { meta, docCanvas, displayCanvas, rejectedCorners } = await runFastWarpedScan(
        mobileReviewAlign.warped,
        mobileReviewAlign.alignment
      );
      if (rejectedCorners || !meta) {
        setReviewStatus('Centra la hoja: 3 esquinas + franjas laterales, o las 4.');
        toast.error('Centra la hoja: 3 esquinas + franjas laterales, o las 4 esquinas negras.');
        return;
      }
      const resolved = resolveMobileGradeDisplay(
        displayCanvas,
        docCanvas,
        omrCols,
        omrRowCount,
        meta
      );
      const readingOverride = buildCalifacilOmrReadingOverride(
        {
          ...meta,
          reviewSourceCanvas: resolved.previewCanvas,
          geometry: resolved.geometry,
        },
        chunk,
        docCanvas,
        liveLockedAnswersRef.current,
        mobileReviewAlign.alignment
      );
      const result = await finalizeCapturedSheet(docCanvas, undefined, {
        preWarped: true,
        warpAlignment: mobileReviewAlign.alignment,
        skipReviewUi: true,
        skipSheetValidation: true,
        displaySource: resolved.previewCanvas,
        readingOverride,
      });
      if (result.success) {
        playScanCompleteChime();
        mobileReviewOpenRef.current = false;
        setMobileCaptureReview(null);
        setMobileReviewAlign(null);
        setReviewStatus(null);
      } else {
        setReviewStatus('No se pudo calificar. Ajusta el encuadre e intenta de nuevo.');
        toast.error('No se pudo calificar. Ajusta el encuadre e intenta de nuevo.');
      }
    } finally {
      setReviewScanning(false);
    }
  }, [finalizeCapturedSheet, mobileReviewAlign, omrCols, omrRowCount, runFastWarpedScan, sheets]);

  finalizeMobileReviewGradeRef.current = finalizeMobileReviewGrade;

  const backFromMobileReviewAlign = useCallback(() => {
    reviewScanGenRef.current += 1;
    setMobileReviewAlign(null);
    setReviewScanning(false);
    setReviewStatus(null);
  }, []);

  const triggerMobileSheetCapture = useCallback(
    (
      video: HTMLVideoElement,
      opts?: { roiQuad?: RoiQuad | null; roiCapture?: MobileGuideRoiCapture | null }
    ) => {
      if (mobileCaptureBusyRef.current) return;
      mobileCaptureBusyRef.current = true;
      flushSync(() => {
        setScanBusy(true);
        setLiveStatus('Calificando…');
      });
      setLiveFilterMenuOpen(false);
      void (async () => {
        try {
          await processMobileSheetCapture(video, opts);
        } catch {
          toast.error('Error al escanear. Intenta de nuevo.');
          setLiveStatus('Error al escanear. Pulsa Capturar de nuevo.');
          clearMobileScanPreview(video, mobileScanPreviewSetters);
        } finally {
          mobileCaptureBusyRef.current = false;
          autoCaptureTriggeredRef.current = false;
          setScanBusy(false);
        }
      })();
    },
    [processMobileSheetCapture, mobileScanPreviewSetters]
  );

  triggerMobileSheetCaptureRef.current = triggerMobileSheetCapture;

  useEffect(() => {
    if (!scanBusy) return;
    const timeout = window.setTimeout(() => {
      if (mobileCaptureBusyRef.current) {
        mobileCaptureBusyRef.current = false;
        autoCaptureTriggeredRef.current = false;
        gradeReadGenRef.current += 1;
        gradeReadAbortRef.current?.abort();
        gradeReadAbortRef.current = null;
        setScanBusy(false);
        toast.error('La captura tardó demasiado. Pulsa Capturar de nuevo.');
        setLiveStatus('Tiempo agotado. Pulsa Capturar de nuevo.');
        return;
      }
      // Desktop JPG/PDF: cancelar lectura colgada en «Leyendo…».
      gradeReadGenRef.current += 1;
      gradeReadAbortRef.current?.abort();
      gradeReadAbortRef.current = null;
      setScanBusy(false);
      setLiveStatus('');
      toast.error('La lectura tardó demasiado. Prueba con un PDF o una foto más nítida.');
    }, 30000);
    return () => window.clearTimeout(timeout);
  }, [scanBusy]);

  const captureMobilePhotoManually = useCallback(async () => {
    const gate = mobileCaptureGateRef.current;
    if (
      !isMobileExamSheetReadyForCapture({
        fiducialCount: gate.fiducialCount,
        fiducialCorners: gate.fiducialCorners,
        stripAligned: gate.stripAligned,
        quad: gate.quad,
        roiW: gate.roiW,
        roiH: gate.roiH,
        fillRatio: gate.fillRatio,
        roiCanvas: gate.roiCanvas,
      })
    ) {
      toast.error('Encuadra el examen completo (franjas laterales y esquinas negras visibles) antes de capturar.');
      return;
    }

    let video = videoRef.current;
    if (!video || !streamRef.current) {
      toast.error('Cámara no disponible.');
      return;
    }

    if (video.videoWidth < 40 || video.readyState < 2) {
      await attachStreamToVideo();
      for (let attempt = 0; attempt < 10; attempt++) {
        video = videoRef.current;
        if (video && video.videoWidth >= 40 && video.readyState >= 2) break;
        await sleep(100);
      }
    }

    if (!video || video.videoWidth < 40) {
      toast.error('La cámara aún está iniciando. Espera un segundo y vuelve a pulsar Capturar.');
      return;
    }

    autoCaptureTriggeredRef.current = false;
    mobileCaptureBusyRef.current = false;
    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 220);
    try {
      playAutoCaptureClickSound();
    } catch {
      /* audio opcional */
    }
    triggerMobileSheetCapture(video, {
      roiQuad: gate.quad ?? smoothedRoiQuadRef.current ?? lastRoiQuadRef.current,
      roiCapture: lastRoiCaptureMetaRef.current,
    });
  }, [attachStreamToVideo, triggerMobileSheetCapture]);

  const handleScannerClose = useCallback(() => {
    stopLiveCamera();
    setCameraPermissionPhase('granted');
    setPhase('elegir');
  }, [stopLiveCamera]);

  const handleScannerChangeExam = useCallback(() => {
    stopLiveCamera();
    setPhase('elegir');
  }, [stopLiveCamera]);

  scannerActionsRef.current = {
    capture: () => {
      void captureMobilePhotoManually();
    },
    flash: () => {
      void cycleFlashMode();
    },
    changeExam: handleScannerChangeExam,
    gallery: () => {
      galleryInputRef.current?.click();
    },
    close: handleScannerClose,
  };

  const switchToAnotherStudentScan = useCallback(() => {
    stopLiveCamera();
    clearMobileSnapshots();
    setMobileResultsDraft({});
    setResultsSheetIdx(0);
    setReviewQualityHint(null);
    setSelectedStudentId(CALIFICAR_AUTO_STUDENT_ID);
    setDetectedControlNumber(null);
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    confirmedAnswersRef.current = {};
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    stablePartialTicksRef.current = 0;
    liveLockedAnswersRef.current = {};
    liveReadingStreakRef.current = {};
    strictValidationTicksRef.current = 0;
    lastQualityProbeRef.current = null;
    setReviewOmrGeometry(null);
    setReviewOmrPicks([]);
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setLiveStatus(
      isMobile
        ? 'Elige el examen y pulsa «Calificar»; detectamos al alumno en la hoja.'
        : 'Sube una imagen escaneada para leer respuestas.'
    );
    toast.message('Listo para calificar otro alumno.');
  }, [isMobile, stopLiveCamera, clearMobileSnapshots]);

  const exportCurrentZipGradeCsv = useCallback(() => {
    const sheet = currentZipGradeSheet;
    if (!sheet || !exam) {
      toast.error('No hay resultados para exportar.');
      return;
    }
    const snap = mobileSheetSnapshots[resultsSheetIdx];
    const chunk = snap ? (sheets[snap.sheetIndex] ?? []) : [];
    const labels = chunk.map((_, i) => `Pregunta ${i + 1}`);
    const studentAnswers = chunk.map(
      (q) => mobileResultsDraft[q.id]?.trim() ?? snap?.selectionsByQuestionId[q.id]?.trim() ?? ''
    );
    const keyAnswers = chunk.map((q) => examVirtualKeyByQuestionId[q.id]?.trim() ?? '');
    const correctFlags = chunk.map((q, i) => {
      const expectedIndex = virtualKeyCorrectIndexByQuestionId[q.id];
      if (expectedIndex === undefined) return false;
      const draft = studentAnswers[i] ?? '';
      const studentPick = snap?.columnPicks[i] ?? resolveStudentPickIndex(q.options, draft);
      return isMcPickCorrect(expectedIndex, studentPick, q.options, draft);
    });
    downloadCalificacionCsv({
      examTitle: exam.title,
      studentName: selectedStudentName || 'Sin alumno',
      controlNumber: detectedControlNumber,
      questionLabels: labels,
      studentAnswers,
      keyAnswers,
      correctFlags,
      score: { correct: sheet.correct, total: sheet.total, pct: sheet.pct },
    });
    toast.success('Reporte CSV descargado.');
  }, [
    currentZipGradeSheet,
    exam,
    mobileSheetSnapshots,
    resultsSheetIdx,
    sheets,
    mobileResultsDraft,
    virtualKeyMaps,
    virtualKeyCorrectIndexByQuestionId,
    selectedStudentName,
    detectedControlNumber,
  ]);

  const exitMobileResultsView = useCallback(() => {
    // «Calificar otro examen»: volver a la cámara de inmediato (mismo examen / siguiente hoja).
    setZipGradeModalOpen(false);
    setZipGradeReviewOpen(false);
    setZipGradeStudentPickerOpen(false);
    openMobileCapture();
  }, [openMobileCapture]);

  useEffect(() => {
    const immersive =
      isMobile &&
      (phase === 'capturar' ||
        mobileCaptureReview !== null ||
        zipGradeReviewOpen ||
        zipGradeModalOpen ||
        (phase === 'ver_resultados' && (zipGradeModalOpen || zipGradeReviewOpen)));
    document.documentElement.classList.toggle('calificar-immersive', immersive);
    return () => {
      document.documentElement.classList.remove('calificar-immersive');
    };
  }, [
    isMobile,
    phase,
    mobileCaptureReview,
    zipGradeReviewOpen,
    zipGradeModalOpen,
  ]);

  const scannerPortalOpen =
    useLiveCameraUi &&
    phase === 'capturar' &&
    mobileCaptureReview === null &&
    Boolean(exam) &&
    cameraPortalReady;

  useEffect(() => {
    document.documentElement.classList.toggle('calificar-scanner-open', scannerPortalOpen);
    return () => {
      document.documentElement.classList.remove('calificar-scanner-open');
    };
  }, [scannerPortalOpen]);

  if (!user) return null;

  return (
    <div
      className={cn(
        'mx-auto flex min-h-full w-full max-w-7xl flex-col gap-3 pb-6 sm:gap-4 sm:pb-8',
        isMobile && 'max-w-none gap-0 pb-0 lg:gap-3 lg:pb-8',
        isMobile && phase === 'elegir' && 'lg:bg-transparent'
      )}
    >
      <Dialog open={autoGradeDialogOpen} onOpenChange={setAutoGradeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {autoGradePersisted ? 'Calificación guardada' : 'Resultado del examen'}
            </DialogTitle>
            <DialogDescription>
              {autoGradePersisted
                ? `Resultados para ${selectedStudentName.trim() || 'el alumno seleccionado'}.`
                : 'Las casillas sin marcar se consideraron respuestas incorrectas.'}
            </DialogDescription>
          </DialogHeader>
          {autoGradeStats && (
            <div className="space-y-3 py-2">
              <div className={`text-center text-4xl font-bold ${getGradeColor(autoGradeStats.pct)}`}>
                {autoGradeStats.pct}%
              </div>
              <p className="text-center text-sm text-gray-600">{getGradeLabel(autoGradeStats.pct)}</p>
              <p className="text-center text-sm font-semibold text-gray-800">
                {autoGradeStats.correct}/{autoGradeStats.total} aciertos · {autoGradeStats.pct}%
              </p>
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
            {isMobile ? (
              <>
                <Button
                  type="button"
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    setResultsSheetIdx(0);
                    setPhase('ver_resultados');
                  }}
                >
                  Ver resultados
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-orange-300 text-orange-800 hover:bg-orange-50"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    retakeMobileSheetPhoto(sheetIndexRef.current);
                  }}
                >
                  Tomar otra foto
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    switchToAnotherStudentScan();
                  }}
                >
                  Calificar otro alumno
                </Button>
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
                  variant="ghost"
                  className="w-full text-gray-600"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    router.push('/dashboard');
                  }}
                >
                  Ir al inicio del dashboard
                </Button>
              </>
            ) : (
              <>
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
                    setSelectedStudentId(CALIFICAR_AUTO_STUDENT_ID);
                    setDetectedControlNumber(null);
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
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isMobile && phase === 'elegir' && (
        <CalificarMobileHome
          exams={publishedExams}
          examsLoading={examsLoading}
          examId={examId}
          exam={exam}
          examLoading={examLoading}
          students={sortedStudents}
          selectedStudentId={selectedStudentId}
          selectedStudentName={selectedStudentName}
          detectedControlNumber={detectedControlNumber}
          studentAutoDetect={studentAutoDetect}
          canGradeStudents={canGradeStudents}
          supportsCalifacil={supportsCalifacil}
          virtualKeyReady={virtualKeyReadyCount}
          virtualKeyTotal={virtualKeyMcTotal}
          sheetIndex={sheetIndex}
          totalSheets={totalSheets}
          scanBusy={scanBusy}
          onSelectExam={(id) => {
            setExamId(id);
            resetFlow();
          }}
          onSelectStudent={handleStudentChange}
          onScan={openMobileCapture}
          onImportPhoto={() => galleryInputRef.current?.click()}
        />
      )}

      {isMobile ? (
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-hidden
          onChange={handleGalleryFile}
        />
      ) : (
        <>
          <input
            ref={galleryInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-hidden
            onChange={handleGalleryFile}
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            aria-hidden
            onChange={handlePdfFile}
          />
        </>
      )}

      <div
        className={cn(
          isMobile && (phase === 'elegir' || phase === 'ver_resultados') && 'hidden lg:block'
        )}
      >
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Calificar</h1>
        <p className="mt-0.5 text-xs text-gray-600 sm:mt-1 sm:text-sm">
          {isMobile
            ? 'Cámara a pantalla completa: encuadra toda la hoja impresa. Captura automática al detectar respuestas, o pulsa el botón naranja.'
            : 'En ordenador sube exámenes escaneados (JPG, PNG o PDF) para leer la tabla CaliFacil y calificar automáticamente.'}
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-1 pb-2 sm:pb-3">
          <CardTitle className="text-base sm:text-lg">Examen y clave automática</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4">
          <div className="space-y-2">
            <Label>Examen</Label>
            <Select
              value={examId ? examId : SELECT_NO_EXAM}
              onValueChange={(v) => {
                if (v === SELECT_NO_EXAM) return;
                setExamId(v);
                resetFlow();
              }}
              disabled={examsLoading || phase === 'guardando' || (isMobile && phase === 'ver_resultados')}
            >
              <SelectTrigger>
                <SelectValue placeholder={examsLoading ? 'Cargando…' : 'Elige un examen'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_NO_EXAM}>Elige un examen publicado</SelectItem>
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

          {exam && supportsCalifacil && totalSheets > 1 && (
            <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <Info className="h-5 w-5 shrink-0" />
              Este examen tiene {questions.length} preguntas en {totalSheets} hojas. Escanea cada hoja
              por separado ({CALIFACIL_PRINT_MAX_QUESTIONS} preguntas por hoja).
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
              {exam && supportsCalifacil && (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    canGradeStudents
                      ? 'border-green-200 bg-green-50 text-green-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {canGradeStudents ? (
                    <>Clave automática activa: {virtualKeyReadyCount}/{virtualKeyMcTotal} reactivos listos.</>
                  ) : (
                    <>
                      La clave automática del examen está incompleta. Revisa las preguntas para que cada reactivo
                      tenga una respuesta correcta válida dentro de sus opciones.
                    </>
                  )}
                </div>
              )}

              {exam && supportsCalifacil && canGradeStudents && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-orange-300 text-orange-900 hover:bg-orange-50"
                    onClick={() => setVirtualKeyTableDialogOpen(true)}
                  >
                    Ver tabla clave
                  </Button>
                </div>
              )}

              {!isMobile && exam && supportsCalifacil && canGradeStudents && (
                <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/90 p-4">
                  <p className="text-sm text-gray-700">
                    Sube el escaneo de la hoja de respuestas en <strong>imagen</strong> o{' '}
                    <strong>PDF</strong> (una página por hoja del examen).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="bg-orange-600 hover:bg-orange-700"
                      disabled={scanBusy}
                      onClick={() => galleryInputRef.current?.click()}
                    >
                      {scanBusy ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                          Leyendo examen…
                        </>
                      ) : (
                        'Elegir imagen…'
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-orange-300 text-orange-900 hover:bg-orange-50"
                      disabled={scanBusy}
                      onClick={() => pdfInputRef.current?.click()}
                    >
                      <FileUp className="mr-2 h-4 w-4" aria-hidden />
                      Subir PDF…
                    </Button>
                  </div>
                  {scanBusy && liveStatus ? (
                    <p className="text-xs font-medium text-orange-800">{liveStatus}</p>
                  ) : null}
                </div>
              )}

              <Dialog open={virtualKeyTableDialogOpen} onOpenChange={setVirtualKeyTableDialogOpen}>
                <DialogContent className="max-h-[min(90vh,720px)] max-w-lg gap-0 overflow-y-auto p-4 sm:p-6">
                  <DialogHeader>
                    <DialogTitle>Tabla clave automática</DialogTitle>
                    <DialogDescription className="sr-only">
                      Respuestas correctas del examen por hoja, tal como se comparan al calificar.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 space-y-3">
                    {sheets.map((chunk, chunkIdx) => (
                      <div key={`key-sheet-dlg-${chunkIdx}`} className="rounded-md border border-orange-200 bg-orange-50/30 p-2">
                        <p className="mb-2 text-xs font-medium text-gray-700">
                          Hoja {chunkIdx + 1} ({chunk.length} reactivos)
                        </p>
                        <div className="w-full">
                          <table className="w-full table-fixed border-collapse text-[10px] sm:text-xs">
                            <thead>
                              <tr>
                                <th className="w-8 border border-gray-300 bg-gray-100 px-1 py-1 text-right sm:w-12 sm:px-2">
                                  N.º
                                </th>
                                {Array.from({ length: omrCols }, (_, c) => (
                                  <th
                                    key={`dlg-head-${chunkIdx}-${c}`}
                                    className="border border-gray-300 bg-gray-100 px-1 py-1 text-center sm:px-2"
                                  >
                                    {String.fromCharCode(65 + c)}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {chunk.map((q, rowIdx) => {
                                const expectedIndex = virtualKeyCorrectIndexByQuestionId[q.id] ?? -1;
                                const qNum = chunkIdx * 10 + rowIdx + 1;
                                return (
                                  <tr key={`dlg-${q.id}`}>
                                    <td className="border border-gray-300 bg-gray-50 px-1 py-1 text-right font-semibold sm:px-2">
                                      {qNum}
                                    </td>
                                    {Array.from({ length: omrCols }, (_, c) => (
                                      <td
                                        key={`dlg-${q.id}-${c}`}
                                        className="border border-gray-300 px-1 py-1 text-center sm:px-2"
                                      >
                                        <span
                                          className={`inline-block h-3 w-3 rounded-[2px] border sm:h-4 sm:w-4 ${
                                            c === expectedIndex
                                              ? 'border-orange-600 bg-orange-500'
                                              : 'border-gray-500 bg-white'
                                          }`}
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>

              <div className="space-y-2">
                <Label htmlFor="calif-alumno">Alumno</Label>
                <StudentCombobox
                  id="calif-alumno"
                  students={sortedStudents}
                  value={selectedStudentId}
                  onValueChange={handleStudentChange}
                  disabled={
                    phase === 'guardando' || (isMobile && phase === 'ver_resultados') || !canGradeStudents
                  }
                  autoOptionValue={CALIFICAR_AUTO_STUDENT_ID}
                  autoOptionLabel="Automático (detectar en la hoja)"
                  placeholder="Automático (detectar en la hoja)"
                  searchPlaceholder="Escribe para buscar…"
                  emptyText="Ningún alumno coincide."
                  noStudentsText={
                    exam && allowedGroupIds.length === 0
                      ? 'Este examen no tiene grupo asignado. Asigna un grupo al examen y registra alumnos en Grupos.'
                      : undefined
                  }
                />
                {detectedControlNumber ? (
                  <p className="text-xs text-green-700">
                    N.º de control leído: <strong>{detectedControlNumber}</strong>
                    {selectedStudentName ? ` — ${selectedStudentName}` : ''}
                  </p>
                ) : null}
                <p className="text-xs text-gray-500">
                  {canGradeStudents
                    ? studentAutoDetect
                      ? 'Por defecto CaliFacil identifica al alumno al escanear la hoja personalizada. También puedes elegirlo manualmente.'
                      : 'Alumno fijado manualmente antes de calificar.'
                    : 'Bloqueado: el examen necesita respuestas correctas válidas para generar la clave automática.'}
                </p>
              </div>

              {isMobile && canGradeStudents && examId && phase === 'elegir' && (
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/90 p-3">
                  <p className="text-sm font-medium text-orange-950">
                    Listo para hoja {sheetIndex + 1} de {totalSheets}
                  </p>
                  <p className="text-xs text-orange-900/90">
                    {studentAutoDetect ? (
                      <>
                        Pulsa <strong>Tomar foto</strong>, encuadra la hoja personalizada del alumno.
                        CaliFacil detecta quién es y califica al instante.
                      </>
                    ) : (
                      <>
                        Pulsa <strong>Tomar foto</strong>, encuadra la hoja con las franjas negras visibles.
                        CaliFacil captura sola, lee las respuestas y muestra el resultado al momento.
                      </>
                    )}
                  </p>
                  <Button
                    type="button"
                    className="w-full bg-orange-600 hover:bg-orange-700"
                    disabled={scanBusy || examLoading || !exam || !supportsCalifacil}
                    onClick={openMobileCapture}
                  >
                    Tomar foto
                  </Button>
                </div>
              )}
            </>
          )}

        </CardContent>
      </Card>
      </div>

      {scannerPortalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <ExamScannerScreen
              shellRef={mobileCameraShellRef}
              viewportRef={mobileVideoViewportRef}
              videoRef={videoRef}
              actionsRef={scannerActionsRef}
              cameraOpen={cameraOpen}
              cameraPermissionPhase={cameraPermissionPhase}
              onRequestCamera={requestCameraFromGate}
              scanBusy={scanBusy}
              shutterFlash={shutterFlash}
              examTitle={
                totalSheets > 1
                  ? `${exam!.title} · Hoja ${sheetIndex + 1}/${totalSheets}`
                  : exam!.title
              }
              documentPolygon={mobileDocumentPolygon}
              guideRect={staticScannerGuideRect}
              aligned={mobileAlignedForCapture && cornersAlignedView}
              stableProgress={
                mobileExamReadyForCapture
                  ? Math.min(1, mobileStableTicks / MOBILE_CAPTURE_STABLE_TICKS_REQUIRED)
                  : 0
              }
              lowLight={mobileScannerLowLight}
              cameraFullscreenMode={cameraFullscreenMode}
              flashMode={flashMode}
              flashOn={flashOn}
              flashSupported={flashSupported}
              onVideoMount={bindVideoElement}
              captureReady={mobileAlignedForCapture}
              fiducialCount={mobileFiducialCount}
              fiducialCorners={mobileFiducialCorners}
              stripAligned={mobileStripAligned}
              scanPreviewUrl={mobileScanPreviewUrl}
              scanPreviewOrangeFrame={mobileScanPreviewOrangeFrame}
              scanPreviewOverlay={
                mobileScanPreviewGeometry ? (
                  <CalifacilOmrReviewOverlay
                    geometry={mobileScanPreviewGeometry}
                    picks={mobileScanPreviewPicks}
                    expectedPicks={expectedChunkPicks}
                    rowCount={currentChunk.length}
                  />
                ) : null
              }
              scanStatusLabel="Calificando…"
              onRetryCamera={() => {
                setCameraPermissionPhase('requesting');
                void startLiveCamera({ skipPhaseGuard: true }).then((ok) => {
                  setCameraPermissionPhase(ok ? 'granted' : 'denied');
                });
              }}
            />
          </>,
          document.body
        )}

      {mobileCaptureReview &&
        typeof document !== 'undefined' &&
        createPortal(
          <MobileSheetScanReview
            sourceCanvas={mobileCaptureReview.sourceCanvas}
            frameQuad={mobileCaptureReview.frameQuad}
            initialWarped={mobileCaptureReview.warped}
            initialAlignment={mobileCaptureReview.alignment}
            rowCount={omrRowCount}
            columnCount={omrCols}
            alignPreview={mobileAlignPreviewProp}
            alignOrangeFrame={mobileReviewAlign?.orangeFrameNorm ?? null}
            scanning={reviewScanning}
            statusMessage={reviewStatus}
            onRetake={retakeMobileCaptureReview}
            onPreviewAlignment={previewMobileCaptureAlignment}
            onRealignOrangeFrame={realignMobileCaptureOrangeFrame}
            onFinalizeGrade={() => void finalizeMobileReviewGrade()}
            onBackFromAlign={backFromMobileReviewAlign}
            detectedControlNumber={detectedControlNumber}
            identifiedStudentName={selectedStudentName}
          />,
          document.body
        )}

      {((phase === 'revisar_hoja') || (phase === 'capturar' && !useLiveCameraUi)) && exam && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Hoja de alumno {sheetIndex + 1} de {totalSheets}
            </CardTitle>
            <CardDescription>
              Preguntas {chunkQuestionOffset + 1}–{chunkQuestionOffset + currentChunk.length} ·{' '}
              {totalSheets > 1 ? `Hoja ${sheetIndex + 1} de ${totalSheets} · ` : ''}
              {isMobile
                ? 'Encuadra toda la hoja dentro de la pantalla; debe verse la tabla de respuestas al pie.'
                : 'Puedes pasar foto de la hoja completa o solo del pie: debe verse entera la tabla (N.º, A–D) y las marcas.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {phase === 'capturar' && (
              <div className="space-y-3">
                <div className="space-y-3">
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/90 p-6 text-center">
                    <p className="text-sm text-gray-700">
                      Sube una foto de la <strong>hoja impresa completa</strong> (como la que genera
                      CaliFácil con preguntas y tabla al pie), un recorte del recuadro CaliFacil, o un{' '}
                      <strong>PDF</strong> escaneado. Se leen las casillas A–D y al guardar se califica
                      comparando con la clave del examen.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button
                        type="button"
                        className={cn(
                          'bg-orange-600 hover:bg-orange-700',
                          scanBusy && 'disabled:opacity-100'
                        )}
                        disabled={scanBusy}
                        onClick={() => galleryInputRef.current?.click()}
                      >
                        {scanBusy ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none [animation-duration:750ms]"
                              aria-hidden
                            />
                            Leyendo examen…
                          </>
                        ) : (
                          'Elegir imagen…'
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-orange-300 text-orange-900 hover:bg-orange-50"
                        disabled={scanBusy}
                        onClick={() => pdfInputRef.current?.click()}
                      >
                        <FileUp className="mr-2 h-4 w-4" aria-hidden />
                        Subir PDF…
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {previewUrl && phase === 'revisar_hoja' && (
              <div className="space-y-2">
                {reviewOmrGeometry ? (
                  <CalifacilReviewImageStack
                    previewUrl={previewUrl}
                    alt="Vista previa del examen escaneado"
                    geometry={reviewOmrGeometry}
                    overlay={
                      <CalifacilOmrReviewOverlay
                        geometry={reviewOmrGeometry}
                        picks={(() => {
                          const picks = draftSelectionsToColumnPicks(
                            currentChunk,
                            draftSelections
                          );
                          while (picks.length < omrRowCount) picks.push(null);
                          return picks;
                        })()}
                        expectedPicks={(() => {
                          const picks = [...expectedChunkPicks];
                          while (picks.length < omrRowCount) picks.push(null);
                          return picks;
                        })()}
                        expectedOpacity={overlayOpacity / 100}
                        rowCount={omrRowCount}
                        clipRect={null}
                      />
                    }
                  />
                ) : (
                  <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
                    <div className="relative inline-block max-h-96 max-w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="Vista previa del examen escaneado"
                        className="relative z-0 block max-h-96 w-auto max-w-full"
                      />
                    </div>
                  </div>
                )}
                {canGradeStudents && currentChunk.length > 0 ? (
                  <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/95 px-3 py-2 text-center">
                    <div className="text-sm font-semibold text-emerald-950">
                      <span className="tabular-nums">{chunkKeyComparison.correct}</span>
                      <span className="text-emerald-800"> / </span>
                      <span className="tabular-nums">{chunkKeyComparison.total}</span>
                      <span className="mx-1.5 text-emerald-700">·</span>
                      <span className={`tabular-nums ${getGradeColor(chunkKeyComparison.pct)}`}>
                        {chunkKeyComparison.pct}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-emerald-900/85">
                      Coincidencias con la clave del examen en esta hoja. En la foto:{' '}
                      <span className="font-medium text-green-700">verde</span> = acierto,{' '}
                      <span className="font-medium text-red-600">rojo</span> = opción leída incorrecta,{' '}
                      <span className="font-medium text-orange-700">naranja</span> = burbuja correcta esperada,
                      <span className="font-medium text-red-600"> rojo punteado</span> = sin lectura en esa fila.
                    </p>
                    {isMobile ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full border-orange-300 bg-white text-orange-800 hover:bg-orange-50"
                        onClick={() => retakeMobileSheetPhoto(sheetIndex)}
                      >
                        Tomar otra foto
                      </Button>
                    ) : null}
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
                {currentChunk.map((q, idx) => {
                  const globalNum = idx + 1;
                  const opts = q.options ?? [];
                  const val = draftSelections[q.id]?.trim() ?? '';
                  return (
                    <div key={q.id} className="flex flex-col gap-1">
                      <Label className="text-xs text-gray-600">Pregunta {globalNum}</Label>
                      <Select
                        value={val ? val : SELECT_NO_OPTION}
                        onValueChange={(v) => {
                          setDraftSelections((prev) => ({
                            ...prev,
                            [q.id]: v === SELECT_NO_OPTION ? '' : v,
                          }));
                        }}
                      >
                        <SelectTrigger className="w-full max-w-md">
                          <SelectValue placeholder="Elegir opción leída" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SELECT_NO_OPTION}>Elegir opción leída</SelectItem>
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
                      if (isMobile) {
                        retakeMobileSheetPhoto(sheetIndex);
                        return;
                      }
                      setPhase('capturar');
                      clearPendingPdfGrading();
                      setReviewOmrGeometry(null);
                      setReviewOmrPicks([]);
                      setPreviewUrl((u) => {
                        if (u) URL.revokeObjectURL(u);
                        return null;
                      });
                      setDraftSelections({});
                      resetLiveReadings();
                    }}
                  >
                    {useLiveCameraUi ? 'Tomar otra foto' : 'Importar otra imagen'}
                  </Button>
                  <Button
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                    disabled={scanBusy}
                    onClick={() => void confirmCurrentSheet()}
                  >
                    Guardar calificación
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isMobile && phase === 'ver_resultados' && exam && (zipGradeModalOpen || zipGradeReviewOpen || mobileSheetSnapshots.length > 0) && (
        <>
          <MobileZipGradeScanCompleteModal
            open={zipGradeModalOpen && !zipGradeReviewOpen}
            examTitle={exam.title}
            previewUrl={currentZipGradeSheet?.previewUrl}
            sheet={currentZipGradeSheet}
            score={
              currentZipGradeSheet
                ? {
                    correct: currentZipGradeSheet.correct,
                    total: currentZipGradeSheet.total,
                    pct: currentZipGradeSheet.pct,
                  }
                : autoGradeStats ?? { correct: 0, total: 0, pct: 0 }
            }
            nameCropUrl={currentZipGradeSheet?.nameCropUrl}
            studentName={selectedStudentName}
            controlNumber={detectedControlNumber}
            onRetake={() => {
              setZipGradeModalOpen(false);
              retakeMobileSheetPhoto(
                mobileSheetSnapshots[resultsSheetIdx]?.sheetIndex ?? sheetIndex
              );
            }}
            onReview={() => {
              setZipGradeModalOpen(false);
              setZipGradeReviewOpen(true);
            }}
            onAnotherStudent={() => {
              setZipGradeModalOpen(false);
              switchToAnotherStudentScan();
            }}
            onBackToCalificar={exitMobileResultsView}
          />
          <MobileZipGradeReviewScreen
            open={zipGradeReviewOpen}
            examTitle={exam.title}
            sheet={currentZipGradeSheet}
            studentName={selectedStudentName}
            controlNumber={detectedControlNumber}
            sheetIndex={resultsSheetIdx}
            sheetCount={zipGradeSheets.length}
            onBack={() => {
              setZipGradeReviewOpen(false);
              setZipGradeModalOpen(true);
            }}
            onPrevSheet={() => setResultsSheetIdx((i) => Math.max(0, i - 1))}
            onNextSheet={() =>
              setResultsSheetIdx((i) => Math.min(zipGradeSheets.length - 1, i + 1))
            }
            onRetake={() => {
              setZipGradeReviewOpen(false);
              retakeMobileSheetPhoto(
                mobileSheetSnapshots[resultsSheetIdx]?.sheetIndex ?? sheetIndex
              );
            }}
            onSave={() => void saveMobileResultsEdits()}
            onExport={exportCurrentZipGradeCsv}
            onPickStudent={() => setZipGradeStudentPickerOpen(true)}
            questionsContent={
              (() => {
                const snap = mobileSheetSnapshots[resultsSheetIdx];
                const chunk = snap ? (sheets[snap.sheetIndex] ?? []) : [];
                return chunk.map((q, idx) => {
                  const val = mobileResultsDraft[q.id]?.trim() ?? '';
                  const opts = q.options ?? [];
                  return (
                    <div key={q.id} className="rounded-xl bg-white p-3 shadow-sm">
                      <Label className="text-xs font-medium text-gray-500">
                        Pregunta {idx + 1}
                      </Label>
                      <Select
                        value={val ? val : SELECT_NO_OPTION}
                        onValueChange={(v) => {
                          setMobileResultsDraft((prev) => ({
                            ...prev,
                            [q.id]: v === SELECT_NO_OPTION ? '' : v,
                          }));
                        }}
                      >
                        <SelectTrigger className="mt-1.5 w-full">
                          <SelectValue placeholder="Opción leída" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SELECT_NO_OPTION}>Sin lectura</SelectItem>
                          {opts.map((opt, oi) => (
                            <SelectItem key={opt} value={opt}>
                              {String.fromCharCode(65 + oi)}. {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                });
              })()
            }
          />
          <MobileZipGradeStudentPicker
            open={zipGradeStudentPickerOpen}
            students={sortedStudents}
            selectedId={selectedStudentId}
            autoOptionId={CALIFICAR_AUTO_STUDENT_ID}
            autoOptionLabel="Automático (detectar en la hoja)"
            onSelect={handleStudentChange}
            onClose={() => setZipGradeStudentPickerOpen(false)}
          />
        </>
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
