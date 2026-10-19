'use client';

import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { matchStudentByLooseName } from '@/lib/zipGradePaperDetails';

export type NameCropMatch<T extends { id: string; name: string }> = {
  text: string;
  student: T | null;
};

type RosterRow = { id: string; name: string; control_number?: string | null };

async function postMatchName(image: string, students: RosterRow[]) {
  const headers = await dashboardAuthJsonHeaders();
  return fetch('/api/calificar/match-name', {
    method: 'POST',
    headers: { ...headers },
    credentials: 'include',
    body: JSON.stringify({
      image,
      students: students.map((s) => ({
        id: s.id,
        name: s.name,
        control: s.control_number ?? '',
      })),
    }),
  });
}

/**
 * Lee el recorte Nombre|Apellido con visión (gpt-4o-mini) y lo cruza con el grupo.
 */
export async function matchNameCropToGroup<T extends RosterRow>(
  dataUrl: string | null | undefined,
  students: T[]
): Promise<NameCropMatch<T>> {
  const src = (dataUrl ?? '').trim();
  if (!src.startsWith('data:image') || students.length === 0) {
    return { text: '', student: null };
  }

  try {
    let res = await postMatchName(src, students);
    if (!res.ok && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 600));
      res = await postMatchName(src, students);
    }
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
