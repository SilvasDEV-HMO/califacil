-- Exámenes ya calificados al 100% (todos los alumnos de sus grupos tienen respuestas).
-- Se usan para ocultarlos del selector en Calificar.

create or replace function public.list_calificar_completed_exam_ids()
returns jsonb
language plpgsql
security definer
set search_path = public
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
      with teacher_exams as (
        select e.id, e.group_id
        from public.exams e
        where e.teacher_id = v_uid
          and e.status = 'published'
      ),
      exam_groups as (
        select te.id as exam_id, ega.group_id
        from teacher_exams te
        join public.exam_group_assignments ega on ega.exam_id = te.id
        union
        select te.id as exam_id, te.group_id
        from teacher_exams te
        where te.group_id is not null
          and not exists (
            select 1 from public.exam_group_assignments x where x.exam_id = te.id
          )
      ),
      expected as (
        select eg.exam_id, count(distinct s.id)::int as n_students
        from exam_groups eg
        join public.students s on s.group_id = eg.group_id
        where eg.group_id is not null
        group by eg.exam_id
      ),
      graded as (
        select a.exam_id, count(distinct a.student_id)::int as n_graded
        from public.answers a
        join teacher_exams te on te.id = a.exam_id
        group by a.exam_id
      )
      select jsonb_agg(e.exam_id order by e.exam_id)
      from expected e
      join graded g on g.exam_id = e.exam_id
      where e.n_students > 0
        and g.n_graded >= e.n_students
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_calificar_completed_exam_ids() from public;
grant execute on function public.list_calificar_completed_exam_ids() to authenticated;
