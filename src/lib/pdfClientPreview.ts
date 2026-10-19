import { dashboardAuthHeadersOnly } from '@/lib/supabaseRouteAuth';

export type ExamCroppedImage = {
  id: string;
  label: string;
  dataUrl: string;
  pageNumber: number;
};

export type PdfPreviewPage = {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
};

type PdfJsModule = {
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
};

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy?: () => void;
};

type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  getTextContent?: () => Promise<{
    items?: Array<{ str?: string; transform?: number[] }>;
  }>;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    canvas: HTMLCanvasElement;
  }) => { promise: Promise<void> };
};

type PdfJsWindow = Window & {
  __califacilPdfJs?: PdfJsModule;
  __califacilPdfJsPromise?: Promise<PdfJsModule>;
};

const PDFJS_READY_EVENT = 'califacil-pdfjs-ready';

async function getPdfJs(): Promise<PdfJsModule> {
  if (typeof window === 'undefined') {
    throw new Error('La vista previa del PDF solo está disponible en el navegador');
  }

  const w = window as PdfJsWindow;
  if (w.__califacilPdfJs) return w.__califacilPdfJs;
  if (w.__califacilPdfJsPromise) return w.__califacilPdfJsPromise;

  w.__califacilPdfJsPromise = new Promise<PdfJsModule>((resolve, reject) => {
    const origin = window.location.origin;
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import * as pdfjs from '${origin}/pdfjs/pdf.min.mjs';
      pdfjs.GlobalWorkerOptions.workerSrc = '${origin}/pdfjs/pdf.worker.min.mjs';
      window.__califacilPdfJs = pdfjs;
      window.dispatchEvent(new Event('${PDFJS_READY_EVENT}'));
    `;

    const cleanup = () => {
      window.removeEventListener(PDFJS_READY_EVENT, onReady);
      script.remove();
    };

    const onReady = () => {
      cleanup();
      if (w.__califacilPdfJs) resolve(w.__califacilPdfJs);
      else reject(new Error('No se pudo cargar el visor de PDF'));
    };

    script.onerror = () => {
      cleanup();
      w.__califacilPdfJsPromise = undefined;
      reject(new Error('No se pudo cargar el visor de PDF. Recarga la página e inténtalo de nuevo.'));
    };

    window.addEventListener(PDFJS_READY_EVENT, onReady);
    document.head.appendChild(script);
  });

  return w.__califacilPdfJsPromise;
}

/** Resolución máxima del lado largo al rasterizar PDF para OMR (equilibrio velocidad/precisión). */
export const PDF_OMR_RENDER_MAX_SIDE = 1600;

export const PDF_GRADE_MAX_FILE_BYTES = 25 * 1024 * 1024;

const pdfDocByFile = new WeakMap<File, Promise<PdfDocument>>();

function getClientPdfDocument(file: File): Promise<PdfDocument> {
  let pending = pdfDocByFile.get(file);
  if (!pending) {
    pending = (async () => {
      const pdfjs = await getPdfJs();
      const bytes = await file.arrayBuffer();
      return pdfjs.getDocument({ data: bytes.slice(0) }).promise;
    })();
    pdfDocByFile.set(file, pending);
  }
  return pending;
}

async function countPdfPagesInBrowser(file: File): Promise<number> {
  const pdf = await getClientPdfDocument(file);
  return Math.max(0, Number(pdf.numPages ?? 0));
}

async function extractPdfPageTextInBrowser(
  file: File,
  pageNumber: number
): Promise<{ text: string; numPages: number }> {
  const pdf = await getClientPdfDocument(file);
  const numPages = Math.max(0, Number(pdf.numPages ?? 0));
  if (pageNumber < 1 || pageNumber > numPages) {
    return { text: '', numPages };
  }
  const page = await pdf.getPage(pageNumber);
  if (typeof page.getTextContent !== 'function') {
    return { text: '', numPages };
  }
  const content = await page.getTextContent();
  const placed: { str: string; x: number; y: number }[] = [];
  for (const item of content.items ?? []) {
    const str = typeof item?.str === 'string' ? item.str : '';
    if (!str) continue;
    const t = item.transform ?? [];
    placed.push({
      str,
      x: Number(t[4] ?? 0),
      y: Number(t[5] ?? 0),
    });
  }
  placed.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 2.5) return dy;
    return a.x - b.x;
  });
  const lines: string[] = [];
  let current: string[] = [];
  let lastY: number | null = null;
  for (const item of placed) {
    if (lastY != null && Math.abs(lastY - item.y) > 3) {
      lines.push(current.join(' '));
      current = [];
    }
    current.push(item.str);
    lastY = item.y;
  }
  if (current.length) lines.push(current.join(' '));
  return { text: lines.join('\n'), numPages };
}

async function renderPdfPageCanvasInBrowser(
  file: File,
  pageNumber: number,
  maxSide = PDF_OMR_RENDER_MAX_SIDE
): Promise<{ canvas: HTMLCanvasElement; numPages: number }> {
  const pdf = await getClientPdfDocument(file);
  const numPages = Math.max(0, Number(pdf.numPages ?? 0));
  if (pageNumber < 1 || pageNumber > numPages) {
    throw new Error('Esa página no existe en el PDF');
  }
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const longSide = Math.max(base.width, base.height);
  const scale = longSide > 0 ? Math.min(maxSide / longSide, 2.4) : 1;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No se pudo crear el lienzo de la página');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return { canvas, numPages };
}

function yieldToBrowser(): Promise<void> {
  // No usar rAF: en pestaña oculta se congela / ralenta todo el lote.
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => resolve();
      port2.postMessage(null);
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

/** Solo cuenta páginas (sin rasterizar) — mucho más rápido al preparar el lote. */
export async function countPdfGradingPages(
  file: File,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<number> {
  if (typeof window === 'undefined') {
    throw new Error('El conteo de PDF solo está disponible en el navegador');
  }
  if (file.size > PDF_GRADE_MAX_FILE_BYTES) {
    throw new Error(
      `El PDF supera el límite de ${Math.round(PDF_GRADE_MAX_FILE_BYTES / (1024 * 1024))} MB.`
    );
  }
  try {
    return await countPdfPagesInBrowser(file);
  } catch {
    /* servidor si pdf.js no carga */
  }
  const timeoutMs = opts?.timeoutMs ?? 20000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener('abort', onAbort);
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('metaOnly', '1');
    const authHeaders = await dashboardAuthHeadersOnly();
    const res = await fetch('/api/calificar/render-pdf-page', {
      method: 'POST',
      headers: authHeaders,
      credentials: 'include',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Sesión expirada. Inicia sesión de nuevo.');
      const err = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      throw new Error(err?.message ?? err?.error ?? 'No se pudo leer el PDF');
    }
    const data = (await res.json()) as { numPages?: number };
    return Math.max(0, Number(data.numPages ?? 0));
  } finally {
    window.clearTimeout(timeoutId);
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}

async function jpegBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No se pudo crear el lienzo de vista previa');
      ctx.drawImage(bmp, 0, 0);
      return canvas;
    } finally {
      bmp.close();
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No se pudo decodificar la página del PDF'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No se pudo crear el lienzo de vista previa');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  filename: string,
  quality = 0.85
): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No se pudo exportar la imagen'))),
      'image/jpeg',
      quality
    );
  });
  return new File([blob], filename, { type: 'image/jpeg' });
}

/** Texto de una página PDF (servidor / pdf.js) para Paper Details ZipGrade. */
export async function extractPdfPagePlainText(
  file: File,
  pageNumber: number,
  opts?: { signal?: AbortSignal; timeoutMs?: number; preferServer?: boolean }
): Promise<{ text: string; numPages: number }> {
  if (typeof window === 'undefined') {
    throw new Error('La extracción de texto PDF solo está disponible en el navegador');
  }
  if (file.size > PDF_GRADE_MAX_FILE_BYTES) {
    throw new Error(
      `El PDF supera el límite de ${Math.round(PDF_GRADE_MAX_FILE_BYTES / (1024 * 1024))} MB.`
    );
  }
  if (!opts?.preferServer) {
    try {
      const local = await extractPdfPageTextInBrowser(file, pageNumber);
      if (local.text.trim().length > 0) return local;
    } catch {
      /* servidor */
    }
  }
  const timeoutMs = opts?.timeoutMs ?? 25000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener('abort', onAbort);
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('page', String(pageNumber));
    form.append('textOnly', '1');
    const authHeaders = await dashboardAuthHeadersOnly();
    const res = await fetch('/api/calificar/render-pdf-page', {
      method: 'POST',
      headers: authHeaders,
      credentials: 'include',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Sesión expirada. Inicia sesión de nuevo.');
      const err = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      throw new Error(err?.message ?? err?.error ?? 'No se pudo leer el texto del PDF');
    }
    const data = (await res.json()) as { text?: string; numPages?: number };
    return {
      text: data.text ?? '',
      numPages: Number(data.numPages ?? 0),
    };
  } finally {
    window.clearTimeout(timeoutId);
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchPdfPageCanvas(
  file: File,
  pageNumber: number,
  maxSide = PDF_OMR_RENDER_MAX_SIDE,
  signal?: AbortSignal
): Promise<{ canvas: HTMLCanvasElement; numPages: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('page', String(pageNumber));
  form.append('maxSide', String(maxSide));

  const authHeaders = await dashboardAuthHeadersOnly();
  const res = await fetch('/api/calificar/render-pdf-page', {
    method: 'POST',
    headers: authHeaders,
    credentials: 'include',
    body: form,
    signal,
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Sesión expirada. Inicia sesión de nuevo.');
    }
    const err = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(err?.message ?? err?.error ?? 'No se pudo renderizar el PDF en el servidor');
  }

  const numPages = Number(res.headers.get('X-Pdf-Num-Pages') ?? '0');
  const blob = await res.blob();
  const canvas = await jpegBlobToCanvas(blob);
  return { canvas, numPages };
}

export type PdfGradingHandle = {
  numPages: number;
  renderPageAsCanvas: (
    pageNumber: number,
    opts?: { maxSide?: number; signal?: AbortSignal }
  ) => Promise<HTMLCanvasElement | null>;
  dispose: () => void;
};

export function createPdfGradingHandle(file: File, numPages: number): PdfGradingHandle {
  return {
    numPages,
    async renderPageAsCanvas(pageNumber, opts) {
      if (pageNumber < 1 || pageNumber > numPages) return null;
      const { canvas } = await renderPdfGradingPageCanvas(file, pageNumber, opts?.maxSide, {
        signal: opts?.signal,
      });
      return canvas;
    },
    dispose() {},
  };
}

/** Renderiza una página del PDF en el servidor (también devuelve el total de páginas). */
export async function renderPdfGradingPageCanvas(
  file: File,
  pageNumber: number,
  maxSide = PDF_OMR_RENDER_MAX_SIDE,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<{ canvas: HTMLCanvasElement; numPages: number }> {
  if (typeof window === 'undefined') {
    throw new Error('La calificación con PDF solo está disponible en el navegador');
  }
  if (file.size > PDF_GRADE_MAX_FILE_BYTES) {
    throw new Error(
      `El PDF supera el límite de ${Math.round(PDF_GRADE_MAX_FILE_BYTES / (1024 * 1024))} MB.`
    );
  }
  await yieldToBrowser();
  try {
    if (!opts?.signal?.aborted) {
      return await renderPdfPageCanvasInBrowser(file, pageNumber, maxSide);
    }
  } catch {
    /* servidor */
  }
  const timeoutMs = opts?.timeoutMs ?? 25000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener('abort', onAbort);
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchPdfPageCanvas(file, pageNumber, maxSide, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('La lectura del PDF tardó demasiado. Prueba un archivo más liviano.');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}

/** Abre un PDF y rasteriza páginas bajo demanda vía API (no bloquea el navegador). */
export async function openPdfForGrading(file: File): Promise<PdfGradingHandle> {
  const { numPages } = await renderPdfGradingPageCanvas(file, 1);
  if (numPages <= 0) {
    throw new Error('El PDF no tiene páginas legibles');
  }
  return createPdfGradingHandle(file, numPages);
}

export async function renderPdfPreviewPages(
  file: File,
  scale = 1.4,
  opts?: { pageNumbers?: number[] }
): Promise<PdfPreviewPage[]> {
  const pdfjs = await getPdfJs();
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const pages: PdfPreviewPage[] = [];
  const pageNumbers =
    opts?.pageNumbers ??
    Array.from({ length: pdf.numPages }, (_, i) => i + 1);

  for (const pageNumber of pageNumbers) {
    if (pageNumber < 1 || pageNumber > pdf.numPages) continue;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    pages.push({
      pageNumber,
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      width: canvas.width,
      height: canvas.height,
    });
  }

  pdf.destroy?.();
  return pages;
}

/** @deprecated Preferir openPdfForGrading para calificar (render bajo demanda). */
export async function renderPdfPagesAsImages(file: File, scale = 2): Promise<HTMLImageElement[]> {
  const pages = await renderPdfPreviewPages(file, scale);
  return Promise.all(pages.map((page) => loadImage(page.dataUrl)));
}

export type CropRect = { x: number; y: number; width: number; height: number };

export async function cropPreviewPageAsync(
  page: PdfPreviewPage,
  rect: CropRect,
  displayWidth: number
): Promise<string | null> {
  if (rect.width < 8 || rect.height < 8) return null;
  const scale = page.width / displayWidth;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(page.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(page.height - sy, Math.round(rect.height * scale));
  if (sw < 8 || sh < 8) return null;

  const img = await loadImage(page.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function findCroppedImageId(
  images: ExamCroppedImage[],
  dataUrl: string | undefined
): string | null {
  if (!dataUrl) return null;
  return images.find((img) => img.dataUrl === dataUrl)?.id ?? null;
}
