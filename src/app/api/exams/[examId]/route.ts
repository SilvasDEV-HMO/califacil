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

function parseGroupIds(body: Record<string, unknown>): { provided: boolean; value: string[] } {
  if (!Object.prototype.hasOwnProperty.call(body, 'group_ids')) {
    return { provided: false, value: [] };
  }
  const raw = body.group_ids;
  if (!Array.isArray(raw)) {
    throw new Error('group_ids debe ser un arreglo');
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new Error('Cada group_id debe ser string');
    }
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return { provided: true, value: out };
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
    const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const updates = pickExamUpdates(body);
    const groupIds = parseGroupIds(body);

    if (Object.keys(updates).length === 0 && !groupIds.provided) {
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

    if (groupIds.provided) {
      if (groupIds.value.length > 0) {
        const { data: ownedGroups, error: groupsErr } = await supabase
          .from('groups')
          .select('id')
          .eq('teacher_id', user.id)
          .in('id', groupIds.value);

        if (groupsErr) {
          return NextResponse.json(
            { error: 'No se pudieron validar los grupos', message: groupsErr.message },
            { status: 500 }
          );
        }

        if ((ownedGroups || []).length !== groupIds.value.length) {
          return NextResponse.json(
            { error: 'Uno o más grupos no son válidos para este docente' },
            { status: 400 }
          );
        }
      }
      updates.group_id = groupIds.value[0] ?? null;
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
        { error: 'No se pudo actualizar el examen', message: error.message },
        { status: 500 }
      );
    }

    if (groupIds.provided) {
      const { error: deleteErr } = await supabase
        .from('exam_group_assignments')
        .delete()
        .eq('exam_id', examId);

      if (deleteErr) {
        const migrationHint =
          deleteErr.code === '42P01'
            ? 'Falta migración de multi-grupo: ejecuta 20260421110000_exam_multi_group_assignments.sql'
            : undefined;
        return NextResponse.json(
          { error: 'No se pudieron actualizar las asignaciones de grupos', message: deleteErr.message, hint: migrationHint },
          { status: 500 }
        );
      }

      if (groupIds.value.length > 0) {
        const { error: insertErr } = await supabase
          .from('exam_group_assignments')
          .insert(groupIds.value.map((groupId) => ({ exam_id: examId, group_id: groupId })));

        if (insertErr) {
          const migrationHint =
            insertErr.code === '42P01'
              ? 'Falta migración de multi-grupo: ejecuta 20260421110000_exam_multi_group_assignments.sql'
              : undefined;
          return NextResponse.json(
            { error: 'No se pudieron guardar las asignaciones de grupos', message: insertErr.message, hint: migrationHint },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ exam: data, group_ids: groupIds.provided ? groupIds.value : undefined });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (/group_ids|group_id/i.test(message)) {
      return NextResponse.json({ error: 'Datos de grupos inválidos', message }, { status: 400 });
    }
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
