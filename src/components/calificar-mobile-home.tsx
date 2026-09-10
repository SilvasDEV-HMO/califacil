'use client';

import { useMemo, useState } from 'react';
import { Camera, CheckCircle2, ChevronRight, Images, Loader2, ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Exam, Student } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MobileZipGradeStudentPicker } from '@/components/mobile-zipgrade-results';
import { CALIFICAR_AUTO_STUDENT_ID } from '@/lib/calificarStudentMode';

type Props = {
  exams: Exam[];
  examsLoading: boolean;
  examId: string;
  exam: Exam | null | undefined;
  examLoading: boolean;
  students: Student[];
  selectedStudentId: string;
  selectedStudentName: string;
  detectedControlNumber: string | null;
  studentAutoDetect: boolean;
  canGradeStudents: boolean;
  supportsCalifacil: boolean;
  virtualKeyReady: number;
  virtualKeyTotal: number;
  sheetIndex: number;
  totalSheets: number;
  scanBusy: boolean;
  busyLabel?: string;
  onSelectExam: (id: string) => void;
  onSelectStudent: (id: string) => void;
  onScan: () => void;
  onImportPhoto?: () => void;
};

function ConfigRow({
  label,
  value,
  hint,
  onPress,
  disabled,
  last,
}: {
  label: string;
  value: string;
  hint?: string;
  onPress?: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const Tag = onPress ? 'button' : 'div';
  return (
    <Tag
      type={onPress ? 'button' : undefined}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
        !last && 'border-b border-gray-100',
        onPress && !disabled && 'active:bg-orange-50/60 hover:bg-orange-50/40',
        disabled && 'opacity-55'
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="truncate text-base font-medium text-gray-950">{value}</p>
        {hint ? <p className="mt-0.5 text-xs leading-snug text-gray-500">{hint}</p> : null}
      </div>
      {onPress ? <ChevronRight className="h-5 w-5 shrink-0 text-gray-300" /> : null}
    </Tag>
  );
}

export function CalificarMobileHome({
  exams,
  examsLoading,
  examId,
  exam,
  examLoading,
  students,
  selectedStudentId,
  selectedStudentName,
  detectedControlNumber,
  studentAutoDetect,
  canGradeStudents,
  supportsCalifacil,
  virtualKeyReady,
  virtualKeyTotal,
  sheetIndex,
  totalSheets,
  scanBusy,
  busyLabel,
  onSelectExam,
  onSelectStudent,
  onScan,
  onImportPhoto,
}: Props) {
  const [examPickerOpen, setExamPickerOpen] = useState(false);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);

  const examTitle = useMemo(() => {
    if (examsLoading) return 'Cargando exámenes…';
    if (!examId) return 'Elegir examen';
    return exam?.title ?? exams.find((e) => e.id === examId)?.title ?? 'Examen seleccionado';
  }, [exam, examId, exams, examsLoading]);

  const studentLabel = useMemo(() => {
    if (detectedControlNumber && selectedStudentName) {
      return `${selectedStudentName} · ${detectedControlNumber}`;
    }
    if (selectedStudentName) return selectedStudentName;
    if (studentAutoDetect) return 'Automático';
    return 'Elegir alumno';
  }, [detectedControlNumber, selectedStudentName, studentAutoDetect]);

  const readyToScan =
    Boolean(examId) &&
    supportsCalifacil &&
    canGradeStudents &&
    !examLoading;

  return (
    <div className="calificar-mobile-enter flex min-h-0 flex-1 flex-col lg:hidden">
      <div className="mx-auto w-full max-w-lg flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 pt-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calificar</h1>
          <p className="mt-1 text-sm text-gray-600">
            Toma o sube fotos de las hojas impresas. Se califican igual que un escaneo de
            escritorio.
          </p>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Configuración</CardTitle>
            <CardDescription>
              Elige el examen; el alumno se detecta por el número de control de la hoja.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ConfigRow
              label="Examen"
              value={examTitle}
              hint={
                examLoading
                  ? 'Cargando preguntas…'
                  : examId
                    ? `${virtualKeyReady}/${virtualKeyTotal} reactivos con clave`
                    : 'Toca para elegir un examen publicado'
              }
              onPress={() => !examsLoading && setExamPickerOpen(true)}
              disabled={examsLoading}
            />
            <ConfigRow
              label="Alumno"
              value={studentLabel}
              hint={
                studentAutoDetect
                  ? 'Se identifica al leer el número de control de la hoja'
                  : 'Alumno fijado manualmente'
              }
              onPress={() => canGradeStudents && setStudentPickerOpen(true)}
              disabled={!canGradeStudents || !examId}
              last
            />
          </CardContent>
        </Card>

        {examId && examLoading ? (
          <Card className="shadow-sm">
            <CardContent className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
              Preparando clave automática…
            </CardContent>
          </Card>
        ) : null}

        {exam && supportsCalifacil && canGradeStudents ? (
          <Card className="border-orange-200 bg-orange-50/80 shadow-sm">
            <CardContent className="flex items-start gap-3 py-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
              <div>
                <p className="text-sm font-semibold text-gray-900">Listo para calificar</p>
                <p className="mt-0.5 text-xs leading-snug text-gray-600">
                  Hoja {sheetIndex + 1} de {totalSheets}. Encuadra la hoja completa, con buena luz
                  y las esquinas o franjas negras visibles.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {exam && !supportsCalifacil ? (
          <Card className="border-amber-200 bg-amber-50 shadow-sm">
            <CardContent className="py-3 text-sm text-amber-950">
              Este examen necesita solo preguntas de opción múltiple (2–5 opciones).
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div
        className="shrink-0 border-t border-orange-100/90 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur-md"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto w-full max-w-lg space-y-2">
          <Button
            type="button"
            disabled={!readyToScan || scanBusy}
            onClick={onScan}
            className="h-12 w-full rounded-xl bg-orange-600 text-base font-semibold hover:bg-orange-700"
          >
            {scanBusy ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Camera className="mr-2 h-5 w-5" strokeWidth={2.25} />
            )}
            {scanBusy ? busyLabel || 'Calificando…' : 'Tomar foto'}
          </Button>
          {onImportPhoto ? (
            <Button
              type="button"
              variant="outline"
              disabled={!readyToScan || scanBusy}
              onClick={onImportPhoto}
              className="h-11 w-full border-orange-200 bg-white text-orange-900 hover:bg-orange-50"
            >
              {scanBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Images className="mr-2 h-4 w-4" strokeWidth={2.25} />
              )}
              Subir fotos
            </Button>
          ) : null}
        </div>
      </div>

      {examPickerOpen ? (
        <div className="fixed inset-0 z-[240] flex flex-col justify-end bg-black/40">
          <button
            type="button"
            className="flex-1"
            aria-label="Cerrar"
            onClick={() => setExamPickerOpen(false)}
          />
          <div
            className="flex max-h-[min(75dvh,calc(100dvh-2rem))] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="shrink-0 border-b border-orange-100 bg-orange-50/60 px-4 py-3.5">
              <p className="text-center text-sm font-semibold text-gray-900">Elegir examen</p>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {exams.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-gray-500">
                  No hay exámenes publicados.
                </li>
              ) : (
                exams.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex min-h-12 w-full items-center gap-3 border-b border-gray-100 px-4 py-3.5 text-left active:bg-orange-50/60',
                        examId === e.id && 'bg-orange-50 text-orange-900'
                      )}
                      onClick={() => {
                        onSelectExam(e.id);
                        setExamPickerOpen(false);
                      }}
                    >
                      <ScanLine className="h-5 w-5 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate text-base text-gray-900">
                        {e.title}
                      </span>
                      {examId === e.id ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-600" />
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      <MobileZipGradeStudentPicker
        open={studentPickerOpen}
        students={students}
        selectedId={selectedStudentId}
        autoOptionId={CALIFICAR_AUTO_STUDENT_ID}
        autoOptionLabel="Automático (detectar en la hoja)"
        onSelect={onSelectStudent}
        onClose={() => setStudentPickerOpen(false)}
      />
    </div>
  );
}
