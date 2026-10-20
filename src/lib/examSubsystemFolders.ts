import { supabase } from '@/lib/supabase';
import type { Exam, ExamFolder } from '@/types';

export const SUBSYSTEM_FOLDER_SPECS = [
  { codes: ['DST'] as const, name: 'Técnicas' },
  { codes: ['EST', 'EES'] as const, name: 'Estatales' },
  { codes: ['DES'] as const, name: 'Generales' },
  { codes: ['ETV'] as const, name: 'Teles' },
];

export const SUBJECT_SUBFOLDER_SPECS = [
  { kind: 'lenguaje' as const, name: 'Lenguaje' },
  { kind: 'matematicas' as const, name: 'Matemáticas' },
];

export type SubsystemFolderCode = (typeof SUBSYSTEM_FOLDER_SPECS)[number]['codes'][number];

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function subsystemCodeFromExamTitle(title: string): SubsystemFolderCode | null {
  const m = title.toUpperCase().match(/\d{2}(DST|EST|EES|ETV|DES)/);
  const code = m?.[1];
  if (code === 'DST' || code === 'EST' || code === 'EES' || code === 'ETV' || code === 'DES') {
    return code;
  }
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

function findChildFolderByName(
  folders: ExamFolder[],
  parentId: string,
  name: string
): ExamFolder | undefined {
  const want = normalizeName(name);
  return folders.find((f) => f.parent_id === parentId && normalizeName(f.name) === want);
}

export function descendantFolderIds(folders: ExamFolder[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const folder of folders) {
      if (folder.parent_id && ids.has(folder.parent_id) && !ids.has(folder.id)) {
        ids.add(folder.id);
        added = true;
      }
    }
  }
  return ids;
}

export function examsInFolderTree(
  exams: Exam[],
  folders: ExamFolder[],
  folderId: string
): Exam[] {
  const ids = descendantFolderIds(folders, folderId);
  return exams.filter((exam) => exam.folder_id && ids.has(exam.folder_id));
}

async function ensureFolder(
  teacherId: string,
  parentId: string | null,
  name: string,
  nextFolders: ExamFolder[]
): Promise<{ folder: ExamFolder | null; created: boolean }> {
  const existing = parentId
    ? findChildFolderByName(nextFolders, parentId, name)
    : findRootFolderByName(nextFolders, name);
  if (existing) return { folder: existing, created: false };
  const { data, error } = await supabase
    .from('exam_folders')
    .insert([{ teacher_id: teacherId, parent_id: parentId, name }])
    .select()
    .single();
  if (error || !data) return { folder: null, created: false };
  return { folder: data as ExamFolder, created: true };
}

export async function ensureSubsystemFoldersAndAssignExams(
  teacherId: string,
  folders: ExamFolder[],
  exams: Exam[]
): Promise<{ foldersChanged: boolean; examsMoved: number; folders: ExamFolder[] }> {
  let nextFolders = [...folders];
  let foldersChanged = false;

  const parentIdByCode: Partial<Record<SubsystemFolderCode, string>> = {};
  const subjectFolderIdByParent: Record<string, { lenguaje?: string; matematicas?: string }> = {};

  for (const spec of SUBSYSTEM_FOLDER_SPECS) {
    const parent = await ensureFolder(teacherId, null, spec.name, nextFolders);
    if (parent.created && parent.folder) {
      nextFolders.push(parent.folder);
      foldersChanged = true;
    }
    const parentId = parent.folder?.id;
    if (!parentId) continue;
    for (const code of spec.codes) parentIdByCode[code] = parentId;

    for (const subject of SUBJECT_SUBFOLDER_SPECS) {
      const child = await ensureFolder(teacherId, parentId, subject.name, nextFolders);
      if (child.created && child.folder) {
        nextFolders.push(child.folder);
        foldersChanged = true;
      }
      if (!child.folder) continue;
      if (!subjectFolderIdByParent[parentId]) subjectFolderIdByParent[parentId] = {};
      subjectFolderIdByParent[parentId][subject.kind] = child.folder.id;
    }
  }

  const moves: Array<{ id: string; folder_id: string }> = [];
  for (const exam of exams) {
    const code = subsystemCodeFromExamTitle(exam.title);
    if (!code) continue;
    const parentId = parentIdByCode[code];
    if (!parentId) continue;
    const kind = examSubjectKind(exam.title);
    const folderId =
      (kind ? subjectFolderIdByParent[parentId]?.[kind] : undefined) ?? parentId;
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

export function folderExamCountsFromList(exams: Exam[]): Pick<
  FolderExamGradeStats,
  'lenguajeExams' | 'matematicasExams'
> {
  let lenguajeExams = 0;
  let matematicasExams = 0;
  for (const exam of exams) {
    const kind = examSubjectKind(exam.title);
    if (kind === 'lenguaje') lenguajeExams += 1;
    else if (kind === 'matematicas') matematicasExams += 1;
  }
  return { lenguajeExams, matematicasExams };
}

async function examStudentHeadcountsRpc(
  examIds: string[]
): Promise<Array<{ exam_id: string; students: number }> | null> {
  const out: Array<{ exam_id: string; students: number }> = [];
  const idChunk = 200;
  for (let i = 0; i < examIds.length; i += idChunk) {
    const slice = examIds.slice(i, i + idChunk);
    const { data, error } = await supabase.rpc('exam_student_headcounts', {
      p_exam_ids: slice,
    });
    if (error) return null;
    const payload = data as { ok?: boolean; rows?: Array<{ exam_id: string; students: number }> } | null;
    if (!payload?.ok || !Array.isArray(payload.rows)) return null;
    out.push(...payload.rows);
  }
  return out;
}

export async function listExamIdsWithAnswers(examIds: string[]): Promise<Set<string>> {
  const rpcRows = await examStudentHeadcountsRpc(examIds);
  if (rpcRows) {
    return new Set(rpcRows.filter((row) => Number(row.students) > 0).map((row) => row.exam_id));
  }
  const examSet = new Set<string>();
  const idChunk = 80;
  for (let i = 0; i < examIds.length; i += idChunk) {
    const slice = examIds.slice(i, i + idChunk);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('answers')
        .select('exam_id')
        .in('exam_id', slice)
        .range(from, from + 999);
      if (error) break;
      const batch = data ?? [];
      for (const row of batch) {
        if (row.exam_id) examSet.add(String(row.exam_id));
      }
      if (batch.length < 1000) break;
    }
  }
  return examSet;
}

export async function fetchFolderExamGradeStats(exams: Exam[]): Promise<FolderExamGradeStats> {
  const counts = folderExamCountsFromList(exams);
  const stats: FolderExamGradeStats = {
    ...emptyFolderExamGradeStats(),
    ...counts,
  };
  const lenguajeIds: string[] = [];
  const mateIds: string[] = [];
  for (const exam of exams) {
    const kind = examSubjectKind(exam.title);
    if (kind === 'lenguaje') lenguajeIds.push(exam.id);
    else if (kind === 'matematicas') mateIds.push(exam.id);
  }

  const allIds = lenguajeIds.concat(mateIds);
  const rpcRows = await examStudentHeadcountsRpc(allIds);
  if (rpcRows) {
    const lenguajeSet = new Set(lenguajeIds);
    const mateSet = new Set(mateIds);
    for (const row of rpcRows) {
      const students = Number(row.students) || 0;
      if (students <= 0) continue;
      if (lenguajeSet.has(row.exam_id)) {
        stats.lenguajeGradedExams += 1;
        stats.lenguajeGradedStudents += students;
      } else if (mateSet.has(row.exam_id)) {
        stats.matematicasGradedExams += 1;
        stats.matematicasGradedStudents += students;
      }
    }
    return stats;
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
