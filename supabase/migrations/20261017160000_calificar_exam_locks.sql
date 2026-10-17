-- Bloqueo de examen en Calificar: una sola sesión activa por examen
-- (varios dispositivos / pestañas con la misma cuenta de maestro).

create table if not exists public.calificar_exam_locks (
  exam_id uuid primary key references public.exams (id) on delete cascade,
  teacher_id uuid not null references auth.users (id) on delete cascade,
  holder_client_id uuid not null,
  holder_label text,
  acquired_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now()
);

create index if not exists calificar_exam_locks_teacher_idx
  on public.calificar_exam_locks (teacher_id);

create index if not exists calificar_exam_locks_heartbeat_idx
  on public.calificar_exam_locks (last_heartbeat_at);

alter table public.calificar_exam_locks enable row level security;

revoke all on table public.calificar_exam_locks from anon, authenticated;

-- Lectura: el maestro ve bloqueos de sus exámenes (para marcar en el combobox).
drop policy if exists calificar_exam_locks_select_own on public.calificar_exam_locks;
create policy calificar_exam_locks_select_own
  on public.calificar_exam_locks
  for select
  to authenticated
  using (teacher_id = auth.uid());

grant select on table public.calificar_exam_locks to authenticated;

-- Segundos sin heartbeat → otro cliente puede tomar el bloqueo.
create or replace function public.calificar_exam_lock_stale_seconds()
returns integer
language sql
immutable
as $$
  select 45;
$$;

create or replace function public.acquire_calificar_exam_lock(
  p_exam_id uuid,
  p_client_id uuid,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher uuid := auth.uid();
  r public.calificar_exam_locks%rowtype;
  v_stale interval := make_interval(secs => public.calificar_exam_lock_stale_seconds());
begin
  if v_teacher is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_exam_id is null or p_client_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if not public.teacher_owns_exam(p_exam_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.calificar_exam_locks
  where exam_id = p_exam_id
  for update;

  if not found then
    insert into public.calificar_exam_locks (
      exam_id, teacher_id, holder_client_id, holder_label, acquired_at, last_heartbeat_at
    ) values (
      p_exam_id, v_teacher, p_client_id, nullif(trim(p_label), ''), now(), now()
    );
    return jsonb_build_object('ok', true, 'fresh', true);
  end if;

  -- Mismo cliente: renovar
  if r.holder_client_id = p_client_id then
    update public.calificar_exam_locks
    set
      last_heartbeat_at = now(),
      holder_label = coalesce(nullif(trim(p_label), ''), holder_label)
    where exam_id = p_exam_id;
    return jsonb_build_object('ok', true, 'resume', true);
  end if;

  -- Bloqueo caducado: tomar posesión
  if r.last_heartbeat_at < now() - v_stale then
    update public.calificar_exam_locks
    set
      teacher_id = v_teacher,
      holder_client_id = p_client_id,
      holder_label = nullif(trim(p_label), ''),
      acquired_at = now(),
      last_heartbeat_at = now()
    where exam_id = p_exam_id;
    return jsonb_build_object('ok', true, 'stolen', true);
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', 'held',
    'holder_label', r.holder_label,
    'last_heartbeat_at', r.last_heartbeat_at
  );
end;
$$;

create or replace function public.heartbeat_calificar_exam_lock(
  p_exam_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  update public.calificar_exam_locks
  set last_heartbeat_at = now()
  where exam_id = p_exam_id
    and holder_client_id = p_client_id
    and teacher_id = auth.uid();

  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_holder');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_calificar_exam_lock(
  p_exam_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  delete from public.calificar_exam_locks
  where exam_id = p_exam_id
    and holder_client_id = p_client_id
    and teacher_id = auth.uid();

  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'released', n > 0);
end;
$$;

create or replace function public.list_active_calificar_exam_locks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stale interval := make_interval(secs => public.calificar_exam_lock_stale_seconds());
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  return jsonb_build_object(
    'ok', true,
    'locks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'exam_id', l.exam_id,
          'holder_client_id', l.holder_client_id,
          'holder_label', l.holder_label,
          'last_heartbeat_at', l.last_heartbeat_at
        )
        order by l.last_heartbeat_at desc
      )
      from public.calificar_exam_locks l
      where l.teacher_id = auth.uid()
        and l.last_heartbeat_at >= now() - v_stale
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.calificar_exam_lock_stale_seconds() from public;
revoke all on function public.acquire_calificar_exam_lock(uuid, uuid, text) from public;
revoke all on function public.heartbeat_calificar_exam_lock(uuid, uuid) from public;
revoke all on function public.release_calificar_exam_lock(uuid, uuid) from public;
revoke all on function public.list_active_calificar_exam_locks() from public;

grant execute on function public.calificar_exam_lock_stale_seconds() to authenticated;
grant execute on function public.acquire_calificar_exam_lock(uuid, uuid, text) to authenticated;
grant execute on function public.heartbeat_calificar_exam_lock(uuid, uuid) to authenticated;
grant execute on function public.release_calificar_exam_lock(uuid, uuid) to authenticated;
grant execute on function public.list_active_calificar_exam_locks() to authenticated;
