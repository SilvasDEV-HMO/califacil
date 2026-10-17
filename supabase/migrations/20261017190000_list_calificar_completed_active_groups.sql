-- Completado en Calificar: solo grupos con al menos una respuesta,
-- e incluir grupos reales de alumnos ya calificados (p. ej. examen «copia»
-- asignado a otro grupo vacío o distinto).

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
        union
        -- Grupos de quienes ya tienen respuestas (cubre desajuste examen↔grupo).
        select distinct a.exam_id, s.group_id
        from public.answers a
        join teacher_exams te on te.id = a.exam_id
        join public.students s on s.id = a.student_id
        where s.group_id is not null
      ),
      -- Solo grupos donde ya se calificó a alguien: no bloquean grupos asignados sin intentos.
      active_groups as (
        select eg.exam_id, eg.group_id
        from exam_groups eg
        where eg.group_id is not null
          and exists (
            select 1
            from public.answers a
            join public.students s on s.id = a.student_id and s.group_id = eg.group_id
            where a.exam_id = eg.exam_id
          )
      ),
      expected as (
        select ag.exam_id, count(distinct s.id)::int as n_students
        from active_groups ag
        join public.students s on s.group_id = ag.group_id
        group by ag.exam_id
      ),
      graded as (
        select ag.exam_id, count(distinct s.id)::int as n_graded
        from active_groups ag
        join public.students s on s.group_id = ag.group_id
        join public.answers a on a.exam_id = ag.exam_id and a.student_id = s.id
        group by ag.exam_id
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
revoke all on function public.list_calificar_completed_exam_ids() from anon;
grant execute on function public.list_calificar_completed_exam_ids() to authenticated;
