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
    names: string[]
  ): Promise<{ added: Student[]; skipped: number }> => {
    if (!groupId) return { added: [], skipped: 0 };

    const existingKeys = new Set(students.map((s) => normalizeAnswerText(s.name)));
    const batchKeys = new Set<string>();
    const inserts: { group_id: string; name: string }[] = [];
    let skipped = 0;

    for (const raw of names) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = normalizeAnswerText(trimmed);
      if (existingKeys.has(key) || batchKeys.has(key)) {
        skipped++;
        continue;
      }
      batchKeys.add(key);
      inserts.push({ group_id: groupId, name: trimmed });
    }

    if (inserts.length === 0) {
      return { added: [], skipped };
    }

    try {
      setError(null);
      const { data, error } = await supabase.from('students').insert(inserts).select();

      if (error) throw error;
      const added = data || [];
      setStudents((prev) => [...prev, ...added].sort((a, b) => a.name.localeCompare(b.name)));
      return { added, skipped };
    } catch (err: any) {
      setError(err.message);
      return { added: [], skipped };
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
