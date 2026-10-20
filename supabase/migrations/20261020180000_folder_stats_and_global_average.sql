-- Conteos de carpeta y promedio global sin bajar todas las filas de answers.

create or replace function public.exam_student_headcounts(p_exam_ids uuid[])
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
  if p_exam_ids is null or cardinality(p_exam_ids) = 0 then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exam_id', x.exam_id,
        'students', x.students
      ))
      from (
        select a.exam_id, count(distinct a.student_id)::int as students
        from public.answers a
        inner join public.exams e on e.id = a.exam_id
        where e.teacher_id = v_uid
          and a.exam_id = any(p_exam_ids)
        group by a.exam_id
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.exam_student_headcounts(uuid[]) from public;
revoke all on function public.exam_student_headcounts(uuid[]) from anon;
grant execute on function public.exam_student_headcounts(uuid[]) to authenticated;

create or replace function public.teacher_global_grade_average()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_avg numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  with max_scores as (
    select q.exam_id, greatest(1, coalesce(sum(coalesce(q.points, 1)), 0)) as max_score
    from public.questions q
    inner join public.exams e on e.id = q.exam_id
    where e.teacher_id = v_uid
    group by q.exam_id
  ),
  student_pct as (
    select
      a.exam_id,
      a.student_id,
      least(
        100::numeric,
        greatest(
          0::numeric,
          round(100.0 * coalesce(sum(a.score), 0) / ms.max_score)
        )
      ) as pct
    from public.answers a
    inner join max_scores ms on ms.exam_id = a.exam_id
    group by a.exam_id, a.student_id, ms.max_score
  ),
  exam_avg as (
    select exam_id, avg(pct) as avg_pct
    from student_pct
    group by exam_id
  )
  select round(avg(avg_pct)) into v_avg
  from exam_avg;

  return jsonb_build_object('ok', true, 'percent', v_avg);
end;
$$;

revoke all on function public.teacher_global_grade_average() from public;
revoke all on function public.teacher_global_grade_average() from anon;
grant execute on function public.teacher_global_grade_average() to authenticated;

create or replace function public.teacher_exam_student_scores(p_exam_ids uuid[])
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
  if p_exam_ids is null or cardinality(p_exam_ids) = 0 then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exam_id', x.exam_id,
        'student_id', x.student_id,
        'points', x.points
      ))
      from (
        select a.exam_id, a.student_id, coalesce(sum(a.score), 0) as points
        from public.answers a
        inner join public.exams e on e.id = a.exam_id
        where e.teacher_id = v_uid
          and a.exam_id = any(p_exam_ids)
        group by a.exam_id, a.student_id
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.teacher_exam_student_scores(uuid[]) from public;
revoke all on function public.teacher_exam_student_scores(uuid[]) from anon;
grant execute on function public.teacher_exam_student_scores(uuid[]) to authenticated;
