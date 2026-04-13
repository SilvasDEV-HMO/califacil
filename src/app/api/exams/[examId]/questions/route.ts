import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const { questions } = await request.json();

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json({ error: 'Questions array is required' }, { status: 400 });
    }

    const { supabase, user } = auth;

    const { data: existing, error: fetchErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (fetchErr || !existing || existing.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const questionsWithExamId = questions.map((q: Record<string, unknown>) => ({
      ...q,
      exam_id: examId,
    }));

    const { data, error } = await supabase.from('questions').insert(questionsWithExamId).select();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to add questions', message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ questions: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}
