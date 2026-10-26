'use client';

import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import { stripPrintedSheetLabels } from '@/lib/handwrittenNameSanitize';
import { matchStudentByLooseName } from '@/lib/zipGradePaperDetails';

export type NameCropMatch<T extends { id: string; name: string }> = {
  text: string;
  student: T | null;
};

type RosterRow = { id: string; name: string; control_number?: string | null };

export type NameCropPair = {
  given?: string | null;
  surnames?: string | null;
};

/** Recorte pequeño: gpt-4o-mini cobra la imagen por tamaño/detalle. */
async function shrinkNameCrop(dataUrl: string, maxW = 900): Promise<string> {
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
    const scale = w > maxW ? maxW / w : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, Math.round(w * scale));
    canvas.height = Math.max(8, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return dataUrl;
  }
}

async function postMatchName(
  payload: { image?: string; givenImage?: string; surnamesImage?: string },
  students: RosterRow[]
) {
  const headers = await dashboardAuthJsonHeaders();
  return fetch('/api/calificar/match-name', {
    method: 'POST',
    headers: { ...headers },
    credentials: 'include',
    body: JSON.stringify({
      ...payload,
      students: students.map((s) => ({
        id: s.id,
        name: s.name,
      })),
    }),
  });
}

/**
 * Lee el recorte Nombre|Apellido con visión (gpt-4o-mini) y lo cruza con los alumnos que faltan.
 */
export async function matchNameCropToGroup<T extends RosterRow>(
  dataUrl: string | null | undefined,
  students: T[],
  boxes?: NameCropPair
): Promise<NameCropMatch<T>> {
  const src = (dataUrl ?? '').trim();
  const givenSrc = (boxes?.given ?? '').trim();
  const surnamesSrc = (boxes?.surnames ?? '').trim();
  const hasSplit = givenSrc.startsWith('data:image') || surnamesSrc.startsWith('data:image');
  if ((!src.startsWith('data:image') && !hasSplit) || students.length === 0) {
    return { text: '', student: null };
  }

  try {
    const payload: { image?: string; givenImage?: string; surnamesImage?: string } = {};
    if (givenSrc.startsWith('data:image')) payload.givenImage = await shrinkNameCrop(givenSrc);
    if (surnamesSrc.startsWith('data:image')) {
      payload.surnamesImage = await shrinkNameCrop(surnamesSrc);
    }
    if (!payload.givenImage && !payload.surnamesImage && src.startsWith('data:image')) {
      payload.image = await shrinkNameCrop(src, 1100);
    }
    let res = await postMatchName(payload, students);
    if (!res.ok && res.status === 429) {
      await new Promise((r) => setTimeout(r, 800));
      res = await postMatchName(payload, students);
    }
    if (!res.ok) {
      console.warn('OCR nombre manuscrito HTTP', res.status);
      return { text: '', student: null };
    }
    const data = (await res.json()) as {
      studentId?: string | null;
      readText?: string;
      givenText?: string;
      surnamesText?: string;
    };
    const text = stripPrintedSheetLabels(
      [data.givenText, data.surnamesText].filter(Boolean).join(' ') || data.readText || ''
    );
    const byId = data.studentId ? students.find((s) => s.id === data.studentId) ?? null : null;
    const student = matchStudentByLooseName(text, students) ?? byId;
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
