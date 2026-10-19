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

function drawImageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, img.naturalWidth || img.width);
  canvas.height = Math.max(1, img.naturalHeight || img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function lumaAt(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
}

function columnDarkRatio(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  darkMax: number
): number {
  let dark = 0;
  for (let y = 0; y < height; y++) {
    if (lumaAt(data, (y * width + x) * 4) < darkMax) dark += 1;
  }
  return dark / Math.max(1, height);
}

function rowDarkRatio(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  y: number,
  darkMax: number
): number {
  let dark = 0;
  for (let x = 0; x < width; x++) {
    if (lumaAt(data, (y * width + x) * 4) < darkMax) dark += 1;
  }
  return dark / Math.max(1, width);
}

/** Quita el recuadro negro de ZipGrade: columnas/filas casi sólidas. */
function cropInsideBox(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, source.width, source.height);
  } catch {
    return source;
  }
  const { data, width, height } = image;
  const darkMax = 88;
  const border = 0.42;
  let x0 = 0;
  let x1 = width - 1;
  let y0 = 0;
  let y1 = height - 1;
  while (x0 < width * 0.28 && columnDarkRatio(data, width, height, x0, darkMax) > border) x0 += 1;
  while (x1 > width * 0.72 && columnDarkRatio(data, width, height, x1, darkMax) > border) x1 -= 1;
  while (y0 < height * 0.28 && rowDarkRatio(data, width, height, y0, darkMax) > border) y0 += 1;
  while (y1 > height * 0.72 && rowDarkRatio(data, width, height, y1, darkMax) > border) y1 -= 1;
  const padX = Math.max(2, Math.round(width * 0.04));
  const padY = Math.max(2, Math.round(height * 0.08));
  x0 = Math.min(width - 8, x0 + padX);
  y0 = Math.min(height - 8, y0 + padY);
  x1 = Math.max(x0 + 6, x1 - padX);
  y1 = Math.max(y0 + 6, y1 - padY);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 8 || h < 8) return source;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return source;
  octx.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  return out;
}

function findDividerX(canvas: HTMLCanvasElement): number | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const { data, width, height } = image;
  const from = Math.floor(width * 0.38);
  const to = Math.ceil(width * 0.62);
  let bestX = Math.round(width * 0.5);
  let best = 0;
  for (let x = from; x <= to; x++) {
    const ratio = columnDarkRatio(data, width, height, x, 100);
    if (ratio > best) {
      best = ratio;
      bestX = x;
    }
  }
  return best >= 0.28 ? bestX : Math.round(width * 0.5);
}

function sliceCanvas(source: HTMLCanvasElement, x: number, w: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, x, 0, w, source.height, 0, 0, w, source.height);
  return out;
}

function otsuAndThicken(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, source.width, source.height);
  } catch {
    return source;
  }
  const { data, width, height } = image;
  const hist = new Array<number>(256).fill(0);
  const gray = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const g = Math.round(lumaAt(data, i));
    gray[p] = g;
    hist[g] += 1;
  }
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thresh = 140;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thresh = t;
    }
  }
  const binary = new Uint8Array(gray.length);
  let black = 0;
  for (let p = 0; p < gray.length; p++) {
    const isInk = gray[p]! < thresh;
    binary[p] = isInk ? 1 : 0;
    if (isInk) black += 1;
  }
  if (black / total > 0.55) {
    for (let p = 0; p < binary.length; p++) binary[p] = binary[p] ? 0 : 1;
  }
  const thick = new Uint8Array(binary);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (binary[y * width + x]) continue;
      if (
        binary[y * width + x - 1] ||
        binary[y * width + x + 1] ||
        binary[(y - 1) * width + x] ||
        binary[(y + 1) * width + x]
      ) {
        thick[y * width + x] = 1;
      }
    }
  }
  for (let p = 0, i = 0; p < thick.length; p++, i += 4) {
    const v = thick[p] ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return source;
}

function scaleForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const targetH = 72;
  const scale = Math.max(2.5, targetH / Math.max(1, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(source.width * scale));
  canvas.height = Math.max(8, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function prepareCell(source: HTMLCanvasElement): HTMLCanvasElement {
  return scaleForOcr(otsuAndThicken(cropInsideBox(source)));
}

function splitNameCells(band: HTMLCanvasElement): HTMLCanvasElement[] {
  if (band.width < band.height * 1.2) return [prepareCell(band)];
  const mid = findDividerX(band) ?? Math.round(band.width * 0.5);
  const gap = Math.max(4, Math.round(band.width * 0.012));
  const leftW = Math.max(8, mid - gap);
  const rightX = Math.min(band.width - 8, mid + gap);
  const rightW = Math.max(8, band.width - rightX);
  return [prepareCell(sliceCanvas(band, 0, leftW)), prepareCell(sliceCanvas(band, rightX, rightW))];
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

function rosterWhitelist(students: { name: string }[] | undefined): string {
  const letters = new Set<string>('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÜÑáéíóúüñ ');
  for (const s of students ?? []) {
    for (const ch of s.name) {
      if (/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(ch)) letters.add(ch);
    }
  }
  return [...letters].join('');
}

const OCR_MODES = [PSM.SINGLE_WORD, PSM.SINGLE_LINE, PSM.SPARSE_TEXT] as const;

async function readCell(worker: Worker, cell: HTMLCanvasElement): Promise<string[]> {
  const texts = new Set<string>();
  for (const psm of OCR_MODES) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(cell);
    const text = cleanOcrText(data.text ?? '');
    if (text) texts.add(text);
    for (const word of data.words ?? []) {
      const w = cleanOcrText(word.text ?? '');
      if (w && (word.confidence ?? 0) >= 35) texts.add(w);
    }
  }
  return [...texts];
}

/**
 * Lee Nombre|Apellido. Si pasas el grupo, acota letras y elige la lectura
 * que mejor encaje con un alumno.
 */
export async function recognizeNameCrop(
  dataUrl: string | null | undefined,
  students?: { id: string; name: string }[]
): Promise<string> {
  const src = (dataUrl ?? '').trim();
  if (!src.startsWith('data:image')) return '';
  try {
    const img = await loadImage(src);
    const cells = splitNameCells(drawImageToCanvas(img));
    const worker = await getWorker();
    await worker.setParameters({
      tessedit_char_whitelist: rosterWhitelist(students),
    });
    const perCell: string[][] = [];
    for (const cell of cells) {
      perCell.push(await readCell(worker, cell));
    }
    const joined = perCell.map((opts) => opts[0] ?? '').filter(Boolean).join(' ');
    if (!students?.length) return cleanOcrText(joined);

    const hints: string[] = [];
    if (joined) hints.push(joined);
    if (perCell.length >= 2) {
      for (const a of perCell[0] ?? []) {
        for (const b of perCell[1] ?? []) {
          hints.push(`${a} ${b}`);
        }
      }
    } else {
      hints.push(...(perCell[0] ?? []));
    }

    let bestHint = cleanOcrText(joined);
    for (const hint of hints) {
      if (matchStudentByLooseName(hint, students)) {
        return cleanOcrText(hint);
      }
      if (!bestHint) bestHint = cleanOcrText(hint);
    }
    return bestHint;
  } catch (error) {
    console.warn('OCR nombre manuscrito:', error);
    return '';
  }
}
