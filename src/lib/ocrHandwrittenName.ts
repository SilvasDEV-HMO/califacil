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
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    return dataUrl;
  }
}

async function postMatchName(
  image: string,
  candidates: { id: string; name: string }[]
) {
  const headers = await dashboardAuthJsonHeaders();
  return fetch('/api/calificar/match-name', {
    method: 'POST',
    headers: { ...headers },
    credentials: 'include',
    body: JSON.stringify({ image, candidates }),
  });
}

/**
 * Lee el recorte con visión barata (1 imagen, detail=low) y cruza en local con el grupo.
 */
export async function matchNameCropToGroup<T extends RosterRow>(
  dataUrl: string | null | undefined,
  students: T[],
  boxes?: NameCropPair
): Promise<NameCropMatch<T>> {
  if (students.length === 1) {
    return { text: '', student: students[0]! };
  }
  const src =
    (dataUrl ?? '').trim() ||
    (boxes?.surnames ?? '').trim() ||
    (boxes?.given ?? '').trim();
  if (!src.startsWith('data:image') || students.length === 0) {
    return { text: '', student: null };
  }

  try {
    const small = await shrinkNameCrop(src, 900);
    const candidates = students.slice(0, 120).map((s) => ({ id: s.id, name: s.name }));
    let res = await postMatchName(small, candidates);
    for (let attempt = 0; !res.ok && res.status === 429 && attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      res = await postMatchName(small, candidates);
    }
    if (!res.ok) {
      console.warn('OCR nombre manuscrito HTTP', res.status);
      return { text: '', student: null };
    }
    const data = (await res.json()) as {
      readText?: string;
      givenText?: string;
      surnamesText?: string;
      studentId?: string | null;
    };
    const text = stripPrintedSheetLabels(
      [data.givenText, data.surnamesText].filter(Boolean).join(' ') || data.readText || ''
    );
    const fromId =
      typeof data.studentId === 'string'
        ? students.find((s) => s.id === data.studentId) ?? null
        : null;
    const student = fromId ?? matchStudentByLooseName(text, students);
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
