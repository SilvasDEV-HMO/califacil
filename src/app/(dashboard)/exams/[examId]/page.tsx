'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useGroups } from '@/hooks/useGroups';
import { useExam } from '@/hooks/useExams';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft,
  QrCode,
  Copy,
  Download,
  Printer,
  Edit,
  PlusCircle,
  Play,
  Lock,
  Trash2,
  Loader2,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { Question } from '@/types';
import { printExamDocument } from '@/lib/printExam';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { supabase } from '@/lib/supabase';
import { toSpanishAuthMessage } from '@/lib/authErrors';

type QuestionDraft = {
  text: string;
  type: 'multiple_choice' | 'open_answer';
  optionsText: string;
  correctAnswer: string;
  illustration: string;
};

function normalizeOptions(optionsText: string): string[] {
  const unique = new Set<string>();
  for (const row of optionsText.split('\n')) {
    const value = row.trim();
    if (value) unique.add(value);
  }
  return Array.from(unique);
}

function buildQuestionPayload(draft: QuestionDraft) {
  const text = draft.text.trim();
  if (!text) {
    return { ok: false as const, error: 'El texto de la pregunta es obligatorio' };
  }
  if (draft.type === 'open_answer') {
    return {
      ok: true as const,
      payload: {
        text,
        type: 'open_answer' as const,
        options: null,
        correct_answer: draft.correctAnswer.trim() || null,
        illustration: draft.illustration.trim() || null,
      },
    };
  }
  const options = normalizeOptions(draft.optionsText);
  if (options.length < 2) {
    return { ok: false as const, error: 'La pregunta de opción múltiple requiere al menos 2 opciones' };
  }
  if (options.length > 5) {
    return { ok: false as const, error: 'Máximo 5 opciones por pregunta para mantener compatibilidad' };
  }
  const correct = draft.correctAnswer.trim();
  if (!correct) {
    return { ok: false as const, error: 'Selecciona o escribe la respuesta correcta' };
  }
  if (!options.includes(correct)) {
    return { ok: false as const, error: 'La respuesta correcta debe coincidir con una opción' };
  }
  return {
    ok: true as const,
    payload: {
      text,
      type: 'multiple_choice' as const,
      options,
      correct_answer: correct,
      illustration: draft.illustration.trim() || null,
    },
  };
}

function draftFromQuestion(question: Question): QuestionDraft {
  return {
    text: question.text || '',
    type: question.type,
    optionsText: (question.options || []).join('\n'),
    correctAnswer: question.correct_answer || '',
    illustration: question.illustration || '',
  };
}

export default function ExamDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { groups } = useGroups(user?.id);
  const examId = params.examId as string;
  const { exam, loading, updateQuestion, deleteQuestion, addQuestions } = useExam(examId);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [generatingQR, setGeneratingQR] = useState(false);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [assignedGroupIds, setAssignedGroupIds] = useState<string[]>([]);
  const [loadingAssignedGroups, setLoadingAssignedGroups] = useState(false);
  const [savingAssignedGroups, setSavingAssignedGroups] = useState(false);
  const [newQuestion, setNewQuestion] = useState<QuestionDraft>({
    text: '',
    type: 'multiple_choice',
    optionsText: 'Opción A\nOpción B',
    correctAnswer: 'Opción A',
    illustration: '',
  });
  const newQuestionOptions = normalizeOptions(newQuestion.optionsText);

  useEffect(() => {
    if (!exam?.id) return;
    let cancelled = false;
    (async () => {
      setLoadingAssignedGroups(true);
      const { data, error } = await supabase
        .from('exam_group_assignments')
        .select('group_id')
        .eq('exam_id', exam.id);

      if (cancelled) return;

      if (error) {
        setAssignedGroupIds(exam.group_id ? [exam.group_id] : []);
      } else {
        const ids = (data || []).map((row) => row.group_id as string);
        setAssignedGroupIds(ids.length > 0 ? ids : exam.group_id ? [exam.group_id] : []);
      }
      setLoadingAssignedGroups(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [exam?.id, exam?.group_id]);

  const handleSaveAssignedGroups = async () => {
    if (!exam) return;
    setSavingAssignedGroups(true);
    try {
      const patchRes = await fetch(`/api/exams/${exam.id}`, {
        method: 'PATCH',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ group_ids: assignedGroupIds }),
      });
      const payload = (await patchRes.json().catch(() => ({}))) as { message?: string; hint?: string; error?: string };
      if (!patchRes.ok) {
        const detail = [payload.message, payload.hint].filter(Boolean).join(' — ');
        throw new Error(detail || payload.error || 'No se pudieron guardar los grupos');
      }

      toast.success('Grupos actualizados');
      window.location.reload();
    } catch (error: any) {
      toast.error('No se pudieron actualizar los grupos', {
        description: toSpanishAuthMessage(error?.message ?? 'Error desconocido'),
      });
    } finally {
      setSavingAssignedGroups(false);
    }
  };

  const generateQRCode = useCallback(async () => {
    if (!exam) return;
    setGeneratingQR(true);
    try {
      const examUrl = `${window.location.origin}/examen/${exam.id}`;
      const qrDataUrl = await QRCode.toDataURL(examUrl, {
        width: 400,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      setQrCodeUrl(qrDataUrl);

      const qrRes = await fetch(`/api/exams/${exam.id}`, {
        method: 'PATCH',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ qr_code: qrDataUrl }),
      });
      if (!qrRes.ok) {
        toast.error('No se pudo guardar el QR. Vuelve a iniciar sesión e inténtalo de nuevo.');
      }
    } catch {
      toast.error('Error al generar el código QR');
    } finally {
      setGeneratingQR(false);
    }
  }, [exam]);

  useEffect(() => {
    if (!exam || exam.status !== 'published') return;
    if (exam.qr_code) {
      setQrCodeUrl(exam.qr_code);
      return;
    }
    if (!qrCodeUrl) {
      void generateQRCode();
    }
  }, [exam, qrCodeUrl, generateQRCode]);

  const copyExamLink = () => {
    const examUrl = `${window.location.origin}/examen/${examId}`;
    navigator.clipboard.writeText(examUrl);
    toast.success('Enlace copiado al portapapeles');
  };

  const handlePublish = async () => {
    try {
      const response = await fetch(`/api/exams/${examId}`, {
        method: 'PATCH',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ status: 'published' }),
      });

      if (response.ok) {
        toast.success('Examen publicado exitosamente');
        window.location.reload();
      } else if (response.status === 401) {
        toast.error('Sesión expirada. Inicia sesión de nuevo.');
      } else {
        toast.error('No se pudo publicar el examen');
      }
    } catch {
      toast.error('Error al publicar el examen');
    }
  };

  const handlePrintExam = () => {
    if (!exam || exam.questions.length === 0) {
      toast.error('Agrega al menos una pregunta para imprimir el examen');
      return;
    }
    const ok = printExamDocument(exam);
    if (!ok) {
      toast.error('Permite ventanas emergentes para imprimir el examen');
    }
  };

  const handleClose = async () => {
    try {
      const response = await fetch(`/api/exams/${examId}`, {
        method: 'PATCH',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ status: 'closed' }),
      });

      if (response.ok) {
        toast.success('Examen cerrado');
        window.location.reload();
      } else if (response.status === 401) {
        toast.error('Sesión expirada. Inicia sesión de nuevo.');
      } else {
        toast.error('No se pudo cerrar el examen');
      }
    } catch {
      toast.error('Error al cerrar el examen');
    }
  };

  const handleAddQuestion = async () => {
    const parsed = buildQuestionPayload(newQuestion);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setAddingQuestion(true);
    try {
      const created = await addQuestions([parsed.payload]);
      if (!created || created.length === 0) {
        toast.error('No se pudo agregar la pregunta');
        return;
      }
      toast.success('Pregunta agregada');
      setNewQuestion((prev) => ({
        ...prev,
        text: '',
        illustration: '',
        optionsText: prev.type === 'multiple_choice' ? 'Opción A\nOpción B' : '',
        correctAnswer: prev.type === 'multiple_choice' ? 'Opción A' : '',
      }));
    } finally {
      setAddingQuestion(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="py-12 text-center">
        <FileText className="mx-auto mb-4 h-16 w-16 text-gray-300" />
        <h3 className="mb-2 text-xl font-medium text-gray-900">Examen no encontrado</h3>
        <Button onClick={() => router.push('/exams')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a exámenes
        </Button>
      </div>
    );
  }

  const statusConfig = {
    draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-700' },
    published: { label: 'Publicado', color: 'bg-green-100 text-green-700' },
    closed: { label: 'Cerrado', color: 'bg-gray-100 text-gray-700' },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/exams')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{exam.title}</h1>
              <Badge className={statusConfig[exam.status].color}>{statusConfig[exam.status].label}</Badge>
            </div>
            <p className="mt-1 text-gray-600">{exam.description || 'Sin descripción'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {exam.questions.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={handlePrintExam}
              className="border-stone-600 text-stone-800 hover:bg-stone-50"
            >
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
          )}
          {exam.status === 'draft' && (
            <Button onClick={handlePublish} className="bg-green-600 hover:bg-green-700">
              <Play className="mr-2 h-4 w-4" />
              Publicar
            </Button>
          )}
          {exam.status === 'published' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                <Lock className="mr-2 h-4 w-4" />
                Cerrar
              </Button>
              <Button
                onClick={() => router.push(`/exams/results/${exam.id}`)}
                className="bg-orange-600 hover:bg-orange-700"
              >
                Ver Resultados
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="questions" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grupos asignados</CardTitle>
            <CardDescription>
              Este examen estará disponible para alumnos de los grupos seleccionados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingAssignedGroups ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando grupos...
              </div>
            ) : groups.length === 0 ? (
              <p className="text-sm text-gray-500">No tienes grupos creados.</p>
            ) : (
              groups.map((group) => {
                const checked = assignedGroupIds.includes(group.id);
                return (
                  <label key={group.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        const enabled = value === true;
                        setAssignedGroupIds((prev) =>
                          enabled
                            ? prev.includes(group.id)
                              ? prev
                              : [...prev, group.id]
                            : prev.filter((id) => id !== group.id)
                        );
                      }}
                    />
                    <span>{group.name}</span>
                  </label>
                );
              })
            )}

            <div className="pt-2">
              <Button
                type="button"
                onClick={() => void handleSaveAssignedGroups()}
                disabled={savingAssignedGroups || loadingAssignedGroups}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {savingAssignedGroups ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Guardar grupos'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <TabsList>
          <TabsTrigger value="questions">
            <FileText className="mr-2 h-4 w-4" />
            Preguntas ({exam.questions.length})
          </TabsTrigger>
          {exam.status === 'published' && (
            <TabsTrigger value="qr">
              <QrCode className="mr-2 h-4 w-4" />
              Código QR
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="questions" className="space-y-4">
          {exam.questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              index={index}
              onUpdate={updateQuestion}
              onDelete={deleteQuestion}
            />
          ))}

          <Card className="border-dashed border-orange-300">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <PlusCircle className="h-5 w-5 text-orange-600" />
                Agregar pregunta personalizada
              </CardTitle>
              <CardDescription>
                Todo el examen es editable: agrega, actualiza o elimina preguntas y respuestas de forma manual.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Texto de la pregunta</Label>
                <Textarea
                  value={newQuestion.text}
                  onChange={(e) => setNewQuestion((prev) => ({ ...prev, text: e.target.value }))}
                  rows={3}
                  placeholder="Escribe la pregunta..."
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={newQuestion.type}
                  onValueChange={(v: 'multiple_choice' | 'open_answer') =>
                    setNewQuestion((prev) => ({
                      ...prev,
                      type: v,
                      optionsText: v === 'multiple_choice' ? prev.optionsText || 'Opción A\nOpción B' : '',
                      correctAnswer: v === 'multiple_choice' ? prev.correctAnswer || 'Opción A' : prev.correctAnswer,
                      illustration: '',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple_choice">Opción múltiple</SelectItem>
                    <SelectItem value="open_answer">Respuesta abierta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newQuestion.type === 'multiple_choice' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Opciones (una por línea)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setNewQuestion((prev) => ({
                            ...prev,
                            optionsText: `${prev.optionsText.trim()}\nOpción ${String.fromCharCode(65 + normalizeOptions(prev.optionsText).length)}`.trim(),
                          }))
                        }
                      >
                        Agregar opción
                      </Button>
                    </div>
                    <Textarea
                      value={newQuestion.optionsText}
                      onChange={(e) => setNewQuestion((prev) => ({ ...prev, optionsText: e.target.value }))}
                      rows={5}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Respuesta correcta</Label>
                    <Select
                      value={newQuestionOptions.includes(newQuestion.correctAnswer) ? newQuestion.correctAnswer : undefined}
                      onValueChange={(v) => setNewQuestion((prev) => ({ ...prev, correctAnswer: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona la opción correcta" />
                      </SelectTrigger>
                      <SelectContent>
                        {newQuestionOptions.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">Primero escribe las opciones, luego elige la correcta.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Respuesta esperada (opcional)</Label>
                  <Textarea
                    value={newQuestion.correctAnswer}
                    onChange={(e) => setNewQuestion((prev) => ({ ...prev, correctAnswer: e.target.value }))}
                    rows={3}
                    placeholder="Rubrica o respuesta esperada"
                  />
                </div>
              )}
              <Button
                onClick={() => void handleAddQuestion()}
                disabled={addingQuestion}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {addingQuestion ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Agregando...
                  </>
                ) : (
                  'Agregar pregunta'
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {exam.status === 'published' && (
          <TabsContent value="qr">
            <Card>
              <CardHeader>
                <CardTitle>Código QR del Examen</CardTitle>
                <CardDescription>
                  Los estudiantes pueden escanear este código para acceder al examen
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-col items-center">
                  {generatingQR ? (
                    <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-gray-100">
                      <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
                    </div>
                  ) : qrCodeUrl ? (
                    <div className="qr-container">
                      <Image
                        src={qrCodeUrl}
                        alt="Código QR del examen"
                        width={256}
                        height={256}
                        className="h-64 w-64"
                        unoptimized
                      />
                    </div>
                  ) : (
                    <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-gray-100">
                      <QrCode className="h-16 w-16 text-gray-300" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-center gap-3 sm:flex-row">
                  <Button variant="outline" onClick={copyExamLink}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar enlace
                  </Button>
                  {qrCodeUrl && (
                    <>
                      <Button variant="outline" onClick={() => window.open(qrCodeUrl, '_blank')}>
                        <Download className="mr-2 h-4 w-4" />
                        Descargar QR
                      </Button>
                      <Button variant="outline" onClick={() => window.print()}>
                        <Printer className="mr-2 h-4 w-4" />
                        Imprimir
                      </Button>
                    </>
                  )}
                </div>

                <div className="rounded-lg bg-orange-50 p-4">
                  <h4 className="mb-2 font-semibold text-orange-900">¿Cómo funciona?</h4>
                  <ol className="list-inside list-decimal space-y-1 text-sm text-orange-700">
                    <li>Muestra el código QR en pantalla o imprímelo</li>
                    <li>Los estudiantes escanean el código con sus móviles</li>
                    <li>Ingresan su nombre y comienzan el examen</li>
                    <li>Los resultados se guardan automáticamente</li>
                  </ol>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function QuestionCard({
  question,
  index,
  onUpdate,
  onDelete,
}: {
  question: Question;
  index: number;
  onUpdate: (id: string, updates: Partial<Question>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<QuestionDraft>(draftFromQuestion(question));
  const draftOptions = normalizeOptions(draft.optionsText);

  useEffect(() => {
    setDraft(draftFromQuestion(question));
  }, [question]);

  const handleSave = async () => {
    const parsed = buildQuestionPayload(draft);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setSaving(true);
    const success = await onUpdate(question.id, parsed.payload);
    setSaving(false);
    if (success) {
      setIsEditing(false);
      toast.success('Pregunta actualizada');
    } else {
      toast.error('No se pudo actualizar la pregunta');
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Estás seguro de eliminar esta pregunta? Esta acción no se puede deshacer.')) return;
    const success = await onDelete(question.id);
    if (success) {
      toast.success('Pregunta eliminada');
    } else {
      toast.error('No se pudo eliminar la pregunta');
    }
  };

  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-500">Pregunta {index + 1}</span>
              <Badge className={question.type === 'multiple_choice' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}>
                {question.type === 'multiple_choice' ? 'Opción múltiple' : 'Respuesta abierta'}
              </Badge>
            </div>

            {isEditing ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">Enunciado</Label>
                  <Textarea
                    value={draft.text}
                    onChange={(e) => setDraft((prev) => ({ ...prev, text: e.target.value }))}
                    rows={3}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-600">Tipo</Label>
                  <Select
                    value={draft.type}
                    onValueChange={(v: 'multiple_choice' | 'open_answer') =>
                      setDraft((prev) => ({
                        ...prev,
                        type: v,
                        optionsText: v === 'multiple_choice' ? prev.optionsText || 'Opción A\nOpción B' : '',
                        illustration: '',
                      }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiple_choice">Opción múltiple</SelectItem>
                      <SelectItem value="open_answer">Respuesta abierta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draft.type === 'multiple_choice' ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs text-gray-600">Opciones (una por línea)</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              optionsText: `${prev.optionsText.trim()}\nOpción ${String.fromCharCode(65 + normalizeOptions(prev.optionsText).length)}`.trim(),
                            }))
                          }
                        >
                          + Opción
                        </Button>
                      </div>
                      <Textarea
                        value={draft.optionsText}
                        onChange={(e) => setDraft((prev) => ({ ...prev, optionsText: e.target.value }))}
                        rows={5}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-600">Respuesta correcta</Label>
                      <Select
                        value={draftOptions.includes(draft.correctAnswer) ? draft.correctAnswer : undefined}
                        onValueChange={(v) => setDraft((prev) => ({ ...prev, correctAnswer: v }))}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Selecciona la correcta" />
                        </SelectTrigger>
                        <SelectContent>
                          {draftOptions.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">Respuesta esperada</Label>
                    <Textarea
                      value={draft.correctAnswer}
                      onChange={(e) => setDraft((prev) => ({ ...prev, correctAnswer: e.target.value }))}
                      rows={3}
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="font-medium">{question.text}</p>
                {question.type === 'multiple_choice' && question.options && (
                  <div className="ml-4 mt-2 space-y-1">
                    {question.options.map((option, optIndex) => (
                      <div
                        key={optIndex}
                        className={`text-sm ${option === question.correct_answer ? 'font-medium text-green-600' : 'text-gray-600'}`}
                      >
                        {String.fromCharCode(65 + optIndex)}. {option}
                        {option === question.correct_answer && ' ✓'}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {!isEditing && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => void handleDelete()}
                aria-label="Eliminar pregunta"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
