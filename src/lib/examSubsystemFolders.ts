import { supabase } from '@/lib/supabase';
import type { Exam, ExamFolder } from '@/types';

export const SUBSYSTEM_FOLDER_SPECS = [
  { code: 'DST', name: 'Técnicas' },
  { code: 'EST', name: 'Estatales' },
  { code: 'EES', name: 'Generales' },
  { code: 'ETV', name: 'Teles' },
] as const;

export type SubsystemFolderCode = (typeof SUBSYSTEM_FOLDER_SPECS)[number]['code'];

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function subsystemCodeFromExamTitle(title: string): SubsystemFolderCode | null {
  const m = title.toUpperCase().match(/\d{2}(DST|EST|EES|ETV)/);
  const code = m?.[1];
  if (code === 'DST' || code === 'EST' || code === 'EES' || code === 'ETV') return code;
  return null;
}

export function examSubjectKind(title: string): 'lenguaje' | 'matematicas' | null {
  const t = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (t.startsWith('lenguaje')) return 'lenguaje';
  if (t.startsWith('matematicas') || t.startsWith('mate ')) return 'matematicas';
  return null;
}

function findRootFolderByName(folders: ExamFolder[], name: string): ExamFolder | undefined {
  const want = normalizeName(name);
  return folders.find((f) => !f.parent_id && normalizeName(f.name) === want);
}

export async function ensureSubsystemFoldersAndAssignExams(
  teacherId: string,
  folders: ExamFolder[],
  exams: Exam[]
): Promise<{ foldersChanged: boolean; examsMoved: number; folders: ExamFolder[] }> {
  let nextFolders = [...folders];
  let foldersChanged = false;

  for (const spec of SUBSYSTEM_FOLDER_SPECS) {
    if (findRootFolderByName(nextFolders, spec.name)) continue;
    const { data, error } = await supabase
      .from('exam_folders')
      .insert([{ teacher_id: teacherId, parent_id: null, name: spec.name }])
      .select()
      .single();
    if (error || !data) continue;
    nextFolders.push(data as ExamFolder);
    foldersChanged = true;
  }

  const folderIdByCode: Record<SubsystemFolderCode, string | null> = {
    DST: findRootFolderByName(nextFolders, 'Técnicas')?.id ?? null,
    EST: findRootFolderByName(nextFolders, 'Estatales')?.id ?? null,
    EES: findRootFolderByName(nextFolders, 'Generales')?.id ?? null,
    ETV: findRootFolderByName(nextFolders, 'Teles')?.id ?? null,
  };

  const moves: Array<{ id: string; folder_id: string }> = [];
  for (const exam of exams) {
    const code = subsystemCodeFromExamTitle(exam.title);
    if (!code) continue;
    const folderId = folderIdByCode[code];
    if (!folderId || exam.folder_id === folderId) continue;
    moves.push({ id: exam.id, folder_id: folderId });
  }

  const chunk = 80;
  for (let i = 0; i < moves.length; i += chunk) {
    const slice = moves.slice(i, i + chunk);
    await Promise.all(
      slice.map((row) =>
        supabase.from('exams').update({ folder_id: row.folder_id }).eq('id', row.id)
      )
    );
  }

  return { foldersChanged, examsMoved: moves.length, folders: nextFolders };
}

export type FolderExamGradeStats = {
  lenguajeExams: number;
  matematicasExams: number;
  lenguajeGradedExams: number;
  matematicasGradedExams: number;
  lenguajeGradedStudents: number;
  matematicasGradedStudents: number;
};

export function emptyFolderExamGradeStats(): FolderExamGradeStats {
  return {
    lenguajeExams: 0,
    matematicasExams: 0,
    lenguajeGradedExams: 0,
    matematicasGradedExams: 0,
    lenguajeGradedStudents: 0,
    matematicasGradedStudents: 0,
  };
}

export async function fetchFolderExamGradeStats(exams: Exam[]): Promise<FolderExamGradeStats> {
  const stats = emptyFolderExamGradeStats();
  const lenguajeIds: string[] = [];
  const mateIds: string[] = [];
  for (const exam of exams) {
    const kind = examSubjectKind(exam.title);
    if (kind === 'lenguaje') {
      stats.lenguajeExams += 1;
      lenguajeIds.push(exam.id);
    } else if (kind === 'matematicas') {
      stats.matematicasExams += 1;
      mateIds.push(exam.id);
    }
  }

  const countGraded = async (examIds: string[]) => {
    const examSet = new Set<string>();
    const studentSet = new Set<string>();
    const idChunk = 80;
    for (let i = 0; i < examIds.length; i += idChunk) {
      const slice = examIds.slice(i, i + idChunk);
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('answers')
          .select('exam_id,student_id')
          .in('exam_id', slice)
          .range(from, from + 999);
        if (error) break;
        const batch = data ?? [];
        for (const row of batch) {
          if (row.exam_id) examSet.add(String(row.exam_id));
          if (row.student_id) studentSet.add(String(row.student_id));
        }
        if (batch.length < 1000) break;
      }
    }
    return { exams: examSet.size, students: studentSet.size };
  };

  const [lenguaje, mate] = await Promise.all([countGraded(lenguajeIds), countGraded(mateIds)]);
  stats.lenguajeGradedExams = lenguaje.exams;
  stats.lenguajeGradedStudents = lenguaje.students;
  stats.matematicasGradedExams = mate.exams;
  stats.matematicasGradedStudents = mate.students;
  return stats;
}
