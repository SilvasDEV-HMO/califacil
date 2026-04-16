'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useGroups, useStudents } from '@/hooks/useGroups';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { parseStudentNamesFromImportFile } from '@/lib/studentImport';
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
    <div className="space-y-3 sm:space-y-6">
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
        <Card className="p-12 text-center">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">No hay grupos aún</h3>
          <p className="text-gray-500 mb-6">Crea tu primer grupo para comenzar a organizar tus estudiantes</p>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="bg-orange-600 hover:bg-orange-700">
            <Plus className="w-4 h-4 mr-2" />
            Crear Grupo
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          {/* Groups List */}
          <div className={`space-y-3 sm:space-y-4 ${selectedGroup ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
            <h2 className="text-lg font-semibold text-gray-900">Mis Grupos</h2>
            <div className="space-y-3">
              {groups.map((group) => (
                <Card 
                  key={group.id} 
                  className={`cursor-pointer transition-all ${
                    selectedGroup === group.id 
                      ? 'ring-2 ring-orange-500 shadow-md' 
                      : 'hover:shadow-md'
                  }`}
                  onClick={() => setSelectedGroup(group.id)}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                          <GraduationCap className="w-5 h-5 text-orange-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{group.name}</h3>
                          <p className="text-sm text-gray-500">
                            Creado el {new Date(group.created_at).toLocaleDateString('es-ES')}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
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
            <div className="lg:col-span-2">
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

  const handleAddStudent = async () => {
    if (!newStudentName.trim()) {
      toast.error('Escribe el nombre del estudiante');
      return;
    }
    
    setIsAdding(true);
    const student = await addStudent(newStudentName.trim());
    if (student) {
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
      const names = await parseStudentNamesFromImportFile(file);
      if (names.length === 0) {
        toast.error(
          'No se encontraron nombres. Descarga la plantilla, completa APELLIDO (S) y NOMBRE (S), y súbela de nuevo.'
        );
        return;
      }
      const { added, skipped } = await addStudentsBatch(names);
      if (added.length === 0 && skipped > 0) {
        toast.error('No se importó ningún alumno: todos los nombres ya estaban en el grupo o repetidos en el archivo.');
      } else if (added.length > 0) {
        toast.success(
          skipped > 0
            ? `${added.length} estudiantes importados (${skipped} omitidos por duplicado)`
            : `${added.length} estudiantes importados`
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      toast.error('Error al procesar el archivo', {
        description: toSpanishAuthMessage(msg) || 'Revisa que sea la plantilla de CaliFácil y vuelve a intentarlo.',
      });
    }
  };

  const filteredStudents = students.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estudiantes - {groupName}</CardTitle>
        <CardDescription>
          {students.length} estudiantes en este grupo
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            <span className="font-medium text-orange-900">Lista de alumnos:</span> descarga la plantilla,
            escribe cada alumno en columnas <span className="font-mono text-xs">APELLIDO (S)</span> y{' '}
            <span className="font-mono text-xs">NOMBRE (S)</span>, y súbela aquí.
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
                Subir lista completada
              </div>
            </Label>
            <input
              id="studentImportUpload"
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          <p className="text-[11px] text-gray-500">
            Aceptamos la plantilla en Excel (.xlsx) o CSV tras descargarla y rellenarla.
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
          <div className="divide-y rounded-lg border">
            {filteredStudents.map((student) => (
              <div 
                key={student.id} 
                className="flex items-center justify-between gap-2 p-3 hover:bg-gray-50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
                    <span className="text-sm font-medium text-gray-600">
                      {student.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="truncate font-medium">{student.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-red-500 hover:bg-red-50 hover:text-red-700"
                  onClick={() => deleteStudent(student.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
