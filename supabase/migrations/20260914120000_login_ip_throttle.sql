-- Límite de intentos de login por IP (solo service_role; sin políticas para anon/authenticated).

create table if not exists public.login_ip_throttle (
  ip_hash text primary key,
  fail_count integer not null default 0 check (fail_count >= 0),
  lock_round integer not null default 0 check (lock_round >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_ip_throttle enable row level security;

comment on table public.login_ip_throttle is
  'Contador de fallos de inicio de sesión por hash de IP. 3 fallos → bloqueo 10/20/30… minutos.';
