'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Exam, Question, Answer, ExamWithQuestions } from '@/types';
import { isMissingSortOrderColumnError, sortExamQuestions } from '@/lib/examQuestions';

export function useExams(teacherId: string | undefined) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExams = useCallback(async () => {
    if (!teacherId) return;
    
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('exams')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExams(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    fetchExams();
  }, [fetchExams]);

  const createExam = async (examData: Partial<Exam>): Promise<Exam | null> => {
    if (!teacherId) return null;
    
    try {
      const { data, error } = await supabase
        .from('exams')
        .insert([{ ...examData, teacher_id: teacherId }])
        .select()
        .single();

      if (error) throw error;
      setExams(prev => [data, ...prev]);
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  };

  const updateExam = async (examId: string, updates: Partial<Exam>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('exams')
        .update(updates)
        .eq('id', examId);

      if (error) throw error;
      setExams(prev => prev.map(e => e.id === examId ? { ...e, ...updates } : e));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  const deleteExam = async (examId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('exams')
        .delete()
        .eq('id', examId);

      if (error) throw error;
      setExams(prev => prev.filter(e => e.id !== examId));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  return {
    exams,
    loading,
    error,
    createExam,
    updateExam,
    deleteExam,
    refreshExams: fetchExams,
  };
}

export function useExam(examId: string | undefined) {
  const [exam, setExam] = useState<ExamWithQuestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExam = useCallback(async () => {
    if (!examId) {
      setExam(null);
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('*')
        .eq('id', examId)
        .single();

      if (examError) throw examError;

      const { data: questionsData, error: questionsError } = await supabase
        .from('questions')
        .select('*')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true });

      if (questionsError) throw questionsError;

      setExam({ ...examData, questions: sortExamQuestions(questionsData || []) });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    fetchExam();
  }, [fetchExam]);

  const addQuestions = async (questions: Partial<Question>[]): Promise<Question[] | null> => {
    if (!examId) return null;

    try {
      let baseOrder = 0;
      const { count } = await supabase
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('exam_id', examId);
      baseOrder = count ?? 0;

      const withOrder = questions.map((q, i) => ({
        ...q,
        exam_id: examId,
        sort_order: baseOrder + i,
      }));
      const withoutOrder = questions.map((q) => ({ ...q, exam_id: examId }));

      let data: Question[] | null = null;
      let error: { message: string } | null = null;
      ({ data, error } = await supabase.from('questions').insert(withOrder).select());
      if (error && isMissingSortOrderColumnError(error.message)) {
        ({ data, error } = await supabase.from('questions').insert(withoutOrder).select());
      }
      if (error) throw error;

      const merged = sortExamQuestions([...(data || [])]);
      setExam((prev) =>
        prev
          ? {
              ...prev,
              questions: sortExamQuestions([...prev.questions, ...merged]),
            }
          : null
      );
      return data || [];
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  };

  const updateQuestion = async (questionId: string, updates: Partial<Question>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('questions')
        .update(updates)
        .eq('id', questionId);

      if (error) throw error;
      setExam(prev => prev ? {
        ...prev,
        questions: prev.questions.map(q => q.id === questionId ? { ...q, ...updates } : q)
      } : null);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  const deleteQuestion = async (questionId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('questions')
        .delete()
        .eq('id', questionId);

      if (error) throw error;
      setExam(prev => prev ? {
        ...prev,
        questions: prev.questions.filter(q => q.id !== questionId)
      } : null);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  return {
    exam,
    loading,
    error,
    addQuestions,
    updateQuestion,
    deleteQuestion,
    refreshExam: fetchExam,
  };
}

export function useExamResults(examId: string | undefined) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnswers = useCallback(async () => {
    if (!examId) return;
    
    try {
      setLoading(true);
      const pageSize = 1000;
      const all: Answer[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('answers')
          .select('*')
          .eq('exam_id', examId)
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < pageSize) break;
      }
      setAnswers(all);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    fetchAnswers();
  }, [fetchAnswers]);

  const updateAnswer = async (answerId: string, updates: Partial<Answer>): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('answers')
        .update(updates)
        .eq('id', answerId);

      if (error) throw error;
      setAnswers(prev => prev.map(a => a.id === answerId ? { ...a, ...updates } : a));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  };

  return {
    answers,
    loading,
    error,
    updateAnswer,
    refreshAnswers: fetchAnswers,
  };
}
