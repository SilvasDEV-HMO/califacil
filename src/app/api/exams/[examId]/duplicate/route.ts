import { NextRequest, NextResponse } from 'next/server';
import { sortExamQuestions } from '@/lib/examQuestions';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { isMissingSortOrderColumnError } from '@/lib/examQuestions';

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const { supabase, user } = auth;

    const { data: source, error: fetchErr } = await supabase
      .from('exams')
      .select('*')
      .eq('id', examId)
      .single();

    if (fetchErr || !source || source.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const { data: newExam, error: insertErr } = await supabase
      .from('exams')
      .insert({
        teacher_id: user.id,
        group_id: source.group_id,
        folder_id: source.folder_id ?? null,
        title: `${source.title} (copia)`,
        description: source.description,
        status: 'draft',
        qr_code: null,
      })
      .select()
      .single();

    if (insertErr || !newExam) {
      return NextResponse.json(
        { error: 'No se pudo duplicar el examen', message: insertErr?.message },
        { status: 500 }
      );
    }

    const { data: sourceQuestions, error: qErr } = await supabase
      .from('questions')
      .select('text,type,options,correct_answer,illustration,points,sort_order,created_at')
      .eq('exam_id', examId)
      .order('created_at', { ascending: true });

    if (qErr) {
      await supabase.from('exams').delete().eq('id', newExam.id);
      return NextResponse.json({ error: 'No se pudieron copiar las preguntas' }, { status: 500 });
    }

    const orderedQuestions = sortExamQuestions(sourceQuestions ?? []);
    if (orderedQuestions.length > 0) {
      const rowsWithOrder = orderedQuestions.map((q, index) => ({
        exam_id: newExam.id,
        text: q.text,
        type: q.type,
        options: q.options,
        correct_answer: q.correct_answer,
        illustration: q.illustration,
        points: q.points ?? 1,
        sort_order: index,
      }));
      const rowsWithoutOrder = orderedQuestions.map((q) => ({
        exam_id: newExam.id,
        text: q.text,
        type: q.type,
        options: q.options,
        correct_answer: q.correct_answer,
        illustration: q.illustration,
        points: q.points ?? 1,
      }));
      let qInsertErr = (
        await supabase.from('questions').insert(rowsWithOrder)
      ).error;
      if (qInsertErr && isMissingSortOrderColumnError(qInsertErr.message)) {
        qInsertErr = (await supabase.from('questions').insert(rowsWithoutOrder)).error;
      }
      if (qInsertErr) {
        await supabase.from('exams').delete().eq('id', newExam.id);
        return NextResponse.json({ error: 'No se pudieron copiar las preguntas' }, { status: 500 });
      }
    }

    const { data: assignments } = await supabase
      .from('exam_group_assignments')
      .select('group_id')
      .eq('exam_id', examId);

    const groupIds = (assignments || []).map((a) => a.group_id as string);
    if (groupIds.length === 0 && source.group_id) {
      groupIds.push(source.group_id);
    }

    if (groupIds.length > 0) {
      await supabase
        .from('exam_group_assignments')
        .insert(groupIds.map((groupId) => ({ exam_id: newExam.id, group_id: groupId })));
    }

    return NextResponse.json({ examId: newExam.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}
