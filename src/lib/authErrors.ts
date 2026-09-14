/**
 * Traduce mensajes típicos de Supabase Auth / API a español claro para toasts.
 */
export function toSpanishAuthMessage(raw: string | undefined | null): string {
  const t = (raw ?? '').trim();
  if (!t) return 'Ocurrió un error. Inténtalo de nuevo.';

  const exact: Record<string, string> = {
    'Invalid login credentials': 'Usuario o contraseña incorrectos.',
    'Invalid email or password': 'Usuario o contraseña incorrectos.',
    'Email not confirmed': 'Debes confirmar tu correo antes de iniciar sesión.',
    'User already registered': 'Este correo ya está registrado.',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.',
    'Signup requires a valid password': 'La contraseña no es válida.',
    'Unable to validate email address: invalid format': 'El formato del correo no es válido.',
    'Email rate limit exceeded': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    LOGIN_LOCKED: 'Demasiados intentos fallidos. Espera antes de volver a intentar.',
    'For security purposes, you can only request this after': 'Por seguridad, debes esperar antes de volver a intentarlo.',
  };

  if (exact[t]) return exact[t];

  const lower = t.toLowerCase();
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Usuario o contraseña incorrectos.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Debes confirmar tu correo antes de iniciar sesión.';
  }
  if (lower.includes('user already registered') || lower.includes('already registered')) {
    return 'Este correo ya está registrado.';
  }
  if (lower.includes('password') && lower.includes('at least')) {
    return 'La contraseña debe cumplir los requisitos mínimos.';
  }
  if (lower.includes('invalid email')) {
    return 'El formato del correo no es válido.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Error de conexión. Revisa tu internet e inténtalo de nuevo.';
  }
  if (lower.includes('auth session missing') || lower.includes('session missing')) {
    return 'No hay sesión activa. Inicia sesión de nuevo.';
  }

  // Si parece inglés genérico de API, mensaje neutro
  if (/^[a-z][a-z\s]{0,40}$/i.test(t) && /error|failed|invalid|unable/i.test(t)) {
    return 'No se pudo completar la operación. Inténtalo de nuevo.';
  }

  return t;
}
