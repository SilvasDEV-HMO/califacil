'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useExam } from '@/hooks/useExams';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  QrCode, 
  Copy, 
  Download,
  Printer,
  Edit,
  Play,
  Lock,
  Trash2,
  Loader2,
  CheckCircle,
  FileText,
  Image as ImageIcon
} from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { Question } from '@/types';
import { printExamDocument } from '@/lib/printExam';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';

export default function ExamDetailPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.examId as string;
  const { exam, loading, updateQuestion, deleteQuestion } = useExam(examId);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [generatingQR, setGeneratingQR] = useState(false);

  useEffect(() => {
    if (exam && exam.status === 'published' && !exam.qr_code) {
      generateQRCode();
    }
  }, [exam]);

  const generateQRCode = async () => {
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
      
      // Save QR code to exam
      const qrRes = await fetch(`/api/exams/${exam.id}`, {
        method: 'PATCH',
        headers: await dashboardAuthJsonHeaders(),
        body: JSON.stringify({ qr_code: qrDataUrl }),
      });
      if (!qrRes.ok) {
        toast.error('No se pudo guardar el QR. Vuelve a iniciar sesión e inténtalo de nuevo.');
      }
    } catch (error) {
      toast.error('Error al generar el código QR');
    } finally {
      setGeneratingQR(false);
    }
  };

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
    } catch (error) {
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
    } catch (error) {
      toast.error('Error al cerrar el examen');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="text-center py-12">
        <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-xl font-medium text-gray-900 mb-2">Examen no encontrado</h3>
        <Button onClick={() => router.push('/exams')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/exams')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{exam.title}</h1>
              <Badge className={statusConfig[exam.status].color}>
                {statusConfig[exam.status].label}
              </Badge>
            </div>
            <p className="text-gray-600 mt-1">{exam.description || 'Sin descripción'}</p>
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
              <Button onClick={() => router.push(`/exams/results/${exam.id}`)} className="bg-orange-600 hover:bg-orange-700">
                Ver Resultados
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="questions" className="space-y-6">
        <TabsList>
          <TabsTrigger value="questions">
            <FileText className="w-4 h-4 mr-2" />
            Preguntas ({exam.questions.length})
          </TabsTrigger>
          {exam.status === 'published' && (
            <TabsTrigger value="qr">
              <QrCode className="w-4 h-4 mr-2" />
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
              isDraft={exam.status === 'draft'}
            />
          ))}
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
                    <div className="w-64 h-64 flex items-center justify-center bg-gray-100 rounded-lg">
                      <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                    </div>
                  ) : qrCodeUrl ? (
                    <div className="qr-container">
                      <img 
                        src={qrCodeUrl} 
                        alt="Código QR del examen" 
                        className="w-64 h-64"
                      />
                    </div>
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center bg-gray-100 rounded-lg">
                      <QrCode className="w-16 h-16 text-gray-300" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button variant="outline" onClick={copyExamLink}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copiar enlace
                  </Button>
                  {qrCodeUrl && (
                    <>
                      <Button variant="outline" onClick={() => window.open(qrCodeUrl, '_blank')}>
                        <Download className="w-4 h-4 mr-2" />
                        Descargar QR
                      </Button>
                      <Button variant="outline" onClick={() => window.print()}>
                        <Printer className="w-4 h-4 mr-2" />
                        Imprimir
                      </Button>
                    </>
                  )}
                </div>

                <div className="bg-orange-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-orange-900 mb-2">¿Cómo funciona?</h4>
                  <ol className="text-sm text-orange-700 space-y-1 list-decimal list-inside">
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
  isDraft 
}: { 
  question: Question; 
  index: number;
  onUpdate: (id: string, updates: Partial<Question>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  isDraft: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(question.text);

  const handleSave = async () => {
    const success = await onUpdate(question.id, { text: editedText });
    if (success) {
      setIsEditing(false);
      toast.success('Pregunta actualizada');
    }
  };

  const handleDelete = async () => {
    if (confirm('¿Estás seguro de eliminar esta pregunta?')) {
      const success = await onDelete(question.id);
      if (success) {
        toast.success('Pregunta eliminada');
      }
    }
  };

  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-500">
                Pregunta {index + 1}
              </span>
              <Badge className={question.type === 'multiple_choice' 
                ? 'bg-orange-100 text-orange-700' 
                : 'bg-green-100 text-green-700'
              }>
                {question.type === 'multiple_choice' ? 'Opción múltiple' : 'Respuesta abierta'}
              </Badge>
            </div>
            
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  className="w-full p-2 border rounded-md"
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave}>Guardar</Button>
                  <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <p className="font-medium">{question.text}</p>
            )}
            
            {question.type === 'multiple_choice' && question.options && (
              <div className="space-y-1 ml-4 mt-2">
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
            
            {question.illustration && (
              <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                <ImageIcon className="w-4 h-4" />
                <span className="italic">{question.illustration}</span>
              </div>
            )}
          </div>
          
          {isDraft && !isEditing && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleDelete}
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
