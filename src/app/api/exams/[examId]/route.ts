import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

const PATCHABLE_EXAM_KEYS = [
  'status',
  'qr_code',
  'title',
  'description',
  'group_id',
] as const;

type PatchableKey = (typeof PATCHABLE_EXAM_KEYS)[number];

function pickExamUpdates(body: Record<string, unknown>): Partial<Record<PatchableKey, unknown>> {
  const out: Partial<Record<PatchableKey, unknown>> = {};
  for (const k of PATCHABLE_EXAM_KEYS) {
    if (k in body) out[k] = body[k];
  }
  return out;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const raw = await request.json();
    const updates = pickExamUpdates(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Sin campos válidos para actualizar' }, { status: 400 });
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

    const { data, error } = await supabase
      .from('exams')
      .update(updates)
      .eq('id', examId)
      .eq('teacher_id', user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update exam', message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ exam: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const { supabase, user } = auth;

    const { data: existing, error: fetchErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (fetchErr || !existing || existing.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const { error } = await supabase.from('exams').delete().eq('id', examId).eq('teacher_id', user.id);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete exam', message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}
