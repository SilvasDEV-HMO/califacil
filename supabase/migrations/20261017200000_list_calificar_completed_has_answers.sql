-- Calificar: ocultar exámenes que ya tienen al menos un alumno calificado
-- (hay filas en answers), no solo cuando el roster del grupo está al 100%.

create or replace function public.list_calificar_completed_exam_ids()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  return jsonb_build_object(
    'ok', true,
    'exam_ids', coalesce((
      select jsonb_agg(e.id order by e.id)
      from public.exams e
      where e.teacher_id = v_uid
        and e.status = 'published'
        and exists (
          select 1 from public.answers a where a.exam_id = e.id
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_calificar_completed_exam_ids() from public;
revoke all on function public.list_calificar_completed_exam_ids() from anon;
grant execute on function public.list_calificar_completed_exam_ids() to authenticated;
