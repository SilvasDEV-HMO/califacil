'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useGroups } from '@/hooks/useGroups';
import { useExams } from '@/hooks/useExams';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  List
} from 'lucide-react';
import { toast } from 'sonner';
import { GeneratedQuestion } from '@/types';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';

const NO_GROUP_VALUE = '__none__';

const steps = [
  { id: 1, title: 'Información General', icon: FileText },
  { id: 2, title: 'Configuración IA', icon: Settings },
  { id: 3, title: 'Revisar Preguntas', icon: List },
];

export default function CreateExamPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { groups } = useGroups(user?.id);
  const { createExam } = useExams(user?.id);
  
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  // Step 1: General Info
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState(NO_GROUP_VALUE);
  
  // Step 2: AI Configuration
  const [topics, setTopics] = useState('');
  const [questionCount, setQuestionCount] = useState(10);
  const [difficultyLevel, setDifficultyLevel] = useState<
    'easy' | 'medium' | 'hard' | 'extreme'
  >('medium');
  const [includeMultipleChoice, setIncludeMultipleChoice] = useState(true);
  const [includeOpenAnswer, setIncludeOpenAnswer] = useState(true);
  
  // Step 3: Generated Questions
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);

  const handleGenerateQuestions = async () => {
    if (!topics.trim()) {
      toast.error('Describe los temas para generar preguntas');
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: topics.trim(),
          count: questionCount,
          difficulty: difficultyLevel,
          includeMultipleChoice,
          includeOpenAnswer,
        }),
      });

      if (!response.ok) {
        throw new Error('Error al generar preguntas');
      }

      const data = await response.json();
      setGeneratedQuestions(data.questions);
      setCurrentStep(3);
      toast.success(`${data.questions.length} preguntas generadas`);
    } catch (error: any) {
      toast.error('Error al generar preguntas', {
        description: error.message,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveExam = async () => {
    if (!title.trim()) {
      toast.error('El título del examen es requerido');
      return;
    }

    if (generatedQuestions.length === 0) {
      toast.error('Debes generar al menos una pregunta');
      return;
    }

    setLoading(true);
    try {
      // Create exam
      const exam = await createExam({
        title: title.trim(),
        description: description.trim() || null,
        group_id: selectedGroupId === NO_GROUP_VALUE ? null : selectedGroupId,
        status: 'draft',
      });

      if (!exam) {
        throw new Error('Error al crear el examen');
      }

      // Add questions
      const questionsToAdd = generatedQuestions.map(q => ({
        text: q.text,
        type: q.type,
        options: q.options || null,
        correct_answer: q.correct_answer || null,
        illustration: q.illustration || null,
      }));

      const response = await fetch(`/api/exams/${exam.id}/questions`, {
        method: 'POST',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ questions: questionsToAdd }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Sesión expirada. Inicia sesión de nuevo.');
        }
        throw new Error('Error al guardar las preguntas');
      }

      toast.success('Examen creado exitosamente');
      router.push(`/exams/${exam.id}`);
    } catch (error: any) {
      toast.error('Error al guardar el examen', {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const updateQuestion = (index: number, updates: Partial<GeneratedQuestion>) => {
    setGeneratedQuestions(prev => 
      prev.map((q, i) => i === index ? { ...q, ...updates } : q)
    );
  };

  const removeQuestion = (index: number) => {
    setGeneratedQuestions(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Crear Examen</h1>
          <p className="text-gray-600 mt-1">Crea un nuevo examen con ayuda de IA</p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div 
                className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                  currentStep === step.id 
                    ? 'bg-orange-600 text-white' 
                    : currentStep > step.id 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-gray-100 text-gray-500'
                }`}
              >
                <step.icon className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">{step.title}</span>
                {currentStep > step.id && <Check className="w-4 h-4 ml-1" />}
              </div>
              {index < steps.length - 1 && (
                <div className={`w-8 h-0.5 mx-2 ${
                  currentStep > step.id ? 'bg-green-500' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="p-6">
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Título del examen *</Label>
                <Input
                  id="title"
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
                <Label htmlFor="group">Grupo (opcional)</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_GROUP_VALUE}>Sin grupo</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-orange-600" />
                  <h3 className="font-semibold text-orange-900">Generación con IA</h3>
                </div>
                <p className="text-sm text-orange-700">
                  Describe los temas que quieres incluir en el examen y nuestra IA generará las preguntas automáticamente.
                </p>
              </div>

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
                    <SelectItem value="extreme">
                      Extremo — máximo rigor, muy exigente
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-gray-500">
                  La IA adaptará el lenguaje y la complejidad de los reactivos a este nivel.
                </p>
              </div>

              <div className="space-y-3">
                <Label>Tipos de preguntas</Label>
                <div className="flex gap-4">
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
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="openAnswer"
                      checked={includeOpenAnswer}
                      onCheckedChange={(checked) => setIncludeOpenAnswer(checked as boolean)}
                    />
                    <Label htmlFor="openAnswer" className="font-normal">
                      Respuesta abierta
                    </Label>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Anterior
                </Button>
                <Button 
                  onClick={handleGenerateQuestions}
                  disabled={generating || (!includeMultipleChoice && !includeOpenAnswer)}
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
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  Preguntas Generadas ({generatedQuestions.length})
                </h3>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setCurrentStep(2)}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Regenerar
                </Button>
              </div>

              <div className="space-y-4 max-h-96 overflow-y-auto">
                {generatedQuestions.map((question, index) => (
                  <Card key={index} className="border-l-4 border-l-orange-500">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-gray-500">
                              Pregunta {index + 1}
                            </span>
                            <span className={`px-2 py-0.5 text-xs rounded-full ${
                              question.type === 'multiple_choice' 
                                ? 'bg-orange-100 text-orange-700' 
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {question.type === 'multiple_choice' ? 'Opción múltiple' : 'Respuesta abierta'}
                            </span>
                          </div>
                          <p className="font-medium mb-2">{question.text}</p>
                          
                          {question.type === 'multiple_choice' && question.options && (
                            <div className="space-y-1 ml-4">
                              {question.options.map((option, optIndex) => (
                                <div 
                                  key={optIndex} 
                                  className={`text-sm ${
                                    option === question.correct_answer 
                                      ? 'text-green-600 font-medium' 
                                      : 'text-gray-600'
                                  }`}
                                >
                                  {String.fromCharCode(65 + optIndex)}. {option}
                                  {option === question.correct_answer && ' ✓'}
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {question.type === 'open_answer' && question.correct_answer && (
                            <p className="text-sm text-green-600 mt-2">
                              Respuesta esperada: {question.correct_answer}
                            </p>
                          )}
                          
                          {question.illustration && (
                            <p className="text-sm text-gray-500 mt-2 italic">
                              Ilustración: {question.illustration}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => removeQuestion(index)}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(2)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Anterior
                </Button>
                <Button 
                  onClick={handleSaveExam}
                  disabled={loading || generatedQuestions.length === 0}
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
    </div>
  );
}
