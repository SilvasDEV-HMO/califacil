'use client';

import { createWorker, PSM, type Worker } from 'tesseract.js';
import { matchStudentByLooseName } from '@/lib/zipGradePaperDetails';

let workerPromise: Promise<Worker> | null = null;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo abrir el recorte'));
    img.src = dataUrl;
  });
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, img.naturalWidth || img.width);
  canvas.height = Math.max(1, img.naturalHeight || img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function slice(source: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, x, y, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Recorte interior fijo: el marco de ZipGrade queda fuera, la letra no. */
function inset(source: HTMLCanvasElement, fx: number, fy: number): HTMLCanvasElement {
  const dx = Math.round(source.width * fx);
  const dy = Math.round(source.height * fy);
  const w = source.width - dx * 2;
  const h = source.height - dy * 2;
  if (w < 12 || h < 10) return source;
  return slice(source, dx, dy, w, h);
}

function boostInk(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d');
  if (!ctx) return source;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, source.width, source.height);
  } catch {
    return source;
  }
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const v = g < 200 ? Math.max(0, (g - 40) * 1.35) : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return source;
}

function upscale(source: HTMLCanvasElement): HTMLCanvasElement {
  const scale = source.height < 48 ? 4 : source.height < 72 ? 3 : 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(source.width * scale));
  canvas.height = Math.max(8, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return boostInk(canvas);
}

function cellsFromBand(band: HTMLCanvasElement): HTMLCanvasElement[] {
  const inner = inset(band, 0.03, 0.1);
  const mid = Math.round(inner.width * 0.5);
  const gap = Math.max(3, Math.round(inner.width * 0.02));
  const left = upscale(inset(slice(inner, 0, 0, Math.max(8, mid - gap), inner.height), 0.06, 0.08));
  const right = upscale(
    inset(slice(inner, Math.min(inner.width - 8, mid + gap), 0, Math.max(8, inner.width - mid - gap), inner.height), 0.06, 0.08)
  );
  return [left, right, upscale(inner)];
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('spa+eng', 1, {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/tesseract-core-simd-lstm.wasm.js',
        langPath: '/tesseract/lang',
        gzip: true,
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function cleanOcrText(value: string): string {
  return value
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readCanvas(worker: Worker, cell: HTMLCanvasElement): Promise<string> {
  const { data } = await worker.recognize(cell);
  const words = (data.words ?? [])
    .filter((w) => (w.confidence ?? 0) >= 40)
    .map((w) => cleanOcrText(w.text ?? ''))
    .filter((w) => w.length >= 2);
  if (words.length) return words.join(' ');
  return cleanOcrText(data.text ?? '');
}

export async function recognizeNameCrop(
  dataUrl: string | null | undefined,
  students?: { id: string; name: string }[]
): Promise<string> {
  const src = (dataUrl ?? '').trim();
  if (!src.startsWith('data:image')) return '';
  try {
    const img = await loadImage(src);
    const pieces = cellsFromBand(imageToCanvas(img));
    const worker = await getWorker();
    const texts: string[] = [];
    for (const piece of pieces) {
      const text = await readCanvas(worker, piece);
      if (text) texts.push(text);
    }
    const joined = cleanOcrText(texts.join(' '));
    if (!students?.length) return joined;

    const hints = [joined, ...texts];
    if (texts.length >= 2) hints.push(`${texts[0]} ${texts[1]}`);
    for (const hint of hints) {
      if (matchStudentByLooseName(hint, students)) return cleanOcrText(hint);
    }
    return joined;
  } catch (error) {
    console.warn('OCR nombre manuscrito:', error);
    return '';
  }
}
