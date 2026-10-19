'use client';

import { createWorker, PSM, type Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo abrir el recorte'));
    img.src = dataUrl;
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

function contrastCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d');
  if (!ctx) return source;
  const image = ctx.getImageData(0, 0, source.width, source.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const v = g < 175 ? Math.max(0, (g - 28) * 1.28) : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return source;
}

function drawScaled(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const scale = sw < 220 ? 3 : sw < 360 ? 2 : 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return contrastCanvas(canvas);
}

async function cropPieces(dataUrl: string): Promise<string[]> {
  if (typeof document === 'undefined') return [dataUrl];
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const pieces = [drawScaled(img, 0, 0, w, h)];
  if (w >= h * 1.35) {
    const mid = Math.round(w * 0.5);
    const gap = Math.round(w * 0.03);
    pieces.push(drawScaled(img, 0, 0, Math.max(1, mid - gap), h));
    pieces.push(drawScaled(img, Math.min(w - 1, mid + gap), 0, Math.max(1, w - mid - gap), h));
  }
  return pieces.map(canvasToDataUrl);
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
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
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

/** Lee el recorte Nombre|Apellido. Si falla, cadena vacía (la fila queda pendiente). */
export async function recognizeNameCrop(dataUrl: string | null | undefined): Promise<string> {
  const src = (dataUrl ?? '').trim();
  if (!src.startsWith('data:image')) return '';
  try {
    const pieces = await cropPieces(src);
    const worker = await getWorker();
    const texts: string[] = [];
    for (const piece of pieces) {
      const { data } = await worker.recognize(piece);
      const text = cleanOcrText(data.text ?? '');
      if (text) texts.push(text);
    }
    return cleanOcrText(texts.join(' '));
  } catch (error) {
    console.warn('OCR nombre manuscrito:', error);
    return '';
  }
}
