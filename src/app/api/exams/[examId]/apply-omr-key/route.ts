import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { sortExamQuestions } from '@/lib/examQuestions';

const KEY_PATTERN = /^[ABCD]{1,60}$/;

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const body = (await request.json().catch(() => ({}))) as { key?: string };
    const key = String(body.key ?? '').trim().toUpperCase();

    if (!KEY_PATTERN.test(key)) {
      return NextResponse.json(
        { error: 'La clave debe ser una cadena de letras A, B, C o D.' },
        { status: 400 }
      );
    }

    const { supabase, user } = auth;

    const { data: exam, error: examErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (examErr || !exam || exam.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('id, text, type, options, correct_answer, sort_order, created_at')
      .eq('exam_id', examId)
      .order('created_at', { ascending: true });

    if (qErr) {
      return NextResponse.json(
        { error: 'No se pudieron cargar las preguntas', message: qErr.message },
        { status: 500 }
      );
    }

    const mc = sortExamQuestions(questions ?? []).filter((q) => q.type === 'multiple_choice');
    if (mc.length === 0) {
      return NextResponse.json({ error: 'No hay preguntas de opción múltiple' }, { status: 400 });
    }

    if (key.length < mc.length) {
      return NextResponse.json(
        {
          error: `La clave tiene ${key.length} letras pero el examen tiene ${mc.length} preguntas OMR.`,
        },
        { status: 400 }
      );
    }

    let updated = 0;
    const applied: { question: number; letter: string; answer: string }[] = [];

    for (let i = 0; i < mc.length; i++) {
      const q = mc[i]!;
      const letter = key[i]!;
      const col = 'ABCD'.indexOf(letter);
      const opts = Array.isArray(q.options)
        ? q.options.map((o) => String(o).trim()).filter(Boolean)
        : [];
      if (col < 0 || col >= opts.length) {
        return NextResponse.json(
          {
            error: `La pregunta ${i + 1} no tiene opción para la columna ${letter}.`,
          },
          { status: 400 }
        );
      }
      const correct = opts[col]!;
      if (q.correct_answer === correct) continue;
      const { error } = await supabase
        .from('questions')
        .update({ correct_answer: correct })
        .eq('id', q.id);
      if (error) {
        return NextResponse.json(
          { error: `No se pudo actualizar la pregunta ${i + 1}`, message: error.message },
          { status: 500 }
        );
      }
      updated++;
      applied.push({ question: i + 1, letter, answer: correct });
    }

    return NextResponse.json({
      ok: true,
      key: key.slice(0, mc.length),
      updated,
      applied,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}
