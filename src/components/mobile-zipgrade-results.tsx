'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';
import { CalifacilReviewImageStack } from '@/components/califacil-review-image-stack';
import { Button } from '@/components/ui/button';
import type { Student } from '@/types';

export type ZipGradeSheetData = {
  previewUrl: string;
  nameCropUrl?: string | null;
  geometry: CalifacilOmrScanGeometry;
  picks: (number | null)[];
  expectedPicks: (number | null)[];
  rowCount: number;
  correct: number;
  total: number;
  pct: number;
};

type ScanCompleteModalProps = {
  open: boolean;
  examTitle?: string;
  previewUrl?: string | null;
  sheet?: ZipGradeSheetData | null;
  score: { correct: number; total: number; pct: number };
  nameCropUrl?: string | null;
  studentName?: string;
  controlNumber?: string | null;
  onRetake: () => void;
  onReview: () => void;
  onAnotherStudent: () => void;
  onBackToCalificar: () => void;
};

function SheetPreviewBox({
  previewSrc,
  sheet,
  maxHeight,
  className,
}: {
  previewSrc: string;
  sheet: ZipGradeSheetData;
  maxHeight: string;
  className?: string;
}) {
  return (
    <CalifacilReviewImageStack
      previewUrl={previewSrc}
      alt="Hoja escaneada con clave"
      geometry={sheet.geometry}
      maxHeight={maxHeight}
      className={className}
      frameClassName="mx-auto rounded-md bg-white"
    >
      <CalifacilOmrReviewOverlay
        geometry={sheet.geometry}
        picks={sheet.picks}
        expectedPicks={sheet.expectedPicks}
        rowCount={sheet.rowCount}
      />
    </CalifacilReviewImageStack>
  );
}

export function MobileZipGradeScanCompleteModal({
  open,
  examTitle,
  previewUrl,
  sheet,
  score,
  nameCropUrl,
  studentName,
  controlNumber,
  onRetake,
  onReview: _onReview,
  onAnotherStudent: _onAnotherStudent,
  onBackToCalificar,
}: ScanCompleteModalProps) {
  const showOverlayPreview = Boolean(sheet?.geometry && (sheet.previewUrl || previewUrl));
  const previewSrc = sheet?.previewUrl || previewUrl;

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-orange-50"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="relative z-10 flex shrink-0 items-center justify-between bg-orange-600 px-2 py-2.5 text-white">
        <button
          type="button"
          className="flex min-h-11 min-w-[5.5rem] items-center gap-0.5 px-2 py-1 text-[17px] font-normal active:opacity-70"
          onClick={onBackToCalificar}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Calificar
        </button>
        <span className="min-w-0 flex-1 truncate px-2 text-center text-[13px] font-semibold uppercase tracking-[0.2em] opacity-95">
          {examTitle ? examTitle.slice(0, 22) : 'CaliFácil'}
        </span>
        <span className="w-16 shrink-0" aria-hidden />
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-4 py-4">
        <div
          className="my-auto flex w-full max-w-sm flex-col rounded-xl bg-white shadow-2xl ring-1 ring-black/5"
          role="dialog"
          aria-labelledby="zipgrade-scan-title"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-5">
            <p id="zipgrade-scan-title" className="text-[13px] font-medium text-gray-500">
              Nombre
            </p>
            <div className="mt-1 flex min-h-11 items-center rounded-lg border border-gray-200 bg-gray-50/80 px-2 py-1.5">
              {nameCropUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={nameCropUrl}
                  alt="Nombre del alumno"
                  className="h-10 max-w-full object-contain object-left"
                />
              ) : studentName ? (
                <p className="text-lg font-semibold text-gray-900">{studentName}</p>
              ) : (
                <p className="text-sm italic text-gray-400">Sin nombre detectado</p>
              )}
            </div>

            <p className="mt-4 text-[13px] font-medium text-gray-500">Calificación</p>
            <p className="mt-0.5 text-[2rem] font-bold leading-tight tracking-tight text-gray-950">
              {score.correct}/{score.total} = {score.pct}%
            </p>

            <p className="mt-2 text-sm text-gray-500">
              ID:{' '}
              <span className="font-semibold text-gray-800 tabular-nums">
                {controlNumber ?? '—'}
              </span>
            </p>

            {showOverlayPreview && sheet && previewSrc ? (
              <div className="mt-4 overflow-hidden rounded-lg border border-orange-100 bg-orange-50/40 p-2">
                <SheetPreviewBox
                  previewSrc={previewSrc}
                  sheet={sheet}
                  maxHeight="min(42dvh, 18rem)"
                />
                <p className="mt-2 px-1 text-center text-[11px] leading-snug text-gray-600">
                  <span className="font-medium text-orange-600">Naranja</span> = clave ·{' '}
                  <span className="font-medium text-green-700">Verde</span> = acierto ·{' '}
                  <span className="font-medium text-red-600">Rojo</span> = error
                </p>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 space-y-2 border-t border-gray-100 px-5 py-4">
            <Button
              type="button"
              className="h-11 w-full bg-orange-600 hover:bg-orange-700"
              onClick={onRetake}
            >
              Calificar de nuevo
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={onBackToCalificar}
            >
              Calificar otro examen
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

type ReviewScreenProps = {
  open: boolean;
  examTitle: string;
  sheet: ZipGradeSheetData | null;
  studentName?: string;
  controlNumber?: string | null;
  sheetIndex: number;
  sheetCount: number;
  onBack: () => void;
  onPrevSheet: () => void;
  onNextSheet: () => void;
  onRetake: () => void;
  onSave: () => void;
  onExport?: () => void;
  onPickStudent?: () => void;
  questionsContent?: ReactNode;
};

type ReviewTab = 'imagen' | 'preguntas';

export function MobileZipGradeReviewScreen({
  open,
  examTitle,
  sheet,
  studentName,
  controlNumber,
  sheetIndex,
  sheetCount,
  onBack,
  onPrevSheet,
  onNextSheet,
  onRetake,
  onSave,
  onExport,
  onPickStudent,
  questionsContent,
}: ReviewScreenProps) {
  const [tab, setTab] = useState<ReviewTab>('imagen');
  const [menuOpen, setMenuOpen] = useState(false);

  const scoreLine = useMemo(() => {
    if (!sheet) return '';
    return `${sheet.correct} / ${sheet.total} = ${sheet.pct}%`;
  }, [sheet]);

  const wrongCount = sheet ? Math.max(0, sheet.total - sheet.correct) : 0;

  if (!open || !sheet || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[290] flex flex-col bg-orange-50/40"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="flex shrink-0 items-center justify-between bg-orange-600 px-2 py-2.5 text-white shadow-sm">
        <button
          type="button"
          className="flex min-h-11 min-w-[4.5rem] items-center gap-0.5 px-2 py-1 text-[17px] font-normal active:opacity-70"
          onClick={onBack}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Resultado
        </button>
        <h1 className="text-[15px] font-semibold tracking-[0.12em]">REVISIÓN</h1>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-lg active:bg-white/10"
          aria-label="Menú"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {menuOpen ? (
        <div className="relative z-[291] shrink-0 border-b border-gray-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {onPickStudent ? (
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 active:bg-gray-100"
                onClick={() => {
                  setMenuOpen(false);
                  onPickStudent();
                }}
              >
                Cambiar alumno
              </button>
            ) : null}
            {onExport ? (
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 active:bg-gray-100"
                onClick={() => {
                  setMenuOpen(false);
                  onExport();
                }}
              >
                Exportar CSV
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="shrink-0 bg-white px-4 pb-3 pt-4 shadow-sm">
        <p className="text-center text-[clamp(1.75rem,8vw,2.1rem)] font-bold leading-none tracking-tight text-gray-950">
          {scoreLine}
        </p>
        <p className="mt-2 text-center text-[13px] text-gray-600">
          <span className="font-semibold text-green-700">{sheet.correct} aciertos</span>
          {' · '}
          <span className="font-semibold text-red-600">{wrongCount} errores</span>
          {sheetCount > 1 ? (
            <>
              {' · '}
              <span className="text-gray-500">
                Hoja {sheetIndex + 1}/{sheetCount}
              </span>
            </>
          ) : null}
        </p>
        <div className="mx-auto mt-3 flex max-w-md flex-col items-center gap-2">
          {sheet.nameCropUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={sheet.nameCropUrl}
              alt="Nombre"
              className="max-h-12 max-w-[min(100%,18rem)] object-contain"
            />
          ) : studentName ? (
            <p className="truncate text-center text-lg font-semibold text-gray-900">
              {studentName}
            </p>
          ) : null}
          <p className="max-w-full truncate text-center text-xs text-gray-500">
            {examTitle}
            {controlNumber ? (
              <>
                {' '}
                · Control <span className="font-medium tabular-nums">{controlNumber}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-orange-50/50">
        {tab === 'imagen' ? (
          <div className="flex min-h-full items-center justify-center p-3">
            <div className="w-full max-w-lg overflow-hidden rounded-lg border bg-white p-2 shadow-sm">
              <SheetPreviewBox
                previewSrc={sheet.previewUrl}
                sheet={sheet}
                maxHeight="min(58dvh, 28rem)"
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-lg space-y-3 p-4">{questionsContent}</div>
        )}
      </div>

      <footer className="shrink-0 border-t border-orange-100 bg-white/95 backdrop-blur-xl">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full text-orange-600 active:bg-orange-50 disabled:opacity-30"
            disabled={sheetIndex <= 0}
            onClick={onPrevSheet}
            aria-label="Hoja anterior"
          >
            <ChevronLeft className="h-8 w-8" strokeWidth={2.5} />
          </button>

          <div className="flex rounded-full bg-gray-200/90 p-0.5">
            {(
              [
                ['imagen', 'Imagen'],
                ['preguntas', 'Preguntas'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  'min-h-10 rounded-full px-5 py-2 text-[13px] font-medium transition-all',
                  tab === id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 active:bg-white/50'
                )}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full text-orange-600 active:bg-orange-50 disabled:opacity-30"
            disabled={sheetIndex >= sheetCount - 1}
            onClick={onNextSheet}
            aria-label="Hoja siguiente"
          >
            <ChevronRight className="h-8 w-8" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex gap-2 border-t border-gray-200 px-4 py-3">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onRetake}>
            Otra foto
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 bg-orange-600 hover:bg-orange-700"
            onClick={onSave}
          >
            Guardar
          </Button>
        </div>
      </footer>
    </div>,
    document.body
  );
}

type StudentPickerProps = {
  open: boolean;
  students: Student[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  autoOptionId?: string;
  autoOptionLabel?: string;
};

export function MobileZipGradeStudentPicker({
  open,
  students,
  selectedId,
  onSelect,
  onClose,
  autoOptionId,
  autoOptionLabel,
}: StudentPickerProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[310] flex flex-col justify-end bg-black/40">
      <button type="button" className="min-h-0 flex-1" aria-label="Cerrar" onClick={onClose} />
      <div
        className="flex max-h-[min(75dvh,calc(100dvh-2rem))] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="shrink-0 border-b border-gray-100 bg-orange-50/60 px-4 py-3.5">
          <p className="text-center text-[15px] font-semibold text-gray-900">Alumno</p>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {autoOptionId !== undefined && autoOptionLabel !== undefined ? (
            <li>
              <button
                type="button"
                className={cn(
                  'flex min-h-12 w-full items-center justify-between border-b border-gray-50 px-4 py-3.5 text-left text-[17px] active:bg-gray-50',
                  selectedId === autoOptionId && 'bg-orange-50 font-semibold text-orange-900'
                )}
                onClick={() => {
                  onSelect(autoOptionId);
                  onClose();
                }}
              >
                <span>{autoOptionLabel}</span>
              </button>
            </li>
          ) : null}
          {students.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={cn(
                  'flex min-h-12 w-full items-center justify-between gap-3 border-b border-gray-50 px-4 py-3.5 text-left text-[17px] active:bg-gray-50',
                  selectedId === s.id && 'bg-orange-50 font-semibold text-orange-900'
                )}
                onClick={() => {
                  onSelect(s.id);
                  onClose();
                }}
              >
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.control_number ? (
                  <span className="shrink-0 text-sm tabular-nums text-gray-500">
                    {s.control_number}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}
