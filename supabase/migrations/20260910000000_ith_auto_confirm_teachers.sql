-- Docentes @ith.com: email auto-confirmado + billing activo (sin Stripe).

create or replace function public.auto_confirm_ith_auth_user()
returns trigger
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  if new.email is not null and lower(new.email) like '%@ith.com' then
    if new.email_confirmed_at is null then
      new.email_confirmed_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_before_ith_auto_confirm on auth.users;
create trigger on_auth_user_before_ith_auto_confirm
before insert on auth.users
for each row
execute function public.auto_confirm_ith_auth_user();

-- Confirmar cuentas @ith.com ya existentes (p. ej. docente001@ith.com).
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email is not null
  and lower(email) like '%@ith.com'
  and email_confirmed_at is null;

-- Billing activo para docentes I.T.H. (nuevos).
create or replace function public.create_teacher_billing_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_ith boolean := new.email is not null and lower(new.email) like '%@ith.com';
begin
  insert into public.teacher_billing (
    user_id,
    is_active,
    subscription_status,
    plan_key
  )
  values (
    new.id,
    is_ith,
    case when is_ith then 'active' else 'unpaid' end,
    case when is_ith then 'pro' else null end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Activar billing de docentes I.T.H. existentes.
update public.teacher_billing tb
set
  is_active = true,
  subscription_status = 'active',
  plan_key = coalesce(nullif(tb.plan_key, ''), 'pro'),
  updated_at = now()
from auth.users u
where tb.user_id = u.id
  and u.email is not null
  and lower(u.email) like '%@ith.com';

revoke all on function public.auto_confirm_ith_auth_user() from public;
grant execute on function public.auto_confirm_ith_auth_user() to postgres, service_role;
