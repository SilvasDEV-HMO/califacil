'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useGroups, useStudents } from '@/hooks/useGroups';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Users, 
  Plus, 
  Trash2, 
  UserPlus, 
  Upload,
  Loader2,
  GraduationCap,
  Search,
  Download,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { parseStudentImportFile, type StudentImportResult } from '@/lib/studentImport';
import { toSpanishAuthMessage } from '@/lib/authErrors';

export default function GroupsPage() {
  const { user } = useAuth();
  const { groups, loading, createGroup, deleteGroup } = useGroups(user?.id);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (selectedGroup && !groups.some((g) => g.id === selectedGroup)) {
      setSelectedGroup(null);
    }
  }, [groups, selectedGroup]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error('El nombre del grupo es requerido');
      return;
    }

    const group = await createGroup(newGroupName.trim());
    if (group) {
      toast.success('Grupo creado exitosamente');
      setNewGroupName('');
      setIsCreateDialogOpen(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    setIsDeleting(groupId);
    const success = await deleteGroup(groupId);
    if (success) {
      toast.success('Grupo eliminado');
      if (selectedGroup === groupId) {
        setSelectedGroup(null);
      }
    }
    setIsDeleting(null);
  };

  return (
    <div className="mx-auto min-h-full w-full min-w-0 max-w-7xl space-y-4 overflow-x-hidden pb-2 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Grupos</h1>
          <p className="mt-0.5 text-sm text-gray-600 sm:mt-1 sm:text-base">
            Gestiona tus grupos y estudiantes
          </p>
        </div>
        <Button
          onClick={() => setIsCreateDialogOpen(true)}
          className="h-9 w-full bg-orange-600 text-sm hover:bg-orange-700 sm:h-10 sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Grupo
        </Button>
      </div>

      {/* Groups Grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
        </div>
      ) : groups.length === 0 ? (
        <Card className="p-8 text-center sm:p-12">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">No hay grupos aún</h3>
          <p className="text-gray-500 mb-6">Crea tu primer grupo para comenzar a organizar tus estudiantes</p>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="bg-orange-600 hover:bg-orange-700">
            <Plus className="w-4 h-4 mr-2" />
            Crear Grupo
          </Button>
        </Card>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          {/* Groups List */}
          <div
            className={`min-w-0 space-y-3 sm:space-y-4 ${
              selectedGroup ? 'hidden lg:col-span-1 lg:block' : 'lg:col-span-3'
            }`}
          >
            <h2 className="text-lg font-semibold text-gray-900">Mis Grupos</h2>
            <div className="space-y-3 overflow-visible p-0.5">
              {groups.map((group) => (
                <Card 
                  key={group.id} 
                  className={`min-w-0 cursor-pointer border-2 transition-all ${
                    selectedGroup === group.id 
                      ? 'border-orange-500 shadow-md' 
                      : 'border-transparent hover:shadow-md'
                  }`}
                  onClick={() => setSelectedGroup(group.id)}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-100">
                          <GraduationCap className="h-5 w-5 text-orange-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-semibold text-gray-900">{group.name}</h3>
                          <p className="truncate text-sm text-gray-500">
                            Creado el {new Date(group.created_at).toLocaleDateString('es-ES')}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 shrink-0 p-0 text-red-500 hover:bg-red-50 hover:text-red-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group.id);
                        }}
                        disabled={isDeleting === group.id}
                      >
                        {isDeleting === group.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Students Management */}
          {selectedGroup && (
            <div className="min-w-0 lg:col-span-2">
              <Button
                type="button"
                variant="outline"
                className="mb-3 w-full sm:w-auto lg:hidden"
                onClick={() => setSelectedGroup(null)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
              </Button>
              <StudentsManager 
                groupId={selectedGroup} 
                groupName={groups.find(g => g.id === selectedGroup)?.name || ''}
              />
            </div>
          )}
        </div>
      )}

      {/* Create Group Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nuevo Grupo</DialogTitle>
            <DialogDescription>
              Ingresa el nombre del grupo que deseas crear
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Nombre del grupo</Label>
              <Input
                id="groupName"
                placeholder="Ej: 1º A, 2º B, etc."
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateGroup} className="bg-orange-600 hover:bg-orange-700">
              Crear Grupo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StudentsManager({ groupId, groupName }: { groupId: string; groupName: string }) {
  const { students, loading, addStudent, addStudentsBatch, deleteStudent, error } = useStudents(groupId);
  const [newStudentName, setNewStudentName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [studentPendingDelete, setStudentPendingDelete] = useState<{ id: string; name: string } | null>(
    null
  );
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [importPreview, setImportPreview] = useState<StudentImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleAddStudent = async () => {
    if (!newStudentName.trim()) {
      toast.error('Escribe el nombre del estudiante');
      return;
    }
    
    setIsAdding(true);
    const result = await addStudent(newStudentName.trim());
    if (result === 'duplicate') {
      toast.error('Alumno Repetido, verifique el nombre y vuelva a intentar');
    } else if (result) {
      toast.success('Estudiante agregado');
      setNewStudentName('');
    } else {
      toast.error('No se pudo agregar el estudiante', {
        description: toSpanishAuthMessage(error || ''),
      });
    }
    setIsAdding(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = await parseStudentImportFile(file);
      if (parsed.students.length === 0) {
        toast.error(
          'No se encontraron alumnos. Usa la plantilla CSV/Excel o un PDF de lista de asistencia ITSON.'
        );
        return;
      }
      setImportPreview(parsed);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      toast.error('Error al procesar el archivo', {
        description: toSpanishAuthMessage(msg) || 'Revisa el archivo e inténtalo de nuevo.',
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setIsImporting(true);
    try {
      const { added, skipped, error: importError, warning } = await addStudentsBatch(
        importPreview.students.map((student) => ({
          name: student.name,
          controlNumber: student.controlNumber || null,
        }))
      );

      if (importError) {
        toast.error('Error al importar alumnos', {
          description: toSpanishAuthMessage(importError),
        });
        return;
      }

      if (added.length === 0 && skipped > 0) {
        toast.error('No se importó ningún alumno: todos ya estaban en el grupo o repetidos en el archivo.');
        return;
      }

      if (added.length === 0) {
        toast.error('No se importó ningún alumno. Revisa el archivo e inténtalo de nuevo.');
        return;
      }

      const groupNote =
        importPreview.groupName && importPreview.groupName !== groupName.trim().toUpperCase()
          ? ` Grupo en PDF: ${importPreview.groupName}.`
          : '';
      toast.success(
        skipped > 0
          ? `${added.length} estudiantes importados (${skipped} omitidos por duplicado).${groupNote}`
          : `${added.length} estudiantes importados.${groupNote}`
      );
      if (warning) {
        toast.warning('Importación parcial', { description: warning });
      }
      setImportPreview(null);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      toast.error('Error al importar alumnos', {
        description: toSpanishAuthMessage(msg),
      });
    } finally {
      setIsImporting(false);
    }
  };

  const filteredStudents = students.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.control_number ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleConfirmDeleteStudent = async () => {
    if (!studentPendingDelete) return;
    setIsDeletingStudent(true);
    const ok = await deleteStudent(studentPendingDelete.id);
    setIsDeletingStudent(false);
    setStudentPendingDelete(null);
    if (ok) {
      toast.success('Estudiante eliminado');
    } else {
      toast.error('No se pudo eliminar el estudiante', {
        description: toSpanishAuthMessage(error || ''),
      });
    }
  };

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
      <CardHeader className="min-w-0 px-3 sm:px-6">
        <CardTitle className="min-w-0 break-words text-base sm:text-lg">
          Estudiantes - {groupName}
        </CardTitle>
        <CardDescription>
          {students.length} estudiantes en este grupo
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 overflow-hidden px-3 sm:px-6">
        {/* Add Student */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Nombre del estudiante"
            value={newStudentName}
            onChange={(e) => setNewStudentName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
          />
          <Button 
            type="button"
            onClick={handleAddStudent} 
            disabled={isAdding}
            className="w-full bg-orange-600 hover:bg-orange-700 sm:w-auto"
          >
            {isAdding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Agregar
              </>
            )}
          </Button>
        </div>

        {/* Plantilla + importación */}
        <div className="flex flex-col gap-2 rounded-lg border border-orange-100 bg-orange-50/50 p-3">
          <p className="text-xs text-gray-700 sm:text-sm">
            <span className="font-medium text-orange-900">Lista de alumnos:</span> plantilla CSV/Excel o PDF
            de lista de asistencia ITSON (extrae grupo, número de control y nombre).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="border-orange-200 bg-white" asChild>
              <a href="/plantilla-alumnos-califacil.csv" download>
                <Download className="mr-2 h-4 w-4" />
                Descargar plantilla
              </a>
            </Button>
            <Label htmlFor="studentImportUpload" className="cursor-pointer">
              <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-white px-3 py-1.5 text-sm text-orange-700 hover:bg-orange-50">
                <Upload className="h-4 w-4" />
                Subir lista completada (CSV/Excel/PDF)
              </div>
            </Label>
            <input
              id="studentImportUpload"
              type="file"
              accept=".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          <p className="text-[11px] text-gray-500">
            Aceptamos la plantilla en Excel (.xlsx), CSV o un PDF con la lista de alumnos.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar estudiante..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Students List */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchTerm ? 'No se encontraron estudiantes' : 'No hay estudiantes en este grupo'}
          </div>
        ) : (
          <div className="min-w-0 divide-y overflow-hidden rounded-lg border">
            {filteredStudents.map((student) => (
              <div 
                key={student.id} 
                className="flex min-w-0 items-center gap-2 p-3 hover:bg-gray-50"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
                    <span className="text-sm font-medium text-gray-600">
                      {student.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words font-medium leading-snug">{student.name}</p>
                    {student.control_number ? (
                      <p className="truncate text-xs text-gray-500">Control: {student.control_number}</p>
                    ) : null}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 shrink-0 p-0 text-red-500 hover:bg-red-50 hover:text-red-700"
                  type="button"
                  aria-label={`Eliminar a ${student.name}`}
                  onClick={() => setStudentPendingDelete({ id: student.id, name: student.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

      <AlertDialog
        open={!!studentPendingDelete}
        onOpenChange={(open) => {
          if (!open && !isDeletingStudent) setStudentPendingDelete(null);
        }}
      >
        <AlertDialogContent className="gap-5 rounded-xl border border-gray-200 bg-white p-6 shadow-lg sm:max-w-md">
          <AlertDialogHeader className="gap-2 text-left">
            <AlertDialogTitle className="text-lg font-semibold text-gray-900">
              ¿Eliminar estudiante?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-gray-600">
              ¿Estás seguro de que deseas eliminar a{' '}
              <span className="font-medium text-gray-900">
                {studentPendingDelete?.name}
              </span>
              ? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel
              type="button"
              className="mt-0 rounded-lg border-gray-200 bg-white hover:bg-gray-50"
              disabled={isDeletingStudent}
            >
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              className="rounded-lg bg-red-600 text-white hover:bg-red-700"
              disabled={isDeletingStudent}
              onClick={handleConfirmDeleteStudent}
            >
              {isDeletingStudent ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Eliminar'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!importPreview} onOpenChange={(open) => !open && !isImporting && setImportPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Vista previa de importación</DialogTitle>
            <DialogDescription>
              {importPreview?.source === 'itson_pdf'
                ? 'Lista de asistencia ITSON detectada.'
                : 'Revisa los alumnos antes de importarlos al grupo.'}
            </DialogDescription>
          </DialogHeader>
          {importPreview ? (
            <div className="space-y-3 overflow-hidden">
              {importPreview.groupName ? (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm">
                  <span className="font-medium text-orange-900">Grupo en PDF:</span>{' '}
                  <span className="text-orange-800">{importPreview.groupName}</span>
                  {importPreview.groupName !== groupName.trim().toUpperCase() ? (
                    <span className="text-orange-700">
                      {' '}
                      (el grupo actual se llama «{groupName}»)
                    </span>
                  ) : null}
                </div>
              ) : null}
              <p className="text-sm text-gray-600">
                {importPreview.students.length} alumno(s) listos para importar
              </p>
              <div className="max-h-[50vh] overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="border-b text-left">
                      <th className="px-3 py-2 font-semibold">No.</th>
                      <th className="px-3 py-2 font-semibold">Control</th>
                      <th className="px-3 py-2 font-semibold">Nombre del alumno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.students.map((student) => (
                      <tr key={`${student.rowNumber}-${student.controlNumber}-${student.name}`} className="border-b">
                        <td className="px-3 py-2 text-gray-500">{student.rowNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">
                          {student.controlNumber || '—'}
                        </td>
                        <td className="px-3 py-2 font-medium">{student.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportPreview(null)}
              disabled={isImporting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={isImporting || !importPreview?.students.length}
              onClick={() => void handleConfirmImport()}
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                'Importar alumnos'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
