'use client';

import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { matchStudentByLooseName } from '@/lib/zipGradePaperDetails';

export type NameCropMatch<T extends { id: string; name: string }> = {
  text: string;
  student: T | null;
};

/**
 * Lee el recorte Nombre|Apellido con visión (gpt-4o-mini) y lo cruza con el grupo.
 * Tesseract no lee esta letra manuscrita; si la API falla, no se asigna alumno.
 */
export async function matchNameCropToGroup<T extends { id: string; name: string }>(
  dataUrl: string | null | undefined,
  students: T[]
): Promise<NameCropMatch<T>> {
  const src = (dataUrl ?? '').trim();
  if (!src.startsWith('data:image') || students.length === 0) {
    return { text: '', student: null };
  }

  try {
    const headers = await dashboardAuthJsonHeaders();
    const res = await fetch('/api/calificar/match-name', {
      method: 'POST',
      headers: { ...headers },
      credentials: 'include',
      body: JSON.stringify({
        image: src,
        students: students.map((s) => ({ id: s.id, name: s.name })),
      }),
    });
    if (!res.ok) {
      console.warn('OCR nombre manuscrito HTTP', res.status);
      return { text: '', student: null };
    }
    const data = (await res.json()) as { studentId?: string | null; readText?: string };
    const text = (data.readText ?? '').trim();
    const byId = data.studentId ? students.find((s) => s.id === data.studentId) ?? null : null;
    const student = byId ?? matchStudentByLooseName(text, students);
    return { text, student };
  } catch (error) {
    console.warn('OCR nombre manuscrito:', error);
    return { text: '', student: null };
  }
}

/** @deprecated Usa matchNameCropToGroup; se conserva el nombre por el lote. */
export async function recognizeNameCrop(
  dataUrl: string | null | undefined,
  students?: { id: string; name: string }[]
): Promise<string> {
  const matched = await matchNameCropToGroup(dataUrl, students ?? []);
  return matched.text;
}
