'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useExams } from '@/hooks/useExams';
import { buildExamFolderPath, useExamFolders } from '@/hooks/useExamFolders';
import { supabase } from '@/lib/supabase';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { printExamDocument, openPrintPreviewWindow } from '@/lib/printExam';
import { downloadExamWord } from '@/lib/wordExam';
import { sortExamQuestions } from '@/lib/examQuestions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FileText,
  Plus,
  Search,
  Loader2,
  Calendar,
  BarChart3,
  MoreVertical,
  Trash2,
  Eye,
  Download,
  Printer,
  CopyPlus,
  Folder,
  FolderPlus,
  ChevronRight,
  Home,
  Pencil,
  FolderInput,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { Exam, ExamFolder, ExamWithQuestions } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

function folderMoveOptions(
  folders: ExamFolder[],
  parentId: string | null,
  depth = 0,
  excludeId?: string
): Array<{ id: string | null; label: string }> {
  const options: Array<{ id: string | null; label: string }> = [];
  if (depth === 0) {
    options.push({ id: null, label: 'Raíz (sin carpeta)' });
  }
  for (const folder of folders.filter((f) => f.parent_id === parentId && f.id !== excludeId)) {
    options.push({
      id: folder.id,
      label: `${'— '.repeat(depth)}${folder.name}`,
    });
    options.push(...folderMoveOptions(folders, folder.id, depth + 1, excludeId));
  }
  return options;
}

export default function ExamsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { exams, loading: examsLoading, deleteExam, updateExam } = useExams(user?.id);
  const {
    folders,
    loading: foldersLoading,
    createFolder,
    renameFolder,
    deleteFolder,
  } = useExamFolders(user?.id);

  const currentFolderId = searchParams.get('folder');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'published' | 'closed'>('all');
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogName, setFolderDialogName] = useState('');
  const [editingFolder, setEditingFolder] = useState<ExamFolder | null>(null);
  const [folderSaving, setFolderSaving] = useState(false);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status === 'all' || status === 'draft' || status === 'published' || status === 'closed') {
      setFilterStatus(status);
    }
  }, [searchParams]);

  const folderPath = useMemo(
    () => buildExamFolderPath(folders, currentFolderId),
    [folders, currentFolderId]
  );

  const inSearchMode = searchTerm.trim().length > 0;
  const loading = examsLoading || foldersLoading;

  const childFolders = useMemo(() => {
    if (inSearchMode) return [];
    return folders.filter((f) =>
      currentFolderId ? f.parent_id === currentFolderId : f.parent_id === null
    );
  }, [folders, currentFolderId, inSearchMode]);

  const visibleExams = useMemo(() => {
    return exams.filter((exam) => {
      const matchesSearch =
        exam.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        exam.description?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || exam.status === filterStatus;
      const inFolder = inSearchMode
        ? true
        : currentFolderId
          ? exam.folder_id === currentFolderId
          : !exam.folder_id;
      return matchesSearch && matchesStatus && inFolder;
    });
  }, [exams, searchTerm, filterStatus, currentFolderId, inSearchMode]);

  const openCreateFolder = () => {
    setEditingFolder(null);
    setFolderDialogName('');
    setFolderDialogOpen(true);
  };

  const openRenameFolder = (folder: ExamFolder) => {
    setEditingFolder(folder);
    setFolderDialogName(folder.name);
    setFolderDialogOpen(true);
  };

  const handleSaveFolder = async () => {
    const name = folderDialogName.trim();
    if (!name) {
      toast.error('Escribe un nombre para la carpeta');
      return;
    }
    setFolderSaving(true);
    try {
      if (editingFolder) {
        const ok = await renameFolder(editingFolder.id, name);
        if (ok) {
          toast.success('Carpeta renombrada');
          setFolderDialogOpen(false);
        } else {
          toast.error('No se pudo renombrar la carpeta');
        }
      } else {
        const { folder: created, error: createError } = await createFolder(name, currentFolderId);
        if (created) {
          toast.success('Carpeta creada');
          setFolderDialogOpen(false);
        } else {
          toast.error(createError || 'No se pudo crear la carpeta', {
            description:
              createError?.includes('exam_folders') || createError?.includes('schema cache')
                ? 'Ejecuta en Supabase el archivo 20260624110000_exam_folders_grants_and_policy_fix.sql'
                : undefined,
            duration: 8000,
          });
        }
      }
    } finally {
      setFolderSaving(false);
    }
  };

  const handleDeleteFolder = async (folder: ExamFolder) => {
    const childCount = folders.filter((f) => f.parent_id === folder.id).length;
    const examCount = exams.filter((e) => e.folder_id === folder.id).length;
    const msg =
      childCount > 0 || examCount > 0
        ? `¿Eliminar "${folder.name}"? Las subcarpetas se borrarán y los exámenes quedarán en la raíz.`
        : `¿Eliminar la carpeta "${folder.name}"?`;
    if (!window.confirm(msg)) return;

    const ok = await deleteFolder(folder.id);
    if (ok) {
      toast.success('Carpeta eliminada');
      if (currentFolderId === folder.id) {
        router.push('/exams');
      }
    } else {
      toast.error('No se pudo eliminar la carpeta');
    }
  };

  const navigateToFolder = (folderId: string | null) => {
    if (!folderId) {
      router.push('/exams');
      return;
    }
    router.push(`/exams?folder=${folderId}`);
  };

  const handleDeleteExam = async (examId: string) => {
    const success = await deleteExam(examId);
    if (success) toast.success('Examen eliminado');
  };

  const handleMoveExam = async (examId: string, folderId: string | null) => {
    const ok = await updateExam(examId, { folder_id: folderId });
    if (ok) toast.success('Examen movido');
    else toast.error('No se pudo mover el examen');
  };

  const createExamHref = currentFolderId
    ? `/exams/create?folder=${currentFolderId}`
    : '/exams/create';

  const isEmpty = !loading && childFolders.length === 0 && visibleExams.length === 0;

  return (
    <div className="mx-auto min-h-full w-full max-w-7xl space-y-4 pb-2 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Exámenes</h1>
          <p className="mt-0.5 text-sm text-gray-600 sm:mt-1 sm:text-base">
            Organiza tus exámenes en carpetas y subcarpetas
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="h-9 w-full sm:h-10 sm:w-auto"
            onClick={openCreateFolder}
          >
            <FolderPlus className="mr-2 h-4 w-4" />
            Nueva carpeta
          </Button>
          <Link href={createExamHref} className="shrink-0">
            <Button className="h-9 w-full bg-orange-600 text-sm hover:bg-orange-700 sm:h-10 sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Examen
            </Button>
          </Link>
        </div>
      </div>

      {!inSearchMode && folderPath.length > 0 && (
        <nav className="flex flex-wrap items-center gap-1 text-sm text-gray-600">
          <button
            type="button"
            onClick={() => navigateToFolder(null)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-orange-50 hover:text-orange-700"
            aria-label="Ir a la raíz de exámenes"
          >
            <Home className="h-4 w-4" />
          </button>
          {folderPath.map((folder) => (
            <span key={folder.id} className="inline-flex items-center gap-1">
              <ChevronRight className="h-4 w-4 text-gray-400" />
              <button
                type="button"
                onClick={() => navigateToFolder(folder.id)}
                className="max-w-[12rem] truncate rounded-md px-2 py-1 hover:bg-orange-50 hover:text-orange-700 sm:max-w-xs"
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder={inSearchMode ? 'Buscando en todos los exámenes…' : 'Buscar en esta carpeta…'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 pt-0.5 sm:mx-0 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0">
          {(['all', 'draft', 'published', 'closed'] as const).map((status) => (
            <Button
              key={status}
              variant={filterStatus === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus(status)}
              className={`shrink-0 text-xs sm:text-sm ${filterStatus === status ? 'bg-orange-600 hover:bg-orange-700' : ''}`}
            >
              {status === 'all'
                ? 'Todos'
                : status === 'draft'
                  ? 'Borradores'
                  : status === 'published'
                    ? 'Publicados'
                    : 'Cerrados'}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
        </div>
      ) : isEmpty ? (
        <Card className="p-8 text-center sm:p-12">
          <Folder className="mx-auto mb-4 h-16 w-16 text-gray-300" />
          <h3 className="mb-2 text-xl font-medium text-gray-900">
            {searchTerm ? 'No se encontraron exámenes' : 'Esta carpeta está vacía'}
          </h3>
          <p className="mb-6 text-gray-500">
            {searchTerm
              ? 'Intenta con otra búsqueda'
              : 'Crea una carpeta o un examen para comenzar'}
          </p>
          {!searchTerm && (
            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button variant="outline" onClick={openCreateFolder}>
                <FolderPlus className="mr-2 h-4 w-4" />
                Nueva carpeta
              </Button>
              <Link href={createExamHref}>
                <Button className="bg-orange-600 hover:bg-orange-700">
                  <Plus className="mr-2 h-4 w-4" />
                  Crear examen
                </Button>
              </Link>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-2 2xl:grid-cols-3">
          {childFolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              examCount={exams.filter((e) => e.folder_id === folder.id).length}
              subfolderCount={folders.filter((f) => f.parent_id === folder.id).length}
              onOpen={() => navigateToFolder(folder.id)}
              onRename={() => openRenameFolder(folder)}
              onDelete={() => void handleDeleteFolder(folder)}
            />
          ))}
          {visibleExams.map((exam) => (
            <ExamCard
              key={exam.id}
              exam={exam}
              folders={folders}
              onDelete={handleDeleteExam}
              onMove={(folderId) => void handleMoveExam(exam.id, folderId)}
            />
          ))}
        </div>
      )}

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingFolder ? 'Renombrar carpeta' : 'Nueva carpeta'}</DialogTitle>
            <DialogDescription>
              {editingFolder
                ? 'Cambia el nombre de la carpeta.'
                : currentFolderId
                  ? 'Se creará dentro de la carpeta actual. También puedes crear subcarpetas al entrar en una carpeta.'
                  : 'Crea una carpeta en la raíz de tus exámenes.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="folder-name">Nombre</Label>
            <Input
              id="folder-name"
              value={folderDialogName}
              onChange={(e) => setFolderDialogName(e.target.value)}
              placeholder="Ej. Física 1er parcial"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveFolder();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              disabled={folderSaving}
              onClick={() => void handleSaveFolder()}
            >
              {folderSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingFolder ? 'Guardar' : 'Crear carpeta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderCard({
  folder,
  examCount,
  subfolderCount,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: ExamFolder;
  examCount: number;
  subfolderCount: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      className="cursor-pointer border-orange-100 bg-orange-50/40 transition-shadow hover:shadow-lg"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100">
              <Folder className="h-6 w-6 text-orange-600" />
            </div>
            <div className="min-w-0">
              <CardTitle className="line-clamp-2 text-lg font-semibold">{folder.name}</CardTitle>
              <CardDescription className="mt-1">
                {subfolderCount > 0 && `${subfolderCount} subcarpeta${subfolderCount === 1 ? '' : 's'}`}
                {subfolderCount > 0 && examCount > 0 && ' · '}
                {examCount > 0 && `${examCount} examen${examCount === 1 ? '' : 'es'}`}
                {subfolderCount === 0 && examCount === 0 && 'Vacía'}
              </CardDescription>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onOpen}>
                <FolderInput className="mr-2 h-4 w-4" />
                Abrir
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 h-4 w-4" />
                Renombrar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-gray-500">Clic para abrir · {formatDate(folder.created_at)}</p>
      </CardContent>
    </Card>
  );
}

async function fetchExamWithQuestions(examId: string): Promise<ExamWithQuestions | null> {
  const { data: examData, error: examError } = await supabase
    .from('exams')
    .select('*')
    .eq('id', examId)
    .single();
  if (examError || !examData) return null;
  const { data: questions, error: qError } = await supabase
    .from('questions')
    .select('*')
    .eq('exam_id', examId)
    .order('created_at', { ascending: true });
  if (qError) return null;
  return { ...examData, questions: sortExamQuestions(questions ?? []) };
}

function ExamCard({
  exam,
  folders,
  onDelete,
  onMove,
}: {
  exam: Exam;
  folders: ExamFolder[];
  onDelete: (id: string) => void;
  onMove: (folderId: string | null) => void;
}) {
  const router = useRouter();
  const [menuBusy, setMenuBusy] = useState(false);
  const moveTargets = folderMoveOptions(folders, null);
  const statusConfig = {
    draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-700' },
    published: { label: 'Publicado', color: 'bg-green-100 text-green-700' },
    closed: { label: 'Cerrado', color: 'bg-gray-100 text-gray-700' },
  };

  const handleDeleteClick = () => {
    if (!window.confirm('¿Eliminar este examen? Esta acción no se puede deshacer.')) return;
    onDelete(exam.id);
  };

  const handleDownload = async () => {
    setMenuBusy(true);
    try {
      const full = await fetchExamWithQuestions(exam.id);
      if (!full) {
        toast.error('No se pudo cargar el examen');
        return;
      }
      if (full.questions.length === 0) {
        toast.error('El examen no tiene preguntas para descargar');
        return;
      }
      const base = exam.title.replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/gi, '').slice(0, 60) || 'examen';
      const ok = await downloadExamWord(full, base);
      if (ok) toast.success('Word descargado');
      else toast.error('No se pudo generar el documento Word');
    } finally {
      setMenuBusy(false);
    }
  };

  const handlePrint = () => {
    const printWin = openPrintPreviewWindow();
    if (!printWin) {
      toast.error('Permite ventanas emergentes para imprimir');
      return;
    }
    setMenuBusy(true);
    void (async () => {
      try {
        const full = await fetchExamWithQuestions(exam.id);
        if (!full) {
          toast.error('No se pudo cargar el examen');
          printWin.close();
          return;
        }
        if (full.questions.length === 0) {
          toast.error('Agrega al menos una pregunta para imprimir');
          printWin.close();
          return;
        }
        const ok = printExamDocument(full, { targetWindow: printWin });
        if (!ok) {
          toast.error('No se pudo abrir la vista de impresión');
          printWin.close();
        }
      } finally {
        setMenuBusy(false);
      }
    })();
  };

  const handleDuplicate = async () => {
    setMenuBusy(true);
    try {
      const response = await fetch(`/api/exams/${exam.id}/duplicate`, {
        method: 'POST',
        headers: await dashboardAuthJsonHeaders(),
      });
      const payload = (await response.json().catch(() => ({}))) as { examId?: string; error?: string };
      if (!response.ok || !payload.examId) {
        toast.error(payload.error || 'No se pudo duplicar el examen');
        return;
      }
      toast.success('Examen duplicado');
      router.push(`/exams/${payload.examId}`);
    } finally {
      setMenuBusy(false);
    }
  };

  return (
    <Card className="transition-shadow hover:shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1 text-lg font-semibold">{exam.title}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {exam.description || 'Sin descripción'}
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" disabled={menuBusy}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="mr-2 h-4 w-4" />
                  Mover a carpeta
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                  {moveTargets.map((target) => (
                    <DropdownMenuItem
                      key={target.id ?? 'root'}
                      disabled={target.id === exam.folder_id}
                      onClick={() => onMove(target.id)}
                    >
                      {target.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleDuplicate()}>
                <CopyPlus className="mr-2 h-4 w-4" />
                Duplicar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleDownload()}>
                <Download className="mr-2 h-4 w-4" />
                Descargar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-4">
          <Badge className={statusConfig[exam.status].color}>{statusConfig[exam.status].label}</Badge>
        </div>

        <div className="mb-4 flex items-center gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {formatDate(exam.created_at)}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <Link href={`/exams/${exam.id}`} className="min-w-0 flex-1">
            <Button variant="outline" size="sm" className="h-9 w-full">
              <Eye className="mr-2 h-4 w-4" />
              Ver
            </Button>
          </Link>
          {exam.status === 'published' || exam.status === 'closed' ? (
            <div className="flex min-w-0 flex-1 flex-col items-stretch">
              <div className="mb-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={handleDeleteClick}
                  aria-label="Eliminar examen"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Link href={`/exams/results/${exam.id}`} className="w-full">
                <Button size="sm" className="h-9 w-full bg-orange-600 hover:bg-orange-700">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Resultados
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleDeleteClick}
                aria-label="Eliminar examen"
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
