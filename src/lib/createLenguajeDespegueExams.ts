import type { SupabaseClient } from '@supabase/supabase-js';

const SCHOOLS = ['06', '60', '72'] as const;

/** Clave de los primeros 30 reactivos de la hoja de lenguaje. */
const LENGUAJE_KEY = [
  'A', 'C', 'C', 'A', 'B', 'A', 'B', 'A', 'A', 'C',
  'C', 'C', 'A', 'C', 'C', 'B', 'A', 'B', 'C', 'A',
  'A', 'C', 'A', 'A', 'C', 'B', 'C', 'B', 'B', 'A',
] as const;

export function lenguajeDespegueTitle(school: string): string {
  return `Lenguaje Despegue 2026 E.S.T. ${school}`;
}

export async function createLenguajeDespegueExams(
  supabase: SupabaseClient,
  teacherId: string
): Promise<{ created: string[]; skipped: string[]; error: string | null }> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const school of SCHOOLS) {
    const title = lenguajeDespegueTitle(school);
    const { data: existing, error: existingError } = await supabase
      .from('exams')
      .select('id')
      .eq('teacher_id', teacherId)
      .eq('title', title)
      .limit(1);
    if (existingError) return { created, skipped, error: existingError.message };
    if (existing && existing.length > 0) {
      skipped.push(title);
      continue;
    }

    const mathTitle = `Matemáticas Despegue 2026 E.S.T. ${school}`;
    const { data: math, error: mathError } = await supabase
      .from('exams')
      .select('id, folder_id, group_id, description')
      .eq('teacher_id', teacherId)
      .eq('title', mathTitle)
      .maybeSingle();
    if (mathError) return { created, skipped, error: mathError.message };
    if (!math) {
      return {
        created,
        skipped,
        error: `No está el examen «${mathTitle}» para copiar sus grupos.`,
      };
    }

    const { data: exam, error: insertError } = await supabase
      .from('exams')
      .insert({
        teacher_id: teacherId,
        group_id: math.group_id,
        folder_id: math.folder_id,
        title,
        description: math.description,
        status: 'published',
        qr_code: null,
      })
      .select('id')
      .single();
    if (insertError || !exam) {
      return { created, skipped, error: insertError?.message || 'No se pudo crear el examen' };
    }

    const questions = LENGUAJE_KEY.map((letter, index) => ({
      exam_id: exam.id,
      text: `Reactivo ${index + 1}`,
      type: 'multiple_choice',
      options: ['A', 'B', 'C', 'D'],
      correct_answer: letter,
      points: 1,
      sort_order: index,
    }));
    const { error: questionsError } = await supabase.from('questions').insert(questions);
    if (questionsError) {
      await supabase.from('exams').delete().eq('id', exam.id);
      return { created, skipped, error: questionsError.message };
    }

    const { data: assignments, error: assignmentReadError } = await supabase
      .from('exam_group_assignments')
      .select('group_id')
      .eq('exam_id', math.id);
    if (assignmentReadError) {
      return { created, skipped, error: assignmentReadError.message };
    }
    const rows = (assignments ?? []).map((row) => ({
      exam_id: exam.id,
      group_id: row.group_id as string,
    }));
    if (rows.length > 0) {
      const { error: assignmentError } = await supabase.from('exam_group_assignments').insert(rows);
      if (assignmentError) return { created, skipped, error: assignmentError.message };
    }

    created.push(title);
  }

  return { created, skipped, error: null };
}
