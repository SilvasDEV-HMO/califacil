'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { normalizeAnswerText } from '@/lib/utils';
import { Group, Student } from '@/types';

export function useGroups(teacherId: string | undefined) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!teacherId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGroups(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const createGroup = async (name: string): Promise<Group | null> => {
    if (!teacherId) return null;
    
    try {
      const { data, error } = await supabase
        .from('groups')
        .insert([{ teacher_id: teacherId, name }])
        .select()
        .single();

      if (error) throw error;
      setGroups(prev => [data, ...prev]);
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  };

  const deleteGroup = async (groupId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId);

      if (error) throw error;
      setGroups(prev => prev.filter(g => g.id !== groupId));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  return {
    groups,
    loading,
    error,
    createGroup,
    deleteGroup,
    refreshGroups: fetchGroups,
  };
}

export function useStudents(groupId: string | undefined) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = useCallback(async () => {
    if (!groupId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('group_id', groupId)
        .order('name', { ascending: true });

      if (error) throw error;
      setStudents(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const addStudent = async (name: string): Promise<Student | 'duplicate' | null> => {
    if (!groupId) return null;

    const trimmed = name.trim();
    if (!trimmed) return null;

    const key = normalizeAnswerText(trimmed);
    if (students.some((s) => normalizeAnswerText(s.name) === key)) {
      setError(null);
      return 'duplicate';
    }

    try {
      setError(null);
      const { data, error } = await supabase
        .from('students')
        .insert([{ group_id: groupId, name: trimmed }])
        .select()
        .single();

      if (error) throw error;
      setStudents((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  };

  const addStudentsBatch = async (
    entries: Array<{ name: string; controlNumber?: string | null }>
  ): Promise<{ added: Student[]; skipped: number; error: string | null; warning?: string }> => {
    if (!groupId) {
      return { added: [], skipped: 0, error: 'No hay un grupo seleccionado.' };
    }

    const existingByName = new Map(students.map((s) => [normalizeAnswerText(s.name), s]));
    const batchKeys = new Set<string>();
    const inserts: { group_id: string; name: string; control_number?: string | null }[] = [];
    const curpUpdates: { id: string; control_number: string }[] = [];
    let skipped = 0;

    for (const entry of entries) {
      const trimmed = entry.name.trim();
      if (!trimmed) continue;
      const key = normalizeAnswerText(trimmed);
      const control = entry.controlNumber?.trim() || null;
      const existing = existingByName.get(key);
      if (existing) {
        if (control && control !== (existing.control_number ?? '').trim()) {
          curpUpdates.push({ id: existing.id, control_number: control });
        } else {
          skipped++;
        }
        continue;
      }
      if (batchKeys.has(key)) {
        skipped++;
        continue;
      }
      batchKeys.add(key);
      inserts.push({
        group_id: groupId,
        name: trimmed,
        ...(control ? { control_number: control } : {}),
      });
    }

    if (inserts.length === 0 && curpUpdates.length === 0) {
      return { added: [], skipped, error: null };
    }

    for (const update of curpUpdates) {
      const { error: updateError } = await supabase
        .from('students')
        .update({ control_number: update.control_number })
        .eq('id', update.id);
      if (updateError) {
        return { added: [], skipped, error: updateError.message };
      }
    }
    if (curpUpdates.length > 0) {
      const nextControl = new Map(curpUpdates.map((row) => [row.id, row.control_number]));
      setStudents((prev) =>
        prev.map((student) =>
          nextControl.has(student.id)
            ? { ...student, control_number: nextControl.get(student.id) }
            : student
        )
      );
    }

    if (inserts.length === 0) {
      return { added: [], skipped, error: null };
    }

    try {
      setError(null);
      let { data, error } = await supabase.from('students').insert(inserts).select();

      if (error?.message?.includes('control_number')) {
        const fallbackInserts = inserts.map(({ group_id, name }) => ({ group_id, name }));
        const retry = await supabase.from('students').insert(fallbackInserts).select();
        data = retry.data;
        error = retry.error;
        if (!error) {
          const added = data || [];
          setStudents((prev) => [...prev, ...added].sort((a, b) => a.name.localeCompare(b.name)));
          return {
            added,
            skipped,
            error: null,
            warning:
              'Los alumnos se importaron sin número de control. Aplica la migración 20260619130000_students_control_number.sql en Supabase.',
          };
        }
      }

      if (error) throw error;
      const added = data || [];
      setStudents((prev) => [...prev, ...added].sort((a, b) => a.name.localeCompare(b.name)));
      return { added, skipped, error: null };
    } catch (err: any) {
      const message = err?.message || 'No se pudieron importar los alumnos.';
      setError(message);
      return { added: [], skipped, error: message };
    }
  };

  const deleteStudent = async (studentId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('students')
        .delete()
        .eq('id', studentId);

      if (error) throw error;
      setStudents(prev => prev.filter(s => s.id !== studentId));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  return {
    students,
    loading,
    error,
    addStudent,
    addStudentsBatch,
    deleteStudent,
    refreshStudents: fetchStudents,
  };
}

/** Importa alumnos en un grupo que puede no ser el que está abierto. */
export async function insertStudentsInGroup(
  groupId: string,
  entries: Array<{ name: string; controlNumber?: string | null }>
): Promise<{ added: number; skipped: number; error: string | null }> {
  const { data: existingData, error: existingError } = await supabase
    .from('students')
    .select('id,name,control_number')
    .eq('group_id', groupId);
  if (existingError) return { added: 0, skipped: 0, error: existingError.message };

  const existingByName = new Map(
    (existingData || []).map((student) => [normalizeAnswerText(student.name), student])
  );
  const batchKeys = new Set<string>();
  const inserts: { group_id: string; name: string; control_number?: string | null }[] = [];
  let skipped = 0;

  for (const entry of entries) {
    const trimmed = entry.name.trim();
    if (!trimmed) continue;
    const key = normalizeAnswerText(trimmed);
    if (existingByName.has(key) || batchKeys.has(key)) {
      skipped++;
      continue;
    }
    batchKeys.add(key);
    const control = entry.controlNumber?.trim() || null;
    inserts.push({
      group_id: groupId,
      name: trimmed,
      ...(control ? { control_number: control } : {}),
    });
  }

  if (inserts.length === 0) return { added: 0, skipped, error: null };

  let { error } = await supabase.from('students').insert(inserts);
  if (error?.message?.includes('control_number')) {
    const retry = await supabase
      .from('students')
      .insert(inserts.map(({ group_id, name }) => ({ group_id, name })));
    error = retry.error;
  }
  if (error) return { added: 0, skipped, error: error.message };
  return { added: inserts.length, skipped, error: null };
}
