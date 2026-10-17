'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ExamWhiteboard } from '@/components/exam-whiteboard';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import {
  decodeWhiteboardExpectedText,
  decodeWhiteboardReference,
  encodeWhiteboardCorrectAnswer,
} from '@/lib/whiteboardAnswer';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialReference?: string | null;
  questionText?: string;
  onSave: (encodedReference: string) => void;
};

export function WhiteboardReferenceDialog({
  open,
  onOpenChange,
  initialReference,
  questionText = '',
  onSave,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [expectedText, setExpectedText] = useState('');
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(decodeWhiteboardReference(initialReference ?? null) ?? null);
      setExpectedText(decodeWhiteboardExpectedText(initialReference ?? null) ?? '');
    }
  }, [open, initialReference]);

  const detectExpression = async (image: string) => {
    setTranscribing(true);
    try {
      const res = await fetch('/api/grade/whiteboard-transcribe', {
        method: 'POST',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ image, questionText }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        expression?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        if (payload.code === 'NO_KEY') {
          toast.error('Falta OPENAI_API_KEY para detectar la expresión');
        } else {
          toast.error(payload.error ?? 'No se pudo detectar la expresión');
        }
        return;
      }
      const expr = (payload.expression ?? '').trim();
      if (expr) {
        setExpectedText(expr);
        toast.success('Expresión detectada — confirma o corrígela');
      } else {
        toast.message('No se detectó texto. Escribe la respuesta esperada manualmente.');
      }
    } catch {
      toast.error('Error al detectar la expresión');
    } finally {
      setTranscribing(false);
    }
  };

  const handleSave = () => {
    if (!draft || !draft.startsWith('data:image/')) return;
    const text = expectedText.trim();
    if (!text) {
      toast.error('Confirma el texto de la respuesta esperada');
      return;
    }
    onSave(encodeWhiteboardCorrectAnswer(draft, text));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Respuesta de referencia en pizarrón</DialogTitle>
          <DialogDescription>
            Dibuja la solución esperada y confirma el texto que representa (por ejemplo √5). La
            calificación automática comparará el dibujo del alumno con esa expresión.
          </DialogDescription>
        </DialogHeader>
        <ExamWhiteboard value={draft} onChange={setDraft} minHeight={300} />
        <div className="space-y-2">
          <Label htmlFor="whiteboard-expected-text">Respuesta esperada (texto)</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="whiteboard-expected-text"
              name="whiteboard-expected-text"
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
              placeholder="Ej. √5, x=3, 2.5×10⁸"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!draft?.startsWith('data:image/') || transcribing}
              onClick={() => draft && void detectExpression(draft)}
            >
              {transcribing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Detectar con IA
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Revisa el texto detectado. Puedes corregirlo antes de guardar.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="bg-orange-600 hover:bg-orange-700"
            disabled={!draft?.startsWith('data:image/') || !expectedText.trim()}
            onClick={handleSave}
          >
            Guardar referencia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
