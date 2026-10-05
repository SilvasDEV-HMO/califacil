export const DESPEGUE_ADMIN_EMAIL = 'admin@califacil.com';

export type DespegueSheetKind = 'matematicas' | 'lenguaje';

function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo la cuenta admin, según el nombre del examen. */
export function despegueSheetKind(
  email: string | null | undefined,
  title: string | null | undefined
): DespegueSheetKind | null {
  if ((email ?? '').trim().toLowerCase() !== DESPEGUE_ADMIN_EMAIL) return null;
  const name = normalizeTitle(title ?? '');
  if (name.startsWith('matematicas despegue 2026') || name.startsWith('mate desp 2026') || name.startsWith('mate despegue 2026')) {
    return 'matematicas';
  }
  if (name.startsWith('lenguaje despegue 2026') || name.startsWith('lenguaje desp 2026') || name.startsWith('leng desp 2026')) {
    return 'lenguaje';
  }
  return null;
}
