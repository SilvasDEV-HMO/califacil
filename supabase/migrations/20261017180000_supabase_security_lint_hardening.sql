-- Endurece grants / search_path para lints de Security Advisor:
-- - function_search_path_mutable
-- - anon_security_definer_function_executable (donde anon no debe llamar)
-- - authenticated_security_definer_function_executable (triggers / helpers / locks)

-- ---------------------------------------------------------------------------
-- 1) Helper de caducidad: search_path fijo; solo uso interno
-- ---------------------------------------------------------------------------

create or replace function public.calificar_exam_lock_stale_seconds()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select 45;
$$;

revoke all on function public.calificar_exam_lock_stale_seconds() from public;
revoke all on function public.calificar_exam_lock_stale_seconds() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Locks de Calificar: SECURITY INVOKER + RLS (ya no DEFINER)
-- ---------------------------------------------------------------------------

drop policy if exists calificar_exam_locks_insert_own on public.calificar_exam_locks;
create policy calificar_exam_locks_insert_own
  on public.calificar_exam_locks
  for insert
  to authenticated
  with check (
    teacher_id = auth.uid()
    and public.teacher_owns_exam(exam_id)
  );

drop policy if exists calificar_exam_locks_update_own on public.calificar_exam_locks;
create policy calificar_exam_locks_update_own
  on public.calificar_exam_locks
  for update
  to authenticated
  using (public.teacher_owns_exam(exam_id))
  with check (
    teacher_id = auth.uid()
    and public.teacher_owns_exam(exam_id)
  );

drop policy if exists calificar_exam_locks_delete_own on public.calificar_exam_locks;
create policy calificar_exam_locks_delete_own
  on public.calificar_exam_locks
  for delete
  to authenticated
  using (teacher_id = auth.uid());

grant select, insert, update, delete on table public.calificar_exam_locks to authenticated;

create or replace function public.acquire_calificar_exam_lock(
  p_exam_id uuid,
  p_client_id uuid,
  p_label text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
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

  if r.holder_client_id = p_client_id then
    update public.calificar_exam_locks
    set
      last_heartbeat_at = now(),
      holder_label = coalesce(nullif(trim(p_label), ''), holder_label)
    where exam_id = p_exam_id;
    return jsonb_build_object('ok', true, 'resume', true);
  end if;

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
security invoker
set search_path = public, pg_temp
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
security invoker
set search_path = public, pg_temp
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
security invoker
set search_path = public, pg_temp
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

-- INVOKER necesita poder leer el helper de caducidad.
grant execute on function public.calificar_exam_lock_stale_seconds() to authenticated;

revoke all on function public.acquire_calificar_exam_lock(uuid, uuid, text) from public;
revoke all on function public.acquire_calificar_exam_lock(uuid, uuid, text) from anon;
revoke all on function public.heartbeat_calificar_exam_lock(uuid, uuid) from public;
revoke all on function public.heartbeat_calificar_exam_lock(uuid, uuid) from anon;
revoke all on function public.release_calificar_exam_lock(uuid, uuid) from public;
revoke all on function public.release_calificar_exam_lock(uuid, uuid) from anon;
revoke all on function public.list_active_calificar_exam_locks() from public;
revoke all on function public.list_active_calificar_exam_locks() from anon;

grant execute on function public.acquire_calificar_exam_lock(uuid, uuid, text) to authenticated;
grant execute on function public.heartbeat_calificar_exam_lock(uuid, uuid) to authenticated;
grant execute on function public.release_calificar_exam_lock(uuid, uuid) to authenticated;
grant execute on function public.list_active_calificar_exam_locks() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Trigger ITH: no ejecutable por cliente
-- ---------------------------------------------------------------------------

revoke all on function public.auto_confirm_ith_auth_user() from public;
revoke all on function public.auto_confirm_ith_auth_user() from anon, authenticated;
grant execute on function public.auto_confirm_ith_auth_user() to postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4) Helpers / RPCs de maestro: quitar anon; helpers a INVOKER
-- ---------------------------------------------------------------------------

-- Usado por RLS y por RPCs INVOKER: sin DEFINER evita lint 0029.
create or replace function public.teacher_owns_exam(p_exam_id uuid)
returns boolean
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.exams e
    where e.id = p_exam_id
      and e.teacher_id = auth.uid()
  );
$$;

revoke all on function public.teacher_owns_exam(uuid) from public;
revoke all on function public.teacher_owns_exam(uuid) from anon;
grant execute on function public.teacher_owns_exam(uuid) to authenticated;

create or replace function public.teacher_owns_exam_folder(p_folder_id uuid)
returns boolean
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.exam_folders f
    where f.id = p_folder_id
      and f.teacher_id = auth.uid()
  );
$$;

revoke all on function public.teacher_owns_exam_folder(uuid) from public;
revoke all on function public.teacher_owns_exam_folder(uuid) from anon;
grant execute on function public.teacher_owns_exam_folder(uuid) to authenticated;

revoke all on function public.teacher_get_attempt_timeline(uuid, uuid) from public;
revoke all on function public.teacher_get_attempt_timeline(uuid, uuid) from anon;
grant execute on function public.teacher_get_attempt_timeline(uuid, uuid) to authenticated;

revoke all on function public.teacher_grant_exam_retake(uuid, uuid) from public;
revoke all on function public.teacher_grant_exam_retake(uuid, uuid) from anon;
grant execute on function public.teacher_grant_exam_retake(uuid, uuid) to authenticated;

revoke all on function public.teacher_list_voided_attempts(uuid) from public;
revoke all on function public.teacher_list_voided_attempts(uuid) from anon;
grant execute on function public.teacher_list_voided_attempts(uuid) to authenticated;

-- Eventos de alumno por QR: solo anon (mismo patrón que start/complete attempt).
revoke all on function public.log_exam_attempt_event(uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.log_exam_attempt_event(uuid, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.log_exam_attempt_event(uuid, uuid, uuid, text, jsonb) to anon;

-- Exámenes completos en Calificar: solo autenticado.
revoke all on function public.list_calificar_completed_exam_ids() from public;
revoke all on function public.list_calificar_completed_exam_ids() from anon;
grant execute on function public.list_calificar_completed_exam_ids() to authenticated;
