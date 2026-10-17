import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { pdfBufferBytes } from '@/lib/pdfBuffer.server';
import { loadPdfJsServer } from '@/lib/pdfjsServer.server';

function pdfjsAssetUrl(...segments: string[]): string {
  const absolute = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', ...segments);
  return `${absolute.replace(/\\/g, '/')}/`;
}

export const PDF_GRADE_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PDF_OMR_RENDER_MAX_SIDE = 1600;
export const PDF_OMR_MAX_CANVAS_PIXELS = 2_500_000;
/** JPEG quality for OMR rasterization — must stay high (≥95) to preserve bubble edges. */
export const PDF_OMR_JPEG_QUALITY = 98;

async function loadPdfDocument(buffer: ArrayBuffer) {
  const pdfjs = await loadPdfJsServer();
  return pdfjs.getDocument({
    data: pdfBufferBytes(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
  }).promise;
}

export async function countPdfPages(buffer: ArrayBuffer): Promise<number> {
  const pdf = await loadPdfDocument(buffer);
  const numPages = pdf.numPages;
  pdf.destroy?.();
  return numPages;
}

/** Texto de una página (para importar Paper Details de ZipGrade). */
export async function extractPdfPageTextFromBuffer(
  buffer: ArrayBuffer,
  pageNumber: number
): Promise<{ text: string; numPages: number }> {
  const pdf = await loadPdfDocument(buffer);
  const numPages = pdf.numPages;
  if (pageNumber < 1 || pageNumber > numPages) {
    pdf.destroy?.();
    throw new Error('Página fuera de rango');
  }
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const chunks: string[] = [];
  let currentLine = '';
  for (const item of textContent.items as Array<{ str?: string; hasEOL?: boolean }>) {
    const part = (item?.str ?? '').replace(/\s+/g, ' ').trim();
    if (part) currentLine = `${currentLine} ${part}`.trim();
    if (item?.hasEOL && currentLine) {
      chunks.push(currentLine);
      currentLine = '';
    }
  }
  if (currentLine) chunks.push(currentLine);

  // También una versión “plana” con todos los tokens (por si hasEOL falta)
  const flat = (textContent.items as Array<{ str?: string }>)
    .map((it) => (it?.str ?? '').trim())
    .filter(Boolean)
    .join(' ');
  pdf.destroy?.();
  const text = `${chunks.join('\n')}\n${flat}`.trim();
  return { text, numPages };
}

export async function renderPdfPageToJpeg(
  buffer: ArrayBuffer,
  pageNumber: number,
  maxSide = PDF_OMR_RENDER_MAX_SIDE
): Promise<{ jpeg: Buffer; width: number; height: number; numPages: number }> {
  const pdf = await loadPdfDocument(buffer);
  const numPages = pdf.numPages;
  if (pageNumber < 1 || pageNumber > numPages) {
    pdf.destroy?.();
    throw new Error('Página fuera de rango');
  }

  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  let scale = maxSide / Math.max(base.width, base.height, 1);
  let viewport = page.getViewport({ scale });
  while (viewport.width * viewport.height > PDF_OMR_MAX_CANVAS_PIXELS && scale > 0.35) {
    scale *= 0.85;
    viewport = page.getViewport({ scale });
  }

  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    pdf.destroy?.();
    throw new Error('No se pudo crear el lienzo de renderizado');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;

  const jpeg = canvas.toBuffer('image/jpeg', PDF_OMR_JPEG_QUALITY);
  pdf.destroy?.();

  return { jpeg, width, height, numPages };
}
