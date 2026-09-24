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
      .select('*')
      .eq('exam_id', examId);

    if (qErr) {
      await supabase.from('exams').delete().eq('id', newExam.id);
      return NextResponse.json(
        { error: 'No se pudieron copiar las preguntas', message: qErr.message },
        { status: 500 }
      );
    }

    const orderedQuestions = sortExamQuestions(sourceQuestions ?? []);
    if (orderedQuestions.length > 0) {
      const buildRows = (flags: { sort: boolean; points: boolean; illustration: boolean }) =>
        orderedQuestions.map((q, index) => {
          const row = q as Record<string, unknown>;
          const type = row.type === 'open_answer' ? 'open_answer' : 'multiple_choice';
          const base: Record<string, unknown> = {
            exam_id: newExam.id,
            text: String(row.text ?? '').trim() || '(sin texto)',
            type,
            options: type === 'multiple_choice' ? row.options ?? null : null,
            correct_answer:
              row.correct_answer != null && String(row.correct_answer).trim() !== ''
                ? String(row.correct_answer)
                : null,
          };
          if (flags.illustration) {
            base.illustration =
              row.illustration != null && String(row.illustration).trim() !== ''
                ? String(row.illustration)
                : null;
          }
          if (flags.points) {
            const points = Number(row.points);
            base.points = Number.isFinite(points) && points > 0 ? points : 1;
          }
          if (flags.sort) base.sort_order = index;
          return base;
        });

      const flags = { sort: true, points: true, illustration: true };
      let qInsertErr = (await supabase.from('questions').insert(buildRows(flags))).error;
      for (let attempt = 0; qInsertErr && attempt < 4; attempt += 1) {
        const message = qInsertErr.message ?? '';
        if (flags.sort && (isMissingSortOrderColumnError(message) || /sort_order/i.test(message))) flags.sort = false;
        else if (flags.points && /points/i.test(message)) flags.points = false;
        else if (flags.illustration) flags.illustration = false;
        else break;
        qInsertErr = (await supabase.from('questions').insert(buildRows(flags))).error;
      }
      if (qInsertErr) {
        await supabase.from('exams').delete().eq('id', newExam.id);
        return NextResponse.json(
          { error: 'No se pudieron copiar las preguntas', message: qInsertErr.message },
          { status: 500 }
        );
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
