'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { type VoidedAttemptRow } from '@/lib/examRetake.types';
import {
  examAttemptEventLabels,
  formatAttemptDuration,
  voidReasonLabel,
} from '@/lib/examForfeitMessages';

type AttemptTimelineEvent = {
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type VoidedAttemptsPanelProps = {
  examId: string;
  title?: string;
  description?: string;
};

export function VoidedAttemptsPanel({
  examId,
  title = 'Exámenes anulados',
  description = 'Alumnos cuyo intento en línea fue anulado. Puedes dar otra oportunidad para quitar el bloqueo o mantener el registro.',
}: VoidedAttemptsPanelProps) {
  const [voidedAttempts, setVoidedAttempts] = useState<VoidedAttemptRow[]>([]);
  const [loadingVoided, setLoadingVoided] = useState(false);
  const [retakeModalOpen, setRetakeModalOpen] = useState(false);
  const [retakeTarget, setRetakeTarget] = useState<VoidedAttemptRow | null>(null);
  const [retakeTimeline, setRetakeTimeline] = useState<{
    duration_seconds: number;
    void_reason: string | null;
    last_10_seconds: AttemptTimelineEvent[];
  } | null>(null);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [grantingRetake, setGrantingRetake] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadVoidedAttempts = useCallback(async () => {
    setLoadingVoided(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/exams/${examId}/voided-attempts`, {
        headers: await dashboardAuthJsonHeaders(),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        attempts?: VoidedAttemptRow[];
        error?: string;
        hint?: string;
      };
      if (res.ok) {
        setVoidedAttempts(payload.attempts ?? []);
        return;
      }
      const message = payload.error || 'No se pudieron cargar los exámenes anulados';
      setLoadError(payload.hint ? `${message}. ${payload.hint}` : message);
      setVoidedAttempts([]);
    } catch {
      setLoadError('Error de conexión al cargar los exámenes anulados.');
      setVoidedAttempts([]);
    } finally {
      setLoadingVoided(false);
    }
  }, [examId]);

  useEffect(() => {
    void loadVoidedAttempts();
  }, [loadVoidedAttempts]);

  const openRetakeModal = async (attempt: VoidedAttemptRow) => {
    setRetakeTarget(attempt);
    setRetakeTimeline(null);
    setActionError(null);
    setRetakeModalOpen(true);
    setLoadingTimeline(true);
    try {
      const res = await fetch(`/api/exams/${examId}/students/${attempt.student_id}/retake`, {
        headers: await dashboardAuthJsonHeaders(),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        duration_seconds?: number;
        void_reason?: string | null;
        last_10_seconds?: AttemptTimelineEvent[];
      };
      if (res.ok) {
        setRetakeTimeline({
          duration_seconds: payload.duration_seconds ?? attempt.duration_seconds,
          void_reason: payload.void_reason ?? attempt.void_reason,
          last_10_seconds: payload.last_10_seconds ?? [],
        });
      }
    } finally {
      setLoadingTimeline(false);
    }
  };

  const handleGrantRetake = async () => {
    if (!retakeTarget) return;
    const studentId = retakeTarget.student_id;
    setActionError(null);
    setGrantingRetake(true);
    try {
      const res = await fetch(`/api/exams/${examId}/students/${studentId}/retake`, {
        method: 'POST',
        headers: await dashboardAuthJsonHeaders(),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        const message = payload.error || 'No se pudo otorgar la segunda oportunidad';
        setActionError(payload.hint ? `${message} ${payload.hint}` : message);
        toast.error(message, { description: payload.hint });
        return;
      }
      toast.success('Segunda oportunidad otorgada. El alumno ya puede volver a presentar el examen.');
      setRetakeModalOpen(false);
      setRetakeTarget(null);
      setRetakeTimeline(null);
      setVoidedAttempts((prev) => prev.filter((a) => a.student_id !== studentId));
      void loadVoidedAttempts();
    } catch {
      const message = 'Error de conexión al otorgar la segunda oportunidad';
      setActionError(message);
      toast.error(message);
    } finally {
      setGrantingRetake(false);
    }
  };

  const handleKeepRecord = () => {
    setRetakeModalOpen(false);
    setRetakeTarget(null);
    toast.message('Registro conservado', {
      description: 'El alumno seguirá viendo el examen como anulado hasta que otorgues otra oportunidad.',
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingVoided ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
            </div>
          ) : loadError ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-red-600">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadVoidedAttempts()}>
                Reintentar
              </Button>
            </div>
          ) : voidedAttempts.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No hay exámenes anulados registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 text-left font-semibold">Estudiante</th>
                    <th className="py-2 text-left font-semibold">Duración</th>
                    <th className="py-2 text-left font-semibold">Motivo</th>
                    <th className="py-2 text-right font-semibold">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {voidedAttempts.map((attempt) => (
                    <tr key={attempt.student_id} className="border-b">
                      <td className="py-3 font-medium">{attempt.student_name}</td>
                      <td className="py-3 text-gray-600">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {formatAttemptDuration(attempt.duration_seconds)}
                        </span>
                      </td>
                      <td className="py-3 text-gray-600">{voidReasonLabel(attempt.void_reason)}</td>
                      <td className="py-3 text-right">
                        <Button size="sm" onClick={() => void openRetakeModal(attempt)}>
                          Revisar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={retakeModalOpen} onOpenChange={setRetakeModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Examen anulado</DialogTitle>
            <DialogDescription>
              {retakeTarget?.student_name
                ? `Revisa qué ocurrió con ${retakeTarget.student_name} y decide si le das otra oportunidad.`
                : 'Revisa el intento anulado y decide si otorgas otra oportunidad.'}
            </DialogDescription>
          </DialogHeader>
          {loadingTimeline ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
            </div>
          ) : retakeTimeline ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border bg-gray-50 p-3">
                <p className="font-medium text-gray-900">Tiempo en el examen</p>
                <p className="mt-1 text-gray-700">{formatAttemptDuration(retakeTimeline.duration_seconds)}</p>
              </div>
              <div className="rounded-lg border bg-amber-50 p-3">
                <p className="font-medium text-amber-900">Motivo del cierre</p>
                <p className="mt-1 text-amber-800">{voidReasonLabel(retakeTimeline.void_reason)}</p>
              </div>
              <div>
                <p className="mb-2 font-medium text-gray-900">Últimos 10 segundos antes del cierre</p>
                {retakeTimeline.last_10_seconds.length === 0 ? (
                  <p className="text-gray-500">No hay eventos registrados en ese intervalo.</p>
                ) : (
                  <ul className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                    {retakeTimeline.last_10_seconds.map((ev, idx) => (
                      <li key={idx} className="text-gray-700">
                        <span className="font-mono text-xs text-gray-500">
                          {new Date(ev.created_at).toLocaleTimeString('es-ES')}
                        </span>
                        {' — '}
                        {examAttemptEventLabels[ev.event_type] ?? ev.event_type}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
          {actionError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleKeepRecord}
              disabled={grantingRetake}
            >
              Mantener registro
            </Button>
            <Button
              type="button"
              onClick={() => void handleGrantRetake()}
              disabled={grantingRetake}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {grantingRetake ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Dar otra oportunidad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
