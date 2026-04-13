-- Esquema principal CaliFácil + RLS (ejecutar antes de 20250323120000_exam_attempts.sql en BD nueva).
-- En proyectos ya existentes: revisar conflictos con tablas/políticas creadas a mano.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  title text not null,
  description text,
  qr_code text,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  text text not null,
  type text not null check (type in ('multiple_choice', 'open_answer')),
  options jsonb,
  correct_answer text,
  illustration text,
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  answer_text text not null,
  is_correct boolean,
  score integer,
  created_at timestamptz not null default now()
);

create unique index if not exists answers_exam_student_question_uidx
  on public.answers (exam_id, student_id, question_id);

create index if not exists exams_teacher_id_idx on public.exams (teacher_id);
create index if not exists exams_group_id_idx on public.exams (group_id);
create index if not exists questions_exam_id_idx on public.questions (exam_id);
create index if not exists answers_exam_id_idx on public.answers (exam_id);
create index if not exists students_group_id_idx on public.students (group_id);
create index if not exists groups_teacher_id_idx on public.groups (teacher_id);

-- ---------------------------------------------------------------------------
-- RPC: conteo de respuestas para alumno anónimo (evita SELECT amplio en answers)
-- ---------------------------------------------------------------------------

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
declare  n int;
begin
  if not exists (
    select 1
    from public.exams ex
    join public.students st on st.group_id = ex.group_id
    where ex.id = p_exam_id
      and st.id = p_student_id
      and ex.status = 'published'
      and ex.group_id is not null
  ) then
    return -1;
  end if;

  select count(*)::int into n
  from public.answers
  where exam_id = p_exam_id
    and student_id = p_student_id;

  return coalesce(n, 0);
end;
$$;

grant execute on function public.student_answer_count(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.students enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;

-- Limpiar políticas previas si se re-ejecuta el script en desarrollo
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('groups', 'students', 'exams', 'questions', 'answers')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- groups: solo el maestro dueño
create policy groups_teacher_all on public.groups
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- students: maestro dueño del grupo
create policy students_teacher_all on public.students
  for all to authenticated
  using (
    exists (
      select 1 from public.groups g
      where g.id = students.group_id
        and g.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.groups g
      where g.id = students.group_id
        and g.teacher_id = auth.uid()
    )
  );

-- students: lectura anónima si hay examen publicado de ese grupo (lista de nombres en /examen)
create policy students_select_published_group on public.students
  for select to anon
  using (
    exists (
      select 1 from public.exams e
      where e.group_id = students.group_id
        and e.status = 'published'
        and e.group_id is not null
    )
  );

-- exams: maestro dueño
create policy exams_teacher_all on public.exams
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- exams: solo publicados para anónimos (toma de examen)
create policy exams_select_published_anon on public.exams
  for select to anon
  using (status = 'published');

-- questions: maestro del examen
create policy questions_teacher_all on public.questions
  for all to authenticated
  using (
    exists (
      select 1 from public.exams e
      where e.id = questions.exam_id
        and e.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.exams e
      where e.id = questions.exam_id
        and e.teacher_id = auth.uid()
    )
  );

-- questions: lectura anónima de preguntas de exámenes publicados
create policy questions_select_published_anon on public.questions
  for select to anon
  using (
    exists (
      select 1 from public.exams e
      where e.id = questions.exam_id
        and e.status = 'published'
    )
  );

-- answers: maestro del examen (calificar, resultados, borrar antes de re-calificar)
create policy answers_teacher_select on public.answers
  for select to authenticated
  using (
    exists (
      select 1 from public.exams e
      where e.id = answers.exam_id
        and e.teacher_id = auth.uid()
    )
  );

create policy answers_teacher_insert on public.answers
  for insert to authenticated
  with check (
    exists (
      select 1 from public.exams e
      where e.id = answers.exam_id
        and e.teacher_id = auth.uid()
    )
  );

create policy answers_teacher_update on public.answers
  for update to authenticated
  using (
    exists (
      select 1 from public.exams e
      where e.id = answers.exam_id
        and e.teacher_id = auth.uid()
    )
  );

create policy answers_teacher_delete on public.answers
  for delete to authenticated
  using (
    exists (
      select 1 from public.exams e
      where e.id = answers.exam_id
        and e.teacher_id = auth.uid()
    )
  );

-- answers: alumno anónimo entrega si el examen está publicado y pertenece al grupo
create policy answers_anon_insert on public.answers
  for insert to anon
  with check (
    exists (
      select 1
      from public.exams e
      join public.students s on s.id = answers.student_id
      where e.id = answers.exam_id
        and e.status = 'published'
        and e.group_id is not null
        and e.group_id = s.group_id
    )
  );
