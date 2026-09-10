/**
 * Dominio institucional I.T.H.: cuentas auto-confirmadas y con acceso completo (sin Stripe).
 */
export const CALIFACIL_ITH_EMAIL_DOMAIN = 'ith.com';

export function normalizeAuthEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Correos @ith.com (p. ej. docente001@ith.com). */
export function isCalifacilIthEmail(email: string | null | undefined): boolean {
  const normalized = normalizeAuthEmail(email);
  if (!normalized || !normalized.includes('@')) return false;
  return normalized.endsWith(`@${CALIFACIL_ITH_EMAIL_DOMAIN}`);
}
