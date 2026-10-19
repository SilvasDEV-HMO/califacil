'use client';

import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { matchStudentByLooseName } from '@/lib/zipGradePaperDetails';

export type NameCropMatch<T extends { id: string; name: string }> = {
  text: string;
  student: T | null;
};

type RosterRow = { id: string; name: string; control_number?: string | null };

/** Recorte pequeño: gpt-4o-mini cobra la imagen por tamaño/detalle. */
async function shrinkNameCrop(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined') return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('crop'));
      el.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const maxW = 420;
    const scale = w > maxW ? maxW / w : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, Math.round(w * scale));
    canvas.height = Math.max(8, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.62);
  } catch {
    return dataUrl;
  }
}

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
    const small = await shrinkNameCrop(src);
    let res = await postMatchName(small, students);
    if (!res.ok && res.status === 429) {
      await new Promise((r) => setTimeout(r, 800));
      res = await postMatchName(small, students);
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
