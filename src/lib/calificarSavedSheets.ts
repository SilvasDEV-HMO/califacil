/** Hojas ya guardadas en este navegador, para no volver a pedirlas al re-subir el PDF. */

const STORAGE_KEY = 'califacil.calificar.saved-sheet-keys.v1';
const MAX_KEYS = 20000;

function normalizeFileName(fileName: string): string {
  return fileName.trim().toLowerCase().replace(/\\/g, '/');
}

export function calificarSavedSheetKey(examId: string, fileName: string): string {
  return `${examId}::${normalizeFileName(fileName)}`;
}

function readKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function writeKeys(keys: Set<string>) {
  if (typeof window === 'undefined') return;
  const list = Array.from(keys);
  const trimmed = list.length > MAX_KEYS ? list.slice(list.length - MAX_KEYS) : list;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
}

export function rememberCalificarSavedSheet(examId: string | undefined, fileName: string | undefined) {
  if (!examId || !fileName) return;
  const keys = readKeys();
  keys.add(calificarSavedSheetKey(examId, fileName));
  writeKeys(keys);
}

export function wasCalificarSheetSaved(
  examId: string | undefined,
  fileName: string | undefined
): boolean {
  if (!examId || !fileName) return false;
  return readKeys().has(calificarSavedSheetKey(examId, fileName));
}
