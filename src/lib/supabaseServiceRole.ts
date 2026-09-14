import 'server-only';

/**
 * Claves de Supabase:
 * - JWT `eyJ…` con `"role":"service_role"` (API legacy)
 * - `sb_secret_…` (API keys nuevas)
 * NO vale `sb_publishable_…` ni la anon JWT (`"role":"anon"`).
 */
export function isUsableSupabaseServiceRoleKey(
  key: string | undefined | null,
): key is string {
  const k = (key ?? '').trim();
  if (!k) return false;
  if (k.startsWith('sb_publishable_')) return false;
  if (k.startsWith('sb_secret_')) return true;
  try {
    const segment = k.split('.')[1];
    if (!segment) return false;
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as {
      role?: string;
    };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export function supabaseServiceRoleConfigError(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!key) {
    return 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel (Settings → Environment Variables).';
  }
  if (key.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY está mal: pegaste la publishable (pública). En Supabase → Project Settings → API usa service_role (JWT eyJ…) o la secret sb_secret_.';
  }
  if (!isUsableSupabaseServiceRoleKey(key)) {
    return 'SUPABASE_SERVICE_ROLE_KEY no es una clave service_role válida (no uses la anon).';
  }
  return null;
}
