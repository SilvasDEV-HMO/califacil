'use client';

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useGroups } from '@/hooks/useGroups';
import { useExams } from '@/hooks/useExams';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2,
  Wand2,
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  FileText,
  Settings,
  List,
  Upload,
  PenLine,
  Plus,
  Presentation,
} from 'lucide-react';
import { toast } from 'sonner';
import { GeneratedQuestion } from '@/types';
import { QuestionIllustration } from '@/components/question-illustration';
import { ExamPdfPreviewCrop } from '@/components/exam-pdf-preview-crop';
import { QuestionImagePicker } from '@/components/question-image-picker';
import { WhiteboardReferenceDialog } from '@/components/whiteboard-reference-dialog';
import type { ExamCroppedImage } from '@/lib/pdfClientPreview';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { toSpanishAuthMessage } from '@/lib/authErrors';
import { EXAM_POINTS_CAP, distributeExamPoints, examMaxScore, dedupeExamQuestions, normalizeQuestionText } from '@/lib/utils';
import {
  decodeWhiteboardExpectedText,
  decodeWhiteboardReference,
  hasWhiteboardExpectedText,
  isWhiteboardCorrectAnswer,
} from '@/lib/whiteboardAnswer';
import { ExamWhiteboard } from '@/components/exam-whiteboard';

type QuestionSourceMode = 'ia' | 'pdf' | 'manual';

const steps = [
  { id: 1, title: 'Información General', icon: FileText },
  { id: 2, title: 'Preguntas', icon: Settings },
  { id: 3, title: 'Revisar Preguntas', icon: List },
];

function createEmptyQuestion(): GeneratedQuestion {
  return {
    text: '',
    type: 'multiple_choice',
    options: ['', '', '', ''],
    correct_answer: '',
    points: 1,
  };
}

async function dashboardAuthHeadersOnly(): Promise<Record<string, string>> {
  const authHeaders = await dashboardAuthJsonHeaders();
  const headers: Record<string, string> = {};
  const auth = (authHeaders as Record<string, string>).Authorization;
  if (auth) headers.Authorization = auth;
  return headers;
}

export default function CreateExamPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createFolderId = searchParams.get('folder');
  const { user } = useAuth();
  const { groups } = useGroups(user?.id);
  const { createExam, deleteExam } = useExams(user?.id);

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const saveExamLockRef = useRef(false);
  const generateLockRef = useRef(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const [questionSourceMode, setQuestionSourceMode] = useState<QuestionSourceMode>('ia');
  const [topics, setTopics] = useState('');
  const [questionCount, setQuestionCount] = useState(10);
  const [difficultyLevel, setDifficultyLevel] = useState<
    'easy' | 'medium' | 'hard' | 'extreme'
  >('medium');
  const [includeMultipleChoice, setIncludeMultipleChoice] = useState(true);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [croppedImages, setCroppedImages] = useState<ExamCroppedImage[]>([]);

  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [whiteboardDialogIndex, setWhiteboardDialogIndex] = useState<number | null>(null);

  const handleGenerateQuestions = async () => {
    if (!topics.trim()) {
      toast.error('Describe los temas para generar preguntas');
      return;
    }
    if (!includeMultipleChoice) {
      toast.error('Selecciona al menos opción múltiple para generar el examen');
      return;
    }
    if (generateLockRef.current) return;
    generateLockRef.current = true;

    setGenerating(true);
    try {
      const response = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({
          topics: topics.trim(),
          count: questionCount,
          difficulty: difficultyLevel,
          includeMultipleChoice,
          includeOpenAnswer: false,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Sesión expirada. Inicia sesión de nuevo.');
        }
        const errBody = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(errBody.message || errBody.error || 'Error al generar preguntas');
      }

      const data = await response.json();
      const uniqueQuestions = dedupeExamQuestions(data.questions as GeneratedQuestion[]);
      if (uniqueQuestions.length < data.questions.length) {
        toast.message(
          `Se omitieron ${data.questions.length - uniqueQuestions.length} preguntas repetidas`
        );
      }
      if (uniqueQuestions.length < questionCount) {
        toast.warning(
          `Solo se obtuvieron ${uniqueQuestions.length} de ${questionCount} preguntas. Intenta de nuevo o reduce el número.`
        );
      }
      const pointValues = distributeExamPoints(uniqueQuestions.length);
      setGeneratedQuestions(
        uniqueQuestions.map((q: GeneratedQuestion, index: number) => ({
          ...q,
          points: pointValues[index],
        }))
      );
      setQuestionSourceMode('ia');
      setCurrentStep(3);
      toast.success(
        `${uniqueQuestions.length} pregunta${uniqueQuestions.length === 1 ? '' : 's'} generada${uniqueQuestions.length === 1 ? '' : 's'}`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      toast.error('Error al generar preguntas', {
        description: toSpanishAuthMessage(message),
      });
    } finally {
      generateLockRef.current = false;
      setGenerating(false);
    }
  };

  const handleParsePdf = async () => {
    if (!pdfFile) {
      toast.error('Selecciona un archivo PDF');
      return;
    }
    if (generateLockRef.current) return;
    generateLockRef.current = true;

    setGenerating(true);
    try {
      const form = new FormData();
      form.append('file', pdfFile);
      const response = await fetch('/api/exams/parse-pdf', {
        method: 'POST',
        headers: await dashboardAuthHeadersOnly(),
        body: form,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Sesión expirada. Inicia sesión de nuevo.');
        }
        const errBody = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(errBody.message || errBody.error || 'Error al leer el PDF');
      }

      const data = await response.json();
      const uniqueQuestions = dedupeExamQuestions((data.questions ?? []) as GeneratedQuestion[]);
      if (uniqueQuestions.length < (data.questions?.length ?? 0)) {
        toast.message(
          `Se omitieron ${(data.questions?.length ?? 0) - uniqueQuestions.length} preguntas repetidas`
        );
      }
      const pointValues = distributeExamPoints(uniqueQuestions.length);
      setGeneratedQuestions(
        uniqueQuestions.map((q, index) => ({
          ...q,
          illustration: undefined,
          points: pointValues[index],
        }))
      );
      setQuestionSourceMode('pdf');
      setCurrentStep(3);
      toast.success(`${uniqueQuestions.length} preguntas extraídas del PDF`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      toast.error('Error al procesar el PDF', {
        description: toSpanishAuthMessage(message),
      });
    } finally {
      generateLockRef.current = false;
      setGenerating(false);
    }
  };

  const handleStartManual = () => {
    setGeneratedQuestions([]);
    setQuestionSourceMode('manual');
    setCurrentStep(3);
  };

  const handleSaveExam = async () => {
    if (!title.trim()) {
      toast.error('El título del examen es requerido');
      return;
    }

    if (generatedQuestions.length === 0) {
      toast.error('Agrega al menos una pregunta al examen');
      return;
    }

    const uniqueForSave = dedupeExamQuestions(
      generatedQuestions.filter((q) => q.text.trim())
    );
    if (uniqueForSave.length < generatedQuestions.filter((q) => q.text.trim()).length) {
      toast.error('Hay preguntas con el mismo enunciado. Elimina o edita los duplicados.');
      return;
    }

    for (const q of generatedQuestions) {
      if (!q.text.trim()) {
        toast.error('Todas las preguntas deben tener enunciado');
        return;
      }
      if (q.type === 'multiple_choice') {
        const options = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
        if (options.length < 2) {
          toast.error('Cada pregunta de opción múltiple necesita al menos 2 opciones');
          return;
        }
        const correct = q.correct_answer?.trim();
        if (!correct || !options.includes(correct)) {
          toast.error('Indica la respuesta correcta en cada pregunta de opción múltiple');
          return;
        }
      }
      const points = q.points ?? 0;
      if (!Number.isFinite(points) || points <= 0) {
        toast.error('Cada pregunta debe tener un valor mayor a 0');
        return;
      }
    }

    const totalPoints = examMaxScore(generatedQuestions);
    if (totalPoints > EXAM_POINTS_CAP) {
      toast.error(`La suma de puntos (${totalPoints}) no puede superar ${EXAM_POINTS_CAP}`);
      return;
    }

    const missingWhiteboard = generatedQuestions.find(
      (q) =>
        q.responseMode === 'whiteboard' &&
        (!decodeWhiteboardReference(q.correct_answer ?? null) ||
          !hasWhiteboardExpectedText(q.correct_answer ?? null))
    );
    if (missingWhiteboard) {
      toast.error('Falta la respuesta de referencia en pizarrón', {
        description: `Dibuja y confirma el texto esperado para: "${missingWhiteboard.text.slice(0, 80)}…"`,
      });
      return;
    }

    if (saveExamLockRef.current) return;
    saveExamLockRef.current = true;

    setLoading(true);
    try {
      const exam = await createExam({
        title: title.trim(),
        description: description.trim() || null,
        group_id: selectedGroupIds[0] ?? null,
        folder_id: createFolderId,
        status: 'draft',
      });

      if (!exam) {
        throw new Error(
          'No se pudo crear el examen. En Supabase, ejecuta las migraciones del proyecto (supabase/migrations), especialmente 20250323100000_core_schema.sql.'
        );
      }

      const groupAssignRes = await fetch(`/api/exams/${exam.id}`, {
        method: 'PATCH',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ group_ids: selectedGroupIds }),
      });
      const groupAssignBody = (await groupAssignRes.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        hint?: string;
      };
      if (!groupAssignRes.ok) {
        await deleteExam(exam.id);
        const detail = [groupAssignBody.message, groupAssignBody.hint].filter(Boolean).join(' — ');
        throw new Error(detail || groupAssignBody.error || 'No se pudieron asignar los grupos al examen');
      }

      const questionsToAdd = generatedQuestions.map((q) => {
        const options =
          q.type === 'multiple_choice'
            ? (q.options ?? []).map((o) => o.trim()).filter(Boolean)
            : null;
        return {
          text: q.text.trim(),
          type: q.type,
          options,
          correct_answer:
            q.responseMode === 'whiteboard'
              ? q.correct_answer || null
              : q.correct_answer?.trim() || null,
          illustration: q.illustration || null,
          points: Math.round(q.points ?? 1),
        };
      });

      const response = await fetch(`/api/exams/${exam.id}/questions`, {
        method: 'POST',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ questions: questionsToAdd }),
      });

      const resBody = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        hint?: string;
      };

      if (!response.ok) {
        await deleteExam(exam.id);
        if (response.status === 401) {
          throw new Error('Sesión expirada. Inicia sesión de nuevo.');
        }
        if (response.status === 404) {
          throw new Error(
            'No se encontró el examen o no tienes permiso. Revisa Supabase y las migraciones.'
          );
        }
        const detail = [resBody.message, resBody.hint].filter(Boolean).join(' — ');
        throw new Error(detail || resBody.error || 'Error al guardar las preguntas');
      }

      toast.success('Examen creado exitosamente');
      router.push(`/exams/${exam.id}`);
    } catch (error: unknown) {
      const msg = toSpanishAuthMessage(
        error instanceof Error ? error.message : 'Error desconocido'
      );
      const longHint = /migraciones|Supabase|schema|relation/i.test(msg);
      toast.error('Error al guardar el examen', {
        description: msg,
        duration: longHint ? 14_000 : 6_000,
      });
    } finally {
      saveExamLockRef.current = false;
      setLoading(false);
    }
  };

  const updateQuestion = (index: number, updates: Partial<GeneratedQuestion>) => {
    setGeneratedQuestions((prev) => {
      const next = prev.map((q, i) => (i === index ? { ...q, ...updates } : q));
      if (updates.text !== undefined) {
        const text = updates.text.trim();
        if (text) {
          const normalized = normalizeQuestionText(text);
          const duplicate = next.some(
            (q, i) => i !== index && normalizeQuestionText(q.text) === normalized
          );
          if (duplicate) {
            toast.error('Ya existe una pregunta con ese enunciado');
            return prev;
          }
        }
      }
      return next;
    });
  };

  const removeQuestion = (index: number) => {
    setGeneratedQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const addQuestion = () => {
    setGeneratedQuestions((prev) => {
      const next = [...prev, createEmptyQuestion()];
      const values = distributeExamPoints(next.length);
      return next.map((q, index) => ({ ...q, points: values[index] }));
    });
  };

  const totalPoints = examMaxScore(generatedQuestions);
  const pointsOverCap = totalPoints > EXAM_POINTS_CAP;
  const isEditableReview = questionSourceMode === 'manual' || questionSourceMode === 'pdf';

  const redistributePointsEvenly = () => {
    const values = distributeExamPoints(generatedQuestions.length);
    setGeneratedQuestions((prev) =>
      prev.map((q, index) => ({ ...q, points: values[index] }))
    );
  };

  const modeOptions: { id: QuestionSourceMode; label: string; icon: typeof Sparkles; description: string }[] = [
    {
      id: 'ia',
      label: 'Con IA',
      icon: Sparkles,
      description: 'Genera preguntas a partir de los temas que indiques.',
    },
    {
      id: 'pdf',
      label: 'Desde PDF',
      icon: Upload,
      description: 'Sube un examen en PDF y extrae las preguntas automáticamente.',
    },
    {
      id: 'manual',
      label: 'Manual',
      icon: PenLine,
      description: 'Escribe cada pregunta tú mismo, una por una.',
    },
  ];

  return (
    <div className="mx-auto min-h-full w-full max-w-7xl space-y-4 pb-2 sm:space-y-6">
      <div className="flex items-start gap-3 sm:items-center sm:gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Crear Examen</h1>
          <p className="mt-1 text-sm text-gray-600 sm:text-base">
            Crea un examen con IA, importa un PDF o agrégalo pregunta por pregunta
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 sm:px-4 ${
                  currentStep === step.id
                    ? 'bg-orange-600 text-white'
                    : currentStep > step.id
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                }`}
              >
                <step.icon className="w-4 h-4" />
                <span className="hidden text-sm font-medium sm:inline">{step.title}</span>
                {currentStep > step.id && <Check className="w-4 h-4 ml-1" />}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`w-8 h-0.5 mx-2 ${
                    currentStep > step.id ? 'bg-green-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Título del examen *</Label>
                <Input
                  id="title"
                  name="title"
                  placeholder="Ej: Examen de Matemáticas - Unidad 1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descripción</Label>
                <Textarea
                  id="description"
                  placeholder="Describe el contenido del examen..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Grupos (opcional, puedes elegir varios)</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {groups.length === 0 ? (
                    <p className="text-sm text-gray-500">Aun no tienes grupos creados.</p>
                  ) : (
                    groups.map((group) => {
                      const checked = selectedGroupIds.includes(group.id);
                      return (
                        <label key={group.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => {
                              const enabled = value === true;
                              setSelectedGroupIds((prev) =>
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
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => setCurrentStep(2)}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  Siguiente
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">¿Cómo quieres crear las preguntas?</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Elige un método. Podrás revisar y editar todo antes de guardar el examen.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {modeOptions.map((mode) => {
                  const Icon = mode.icon;
                  const selected = questionSourceMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setQuestionSourceMode(mode.id)}
                      className={`rounded-lg border-2 p-4 text-left transition-colors ${
                        selected
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 hover:border-orange-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <Icon className={`h-5 w-5 ${selected ? 'text-orange-600' : 'text-gray-500'}`} />
                        <span className="font-medium text-gray-900">{mode.label}</span>
                      </div>
                      <p className="text-sm text-gray-600">{mode.description}</p>
                    </button>
                  );
                })}
              </div>

              {questionSourceMode === 'ia' && (
                <div className="space-y-6 rounded-lg border border-orange-100 bg-orange-50/50 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="topics">Temas a evaluar *</Label>
                    <Textarea
                      id="topics"
                      placeholder="Ej: Ecuaciones lineales, sistemas de ecuaciones, factorización..."
                      value={topics}
                      onChange={(e) => setTopics(e.target.value)}
                      rows={4}
                    />
                    <p className="text-sm text-gray-500">
                      Describe los temas separados por comas para obtener mejores resultados.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <Label>Número de preguntas: {questionCount}</Label>
                    <Slider
                      value={[questionCount]}
                      onValueChange={(value) => setQuestionCount(value[0])}
                      min={1}
                      max={30}
                      step={1}
                    />
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>1</span>
                      <span>15</span>
                      <span>30</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="difficulty">Nivel de dificultad</Label>
                    <Select
                      value={difficultyLevel}
                      onValueChange={(v) =>
                        setDifficultyLevel(v as 'easy' | 'medium' | 'hard' | 'extreme')
                      }
                    >
                      <SelectTrigger id="difficulty" className="w-full max-w-md">
                        <SelectValue placeholder="Selecciona el nivel" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">Fácil — conceptos básicos y lenguaje claro</SelectItem>
                        <SelectItem value="medium">Medio — razonamiento típico de examen</SelectItem>
                        <SelectItem value="hard">Difícil — mayor profundidad y análisis</SelectItem>
                        <SelectItem value="extreme">Extremo — máximo rigor, muy exigente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <Label>Tipos de preguntas</Label>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="multipleChoice"
                        checked={includeMultipleChoice}
                        onCheckedChange={(checked) => setIncludeMultipleChoice(checked as boolean)}
                      />
                      <Label htmlFor="multipleChoice" className="font-normal">
                        Opción múltiple
                      </Label>
                    </div>
                  </div>
                </div>
              )}

              {questionSourceMode === 'pdf' && (
                <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                  <div className="space-y-2">
                    <Label>Archivo PDF del examen *</Label>
                    <input
                      ref={pdfInputRef}
                      id="exam-create-pdf"
                      name="exam-pdf"
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setPdfFile(file);
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => pdfInputRef.current?.click()}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Elegir PDF
                      </Button>
                      {pdfFile && (
                        <span className="text-sm text-gray-600">{pdfFile.name}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Sube el PDF, recorta las figuras que quieras usar y luego extrae las preguntas.
                      En el siguiente paso podrás elegir qué imagen va en cada pregunta.
                    </p>
                  </div>

                  {pdfFile && (
                    <ExamPdfPreviewCrop
                      file={pdfFile}
                      croppedImages={croppedImages}
                      onCroppedImagesChange={setCroppedImages}
                    />
                  )}
                </div>
              )}

              {questionSourceMode === 'manual' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                  <p className="text-sm text-gray-600">
                    En el siguiente paso podrás agregar cada pregunta con su enunciado, opciones y
                    respuesta correcta.
                  </p>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Anterior
                </Button>

                {questionSourceMode === 'ia' && (
                  <Button
                    onClick={handleGenerateQuestions}
                    disabled={generating || !includeMultipleChoice}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generando...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4 mr-2" />
                        Generar Preguntas
                      </>
                    )}
                  </Button>
                )}

                {questionSourceMode === 'pdf' && (
                  <Button
                    onClick={handleParsePdf}
                    disabled={generating || !pdfFile}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Extrayendo...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Extraer Preguntas
                      </>
                    )}
                  </Button>
                )}

                {questionSourceMode === 'manual' && (
                  <Button onClick={handleStartManual} className="bg-orange-600 hover:bg-orange-700">
                    <PenLine className="w-4 h-4 mr-2" />
                    Agregar Preguntas
                  </Button>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="flex min-h-0 flex-col gap-4">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">
                    {questionSourceMode === 'manual'
                      ? `Preguntas (${generatedQuestions.length})`
                      : `Preguntas (${generatedQuestions.length})`}
                  </h3>
                  <p className={`text-sm ${pointsOverCap ? 'text-red-600' : 'text-gray-600'}`}>
                    Total: {totalPoints} / {EXAM_POINTS_CAP} puntos
                    {pointsOverCap ? ' — reduce el valor de alguna pregunta' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {questionSourceMode === 'manual' && (
                    <Button variant="outline" size="sm" onClick={addQuestion}>
                      <Plus className="w-4 h-4 mr-2" />
                      Agregar pregunta
                    </Button>
                  )}
                  {generatedQuestions.length > 0 && (
                    <Button variant="outline" size="sm" onClick={redistributePointsEvenly}>
                      Repartir {EXAM_POINTS_CAP} pts
                    </Button>
                  )}
                  {questionSourceMode === 'ia' && (
                    <Button variant="outline" size="sm" onClick={() => setCurrentStep(2)}>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Regenerar
                    </Button>
                  )}
                  {(questionSourceMode === 'pdf' || questionSourceMode === 'manual') && (
                    <Button variant="outline" size="sm" onClick={() => setCurrentStep(2)}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Cambiar método
                    </Button>
                  )}
                </div>
              </div>

              {generatedQuestions.length === 0 && questionSourceMode === 'manual' && (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
                  <PenLine className="mx-auto mb-3 h-8 w-8 text-gray-400" />
                  <p className="text-gray-600">Aún no hay preguntas. Agrega la primera.</p>
                  <Button className="mt-4 bg-orange-600 hover:bg-orange-700" onClick={addQuestion}>
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar primera pregunta
                  </Button>
                </div>
              )}

              {questionSourceMode === 'pdf' && croppedImages.length > 0 && (
                <p className="text-sm text-gray-600">
                  Tienes {croppedImages.length} imagen(es) recortada(s). En cada pregunta puedes activar
                  &quot;Incluir imagen ilustrativa&quot; y elegir cuál mostrar.
                </p>
              )}

              <div className="min-h-[12rem] max-h-[min(70vh,32rem)] space-y-4 overflow-y-auto overscroll-y-contain scroll-pt-2 py-2 pl-0.5 pr-2 [scrollbar-gutter:stable]">
                {generatedQuestions.map((question, index) => (
                  <Card key={index} className="scroll-mt-2 border-l-4 border-l-orange-500">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-500">
                              Pregunta {index + 1}
                            </span>
                            {!isEditableReview && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs ${
                                  question.type === 'multiple_choice'
                                    ? 'bg-orange-100 text-orange-700'
                                    : question.responseMode === 'whiteboard'
                                      ? 'bg-violet-100 text-violet-700'
                                      : 'bg-green-100 text-green-700'
                                }`}
                              >
                                {question.responseMode === 'whiteboard'
                                  ? 'Pizarrón'
                                  : question.type === 'multiple_choice'
                                    ? 'Opción múltiple'
                                    : 'Respuesta abierta'}
                              </span>
                            )}
                          </div>

                          {isEditableReview ? (
                            <>
                              <div className="space-y-2">
                                <Label htmlFor={`q-text-${index}`}>Enunciado *</Label>
                                <Textarea
                                  id={`q-text-${index}`}
                                  value={question.text}
                                  onChange={(e) => updateQuestion(index, { text: e.target.value })}
                                  rows={2}
                                  placeholder="Escribe la pregunta..."
                                />
                              </div>

                              {questionSourceMode === 'pdf' && croppedImages.length > 0 ? (
                                <QuestionImagePicker
                                  questionIndex={index}
                                  croppedImages={croppedImages}
                                  illustration={question.illustration}
                                  onChange={(illustration) => updateQuestion(index, { illustration })}
                                />
                              ) : (
                                question.illustration && (
                                  <QuestionIllustration illustration={question.illustration} />
                                )
                              )}

                              <div className="space-y-2">
                                <Label>Tipo de pregunta</Label>
                                <Select
                                  value={
                                    question.responseMode === 'whiteboard'
                                      ? 'whiteboard'
                                      : question.type
                                  }
                                  onValueChange={(v) => {
                                    if (v === 'whiteboard') {
                                      updateQuestion(index, {
                                        type: 'open_answer',
                                        responseMode: 'whiteboard',
                                        options: undefined,
                                        correct_answer: '',
                                      });
                                      setWhiteboardDialogIndex(index);
                                      return;
                                    }
                                    if (v === 'open_answer') {
                                      updateQuestion(index, {
                                        type: 'open_answer',
                                        responseMode: 'text',
                                        options: undefined,
                                        correct_answer: question.correct_answer &&
                                          !isWhiteboardCorrectAnswer(question.correct_answer)
                                          ? question.correct_answer
                                          : '',
                                      });
                                    } else {
                                      updateQuestion(index, {
                                        type: 'multiple_choice',
                                        responseMode: undefined,
                                        options: question.options?.length
                                          ? question.options
                                          : ['', '', '', ''],
                                      });
                                    }
                                  }}
                                >
                                  <SelectTrigger className="max-w-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="multiple_choice">Opción múltiple</SelectItem>
                                    <SelectItem value="open_answer">Respuesta abierta</SelectItem>
                                    <SelectItem value="whiteboard">Pizarrón</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {question.type === 'multiple_choice' && (
                                <div className="space-y-2">
                                  <Label>Opciones</Label>
                                  {(question.options ?? ['', '', '', '']).map((option, optIndex) => (
                                    <div key={optIndex} className="flex items-center gap-2">
                                      <span className="w-6 text-sm text-gray-500">
                                        {String.fromCharCode(65 + optIndex)}.
                                      </span>
                                      <Input
                                        id={`question-${index}-option-${optIndex}`}
                                        name={`question-${index}-option-${optIndex}`}
                                        value={option}
                                        placeholder={`Opción ${String.fromCharCode(65 + optIndex)}`}
                                        onChange={(e) => {
                                          const next = [...(question.options ?? ['', '', '', ''])];
                                          next[optIndex] = e.target.value;
                                          const trimmed = next.map((o) => o.trim()).filter(Boolean);
                                          const correct = question.correct_answer?.trim();
                                          updateQuestion(index, {
                                            options: next,
                                            correct_answer:
                                              correct && trimmed.includes(correct)
                                                ? correct
                                                : trimmed[0] ?? '',
                                          });
                                        }}
                                      />
                                    </div>
                                  ))}
                                  <div className="space-y-2 pt-1">
                                    <Label>Respuesta correcta</Label>
                                    <Select
                                      value={question.correct_answer ?? ''}
                                      onValueChange={(v) =>
                                        updateQuestion(index, { correct_answer: v })
                                      }
                                    >
                                      <SelectTrigger className="max-w-md">
                                        <SelectValue placeholder="Selecciona la correcta" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {(question.options ?? [])
                                          .map((o) => o.trim())
                                          .filter(Boolean)
                                          .map((opt) => (
                                            <SelectItem key={opt} value={opt}>
                                              {opt}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              )}

                              {question.responseMode === 'whiteboard' && (
                                <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50/60 p-4">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <p className="text-sm font-semibold text-orange-950">
                                        Respuesta de referencia en pizarrón
                                      </p>
                                      <p className="text-xs text-orange-900/80">
                                        Los alumnos dibujarán su respuesta en un espacio similar.
                                      </p>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="bg-orange-600 hover:bg-orange-700"
                                      onClick={() => setWhiteboardDialogIndex(index)}
                                    >
                                      <Presentation className="mr-2 h-4 w-4" />
                                      {decodeWhiteboardReference(question.correct_answer ?? null)
                                        ? 'Editar referencia'
                                        : 'Dibujar referencia'}
                                    </Button>
                                  </div>
                                  {decodeWhiteboardReference(question.correct_answer ?? null) ? (
                                    <>
                                      <ExamWhiteboard
                                        readOnly
                                        value={decodeWhiteboardReference(question.correct_answer ?? null)}
                                      />
                                      {hasWhiteboardExpectedText(question.correct_answer ?? null) && (
                                        <p className="mt-2 text-sm text-green-800">
                                          Texto esperado:{' '}
                                          <strong>
                                            {decodeWhiteboardExpectedText(question.correct_answer ?? null)}
                                          </strong>
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <p className="text-sm text-amber-800">
                                      Aún no has dibujado la respuesta de referencia. Es obligatoria
                                      para guardar el examen.
                                    </p>
                                  )}
                                </div>
                              )}

                              {question.type === 'open_answer' && question.responseMode !== 'whiteboard' && (
                                <div className="space-y-2">
                                  <Label>Respuesta esperada (opcional)</Label>
                                  <Input
                                    id={`question-${index}-expected-answer`}
                                    name={`question-${index}-expected-answer`}
                                    value={
                                      isWhiteboardCorrectAnswer(question.correct_answer)
                                        ? ''
                                        : (question.correct_answer ?? '')
                                    }
                                    onChange={(e) =>
                                      updateQuestion(index, { correct_answer: e.target.value })
                                    }
                                    placeholder="Respuesta modelo para calificación..."
                                  />
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="mb-2 font-medium">{question.text}</p>

                              {question.type === 'multiple_choice' && question.options && (
                                <div className="ml-4 space-y-1">
                                  {question.options.map((option, optIndex) => (
                                    <div
                                      key={optIndex}
                                      className={`text-sm ${
                                        option === question.correct_answer
                                          ? 'font-medium text-green-600'
                                          : 'text-gray-600'
                                      }`}
                                    >
                                      {String.fromCharCode(65 + optIndex)}. {option}
                                      {option === question.correct_answer && ' ✓'}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {question.responseMode === 'whiteboard' &&
                                decodeWhiteboardReference(question.correct_answer ?? null) && (
                                  <div className="mt-2">
                                    <p className="mb-2 text-sm font-medium text-green-700">
                                      Referencia en pizarrón ✓
                                    </p>
                                    <ExamWhiteboard
                                      readOnly
                                      value={decodeWhiteboardReference(question.correct_answer ?? null)}
                                    />
                                    {hasWhiteboardExpectedText(question.correct_answer ?? null) && (
                                      <p className="mt-2 text-sm text-green-800">
                                        Texto esperado:{' '}
                                        <strong>
                                          {decodeWhiteboardExpectedText(question.correct_answer ?? null)}
                                        </strong>
                                      </p>
                                    )}
                                  </div>
                                )}

                              {question.type === 'open_answer' &&
                                question.responseMode !== 'whiteboard' &&
                                question.correct_answer &&
                                !isWhiteboardCorrectAnswer(question.correct_answer) && (
                                <p className="mt-2 text-sm text-green-600">
                                  Respuesta esperada: {question.correct_answer}
                                </p>
                              )}

                              {question.illustration && (
                                <QuestionIllustration
                                  illustration={question.illustration}
                                  className="mb-2 ml-0"
                                />
                              )}
                            </>
                          )}

                          <div className="flex items-center gap-2">
                            <Label htmlFor={`question-points-${index}`} className="text-xs text-gray-600">
                              Valor (puntos)
                            </Label>
                            <Input
                              id={`question-points-${index}`}
                              name={`question-points-${index}`}
                              type="number"
                              min="1"
                              step="1"
                              className="h-8 w-24"
                              value={question.points ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (!raw.trim()) {
                                  updateQuestion(index, { points: undefined });
                                  return;
                                }
                                const parsed = Math.round(Number(raw));
                                if (Number.isFinite(parsed) && parsed > 0) {
                                  updateQuestion(index, { points: parsed });
                                }
                              }}
                            />
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:bg-red-50 hover:text-red-700"
                          onClick={() => removeQuestion(index)}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex shrink-0 justify-between gap-2 border-t border-gray-100 pt-4">
                <Button variant="outline" onClick={() => setCurrentStep(2)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Anterior
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSaveExam()}
                  disabled={loading || generatedQuestions.length === 0 || pointsOverCap}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Guardar Examen
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <WhiteboardReferenceDialog
        open={whiteboardDialogIndex !== null}
        onOpenChange={(open) => {
          if (!open) setWhiteboardDialogIndex(null);
        }}
        initialReference={
          whiteboardDialogIndex !== null
            ? generatedQuestions[whiteboardDialogIndex]?.correct_answer ?? null
            : null
        }
        questionText={
          whiteboardDialogIndex !== null
            ? generatedQuestions[whiteboardDialogIndex]?.text ?? ''
            : ''
        }
        onSave={(encoded) => {
          if (whiteboardDialogIndex === null) return;
          updateQuestion(whiteboardDialogIndex, { correct_answer: encoded });
        }}
      />
    </div>
  );
}
