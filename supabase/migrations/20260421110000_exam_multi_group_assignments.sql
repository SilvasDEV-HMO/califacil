-- Multi-grupo para exámenes: asignaciones N:M examen↔grupo + compatibilidad con group_id legado.

create table if not exists public.exam_group_assignments (
  exam_id uuid not null references public.exams (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (exam_id, group_id)
);

create index if not exists exam_group_assignments_group_id_idx
  on public.exam_group_assignments (group_id);

alter table public.exam_group_assignments enable row level security;

drop policy if exists exam_group_assignments_teacher_all on public.exam_group_assignments;
create policy exam_group_assignments_teacher_all on public.exam_group_assignments
  for all to authenticated
  using (
    exists (
      select 1
      from public.exams e
      join public.groups g on g.id = exam_group_assignments.group_id
      where e.id = exam_group_assignments.exam_id
        and e.teacher_id = auth.uid()
        and g.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.exams e
      join public.groups g on g.id = exam_group_assignments.group_id
      where e.id = exam_group_assignments.exam_id
        and e.teacher_id = auth.uid()
        and g.teacher_id = auth.uid()
    )
  );

drop policy if exists exam_group_assignments_anon_select_published on public.exam_group_assignments;
create policy exam_group_assignments_anon_select_published on public.exam_group_assignments
  for select to anon
  using (
    exists (
      select 1
      from public.exams e
      where e.id = exam_group_assignments.exam_id
        and e.status = 'published'
    )
  );

create or replace function public.exam_allows_student(
  p_exam_id uuid,
  p_student_id uuid,
  p_require_published boolean default true
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.exams ex
    join public.students st on st.id = p_student_id
    where ex.id = p_exam_id
      and (not p_require_published or ex.status = 'published')
      and (
        exists (
          select 1
          from public.exam_group_assignments ega
          where ega.exam_id = ex.id
            and ega.group_id = st.group_id
        )
        or (
          not exists (
            select 1
            from public.exam_group_assignments ega2
            where ega2.exam_id = ex.id
          )
          and ex.group_id is not null
          and ex.group_id = st.group_id
        )
      )
  );
$$;

grant execute on function public.exam_allows_student(uuid, uuid, boolean) to anon, authenticated;

create or replace function public.student_answer_count(
  p_exam_id uuid,
  p_student_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  n int;
begin
  if not public.exam_allows_student(p_exam_id, p_student_id, true) then
    return -1;
  end if;

  select count(*)::int into n
  from public.answers
  where exam_id = p_exam_id
    and student_id = p_student_id;

  return coalesce(n, 0);
end;
$$;

create or replace function public.get_student_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.exam_attempts%rowtype;
begin
  if not public.exam_allows_student(p_exam_id, p_student_id, true) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.exam_attempts
  where exam_id = p_exam_id and student_id = p_student_id;

  if not found then
    return jsonb_build_object('ok', true, 'state', 'none');
  end if;

  if r.state = 'voided' then
    return jsonb_build_object(
      'ok', true,
      'state', 'voided',
      'void_reason', r.void_reason
    );
  end if;

  if r.state = 'submitted' then
    return jsonb_build_object('ok', true, 'state', 'submitted');
  end if;

  if r.state = 'in_progress' then
    if p_session is not null and r.client_session = p_session then
      return jsonb_build_object('ok', true, 'state', 'in_progress', 'resume', true);
    else
      return jsonb_build_object('ok', true, 'state', 'in_progress', 'other_device', true);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'state', 'unknown');
end;
$$;

create or replace function public.start_student_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.exam_attempts%rowtype;
begin
  if not public.exam_allows_student(p_exam_id, p_student_id, true) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.exam_attempts
  where exam_id = p_exam_id and student_id = p_student_id;

  if not found then
    insert into public.exam_attempts (exam_id, student_id, state, client_session)
    values (p_exam_id, p_student_id, 'in_progress', p_session);
    return jsonb_build_object('ok', true, 'fresh', true);
  end if;

  if r.state = 'voided' then
    return jsonb_build_object(
      'ok', false,
      'error', 'voided',
      'void_reason', r.void_reason
    );
  end if;

  if r.state = 'submitted' then
    return jsonb_build_object('ok', false, 'error', 'already_submitted');
  end if;

  if r.state = 'in_progress' then
    if r.client_session = p_session then
      return jsonb_build_object('ok', true, 'resume', true);
    else
      return jsonb_build_object('ok', false, 'error', 'in_progress_other');
    end if;
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown');
end;
$$;

drop policy if exists students_select_published_group on public.students;
create policy students_select_published_group on public.students
  for select to anon
  using (
    exists (
      select 1
      from public.exams e
      where e.status = 'published'
        and (
          exists (
            select 1
            from public.exam_group_assignments ega
            where ega.exam_id = e.id
              and ega.group_id = students.group_id
          )
          or (
            not exists (
              select 1
              from public.exam_group_assignments ega2
              where ega2.exam_id = e.id
            )
            and e.group_id is not null
            and e.group_id = students.group_id
          )
        )
    )
  );

drop policy if exists answers_anon_insert on public.answers;
create policy answers_anon_insert on public.answers
  for insert to anon
  with check (public.exam_allows_student(answers.exam_id, answers.student_id, true));
