import { createServiceRoleClient } from '@/lib/examRetake';
import { isCalifacilIthEmail, normalizeAuthEmail } from '@/lib/ithAuth';
import type { SupabaseClient, User } from '@supabase/supabase-js';

function isAlreadyRegisteredError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    msg.includes('already') ||
    msg.includes('registered') ||
    msg.includes('exists')
  );
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const normalized = normalizeAuthEmail(email);
  // Paginar: proyectos pequeños; suficiente para docentes I.T.H.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data.users ?? [];
    const found = users.find((u) => normalizeAuthEmail(u.email) === normalized);
    if (found) return found;
    if (users.length < 200) break;
  }
  return null;
}

async function activateIthBilling(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('teacher_billing').upsert(
    {
      user_id: userId,
      is_active: true,
      subscription_status: 'active',
      plan_key: 'pro',
    },
    { onConflict: 'user_id' }
  );
}

export type EnsureIthTeacherResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; error: string; hint?: string };

/**
 * Crea o repara un docente @ith.com: email confirmado, billing activo, listo para login.
 */
export async function ensureIthTeacherAccount(input: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<EnsureIthTeacherResult> {
  const email = normalizeAuthEmail(input.email);
  const password = input.password;
  const fullName = (input.fullName ?? '').trim();

  if (!isCalifacilIthEmail(email)) {
    return { ok: false, error: 'Solo se admiten correos @ith.com.' };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return {
      ok: false,
      error: 'Falta la clave service_role de Supabase en el servidor.',
      hint: 'En Vercel → Environment Variables pon SUPABASE_SERVICE_ROLE_KEY con la clave service_role (eyJ…), no la publishable/anon.',
    };
  }

  const metadata = {
    role: 'teacher',
    full_name: fullName || email.split('@')[0] || 'Docente I.T.H.',
    name: fullName || email.split('@')[0] || 'Docente I.T.H.',
    institution: 'I.T.H.',
  };

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (!created.error && created.data.user?.id) {
    await activateIthBilling(admin, created.data.user.id);
    return { ok: true, userId: created.data.user.id, created: true };
  }

  if (!isAlreadyRegisteredError(created.error)) {
    return {
      ok: false,
      error: created.error?.message || 'No se pudo crear el usuario I.T.H.',
    };
  }

  const existing = await findUserByEmail(admin, email);
  if (!existing?.id) {
    return {
      ok: false,
      error: 'El correo ya existe pero no se pudo localizar para confirmarlo.',
    };
  }

  const updated = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    user_metadata: {
      ...(existing.user_metadata ?? {}),
      ...metadata,
    },
  });
  if (updated.error) {
    return { ok: false, error: updated.error.message };
  }

  await activateIthBilling(admin, existing.id);
  return { ok: true, userId: existing.id, created: false };
}
