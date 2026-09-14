import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { deleteStudentExamResult } from '@/lib/examRetake';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { examId: string; studentId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId, studentId } = params;
    const { supabase, user } = auth;

    const { data: existing, error: fetchErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (fetchErr || !existing || existing.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const result = await deleteStudentExamResult(supabase, examId, studentId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, hint: result.hint },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}
