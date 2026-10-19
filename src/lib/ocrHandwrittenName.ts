'use client';

import { createWorker, PSM, type Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

function preprocessNameCrop(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = img.width < 480 ? 2 : img.width < 720 ? 1.5 : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
        const v = g < 168 ? Math.max(0, (g - 40) * 1.35) : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(image, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('No se pudo abrir el recorte'));
    img.src = dataUrl;
  });
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('spa+eng', 1, {
        errorHandler: () => undefined,
      });
      await worker.setParameters({
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÜÑáéíóúüñ '-",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** Lee el recorte Nombre|Apellido. Si falla, cadena vacía (la fila queda pendiente). */
export async function recognizeNameCrop(dataUrl: string | null | undefined): Promise<string> {
  const src = (dataUrl ?? '').trim();
  if (!src.startsWith('data:image')) return '';
  try {
    const prepared = await preprocessNameCrop(src);
    const worker = await getWorker();
    const { data } = await worker.recognize(prepared);
    return (data.text ?? '')
      .replace(/\s+/g, ' ')
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}
