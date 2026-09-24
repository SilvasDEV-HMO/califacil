import path from 'node:path';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import OpenAI from 'openai';
import {
  parseGenericPdfTextFromLines,
  parseItsonAttendanceListText,
  parseSepSchoolList,
  type StudentImportResult,
} from '@/lib/studentImportCore';
import { pdfBufferBytes } from '@/lib/pdfBuffer.server';
import { loadPdfJsServer } from '@/lib/pdfjsServer.server';
import { renderPdfPageToJpeg } from '@/lib/renderPdfPage.server';

/** pdfjs-dist exige URLs con slash final y barras normales (incluso en Windows). */
function pdfjsAssetUrl(...segments: string[]): string {
  const absolute = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', ...segments);
  return `${absolute.replace(/\\/g, '/')}/`;
}

async function extractPdfTextFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const { getDocument } = await loadPdfJsServer();
  const bytes = pdfBufferBytes(buffer);
  const loadingTask = getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
  });
  const pdf = await loadingTask.promise;
  const chunks: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    let currentLine = '';

    for (const item of textContent.items as Array<{ str?: string; hasEOL?: boolean }>) {
      const part = item?.str?.trim();
      if (part) {
        currentLine = `${currentLine} ${part}`.trim();
      }
      if (item?.hasEOL && currentLine) {
        chunks.push(currentLine);
        currentLine = '';
      }
    }
    if (currentLine) chunks.push(currentLine);
  }

  return chunks.join('\n');
}

function longDarkRuns(canvas: Canvas): { horizontal: number; vertical: number; topInk: number; bottomInk: number } {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const darkAt = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
    return lum < 140;
  };
  let horizontal = 0;
  let vertical = 0;
  const step = Math.max(2, Math.round(Math.min(w, h) / 180));
  for (let y = 0; y < h; y += step * 3) {
    let run = 0;
    for (let x = 0; x < w; x += step) {
      if (darkAt(x, y)) run++;
      else {
        if (run > 18) horizontal++;
        run = 0;
      }
    }
  }
  for (let x = 0; x < w; x += step * 3) {
    let run = 0;
    for (let y = 0; y < h; y += step) {
      if (darkAt(x, y)) run++;
      else {
        if (run > 18) vertical++;
        run = 0;
      }
    }
  }
  let topInk = 0;
  let bottomInk = 0;
  const band = Math.round(h * 0.18);
  for (let y = 0; y < band; y += step) {
    for (let x = 0; x < w; x += step) {
      if (darkAt(x, y)) topInk++;
      if (darkAt(x, h - 1 - y)) bottomInk++;
    }
  }
  return { horizontal, vertical, topInk, bottomInk };
}

function rotateCanvas(source: Canvas, degrees: -90 | 90): Canvas {
  const out = createCanvas(source.height, source.width);
  const ctx = out.getContext('2d');
  if (degrees === -90) {
    ctx.translate(0, source.width);
    ctx.rotate(-Math.PI / 2);
  } else {
    ctx.translate(source.height, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(source as unknown as CanvasImageSource, 0, 0);
  return out;
}

function cropCanvas(source: Canvas, x: number, y: number, w: number, h: number): Buffer {
  const out = createCanvas(Math.max(1, w), Math.max(1, h));
  out.getContext('2d').drawImage(source as unknown as CanvasImageSource, x, y, w, h, 0, 0, w, h);
  return out.toBuffer('image/jpeg', 90);
}

/** Endereza la hoja si el escáner la guardó de lado, con el encabezado arriba. */
async function uprightRosterCanvas(buffer: ArrayBuffer): Promise<Canvas> {
  const { jpeg } = await renderPdfPageToJpeg(buffer, 1, 2000);
  const image = await loadImage(jpeg);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image as unknown as CanvasImageSource, 0, 0);
  const asIs = longDarkRuns(canvas);
  if (asIs.horizontal >= asIs.vertical) return canvas;
  const left = rotateCanvas(canvas, -90);
  const right = rotateCanvas(canvas, 90);
  const a = longDarkRuns(left);
  const b = longDarkRuns(right);
  return a.topInk - a.bottomInk >= b.topInk - b.bottomInk ? left : right;
}

async function readSepListFromScan(buffer: ArrayBuffer): Promise<StudentImportResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no configurada');
  }
  const page = await uprightRosterCanvas(buffer);
  const w = page.width;
  const h = page.height;
  const header = cropCanvas(page, 0, 0, w, Math.round(h * 0.22));
  const bodyTop = Math.round(h * 0.15);
  const bodyH = h - bodyTop - Math.round(h * 0.02);
  const mid = bodyTop + Math.round(bodyH / 2);
  const zoom = (x0: number, x1: number, y0: number, y1: number) => {
    const cw = Math.max(1, x1 - x0);
    const ch = Math.max(1, y1 - y0);
    const out = createCanvas(cw * 2, ch * 2);
    out.getContext('2d').drawImage(page as unknown as CanvasImageSource, x0, y0, cw, ch, 0, 0, cw * 2, ch * 2);
    return out.toBuffer('image/jpeg', 95);
  };
  const xCurp0 = Math.round(w * 0.05);
  const xCurp1 = Math.round(w * 0.30);
  const xName0 = Math.round(w * 0.22);
  const xName1 = Math.round(w * 0.52);
  const upperCurp = zoom(xCurp0, xCurp1, bodyTop, mid + Math.round(h * 0.03));
  const lowerCurp = zoom(xCurp0, xCurp1, mid - Math.round(h * 0.02), bodyTop + bodyH);
  const upperName = zoom(xName0, xName1, bodyTop, mid + Math.round(h * 0.03));
  const lowerName = zoom(xName0, xName1, mid - Math.round(h * 0.02), bodyTop + bodyH);

  const openai = new OpenAI({ apiKey });
  const imagePart = (jpeg: Buffer) => ({
    type: 'image_url' as const,
    image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' as const },
  });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    max_tokens: 5000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Transcribes a Sonora attendance list. JSON only: {cct, grupo, turno, alumnos:[{nombre, curp}]}. cct like 26DST0060E. grupo like 1-A. turno is V, M or N. CURP is exactly 18 characters in the CURP column. nombre is the full name in the name column, with spaces instead of slashes. Copy every printed row. Do not invent rows or characters.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Image 1 is the header. Images 2 and 3 are the CURP column, top then bottom. Images 4 and 5 are the names in the same row order. Pair row by row. Every CURP has 18 characters; do not drop the last letter or digit.',
          },
          imagePart(header),
          imagePart(upperCurp),
          imagePart(lowerCurp),
          imagePart(upperName),
          imagePart(lowerName),
        ],
      },
    ],
  });
  const raw = completion.choices[0]?.message?.content?.trim() || '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('No se pudo leer la lista de la escuela');
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { alumnos?: unknown }).alumnos)) {
    const body = parsed as { alumnos: { nombre?: unknown; curp?: unknown }[] };
    const curpRe = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
    body.alumnos = body.alumnos.map((row) => {
      let nombre = String(row?.nombre ?? '').replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim();
      let curp = String(row?.curp ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const nameAsCurp = nombre.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (curpRe.test(nameAsCurp) && !curpRe.test(curp)) {
        const swapped = nombre;
        nombre = curp;
        curp = swapped.toUpperCase().replace(/[^A-Z0-9]/g, '');
      }
      return { nombre, curp };
    });
  }
  const list = parseSepSchoolList(parsed);
  if (!list) {
    throw new Error('No se encontró CCT, grupo, turno o alumnos con CURP en el PDF');
  }
  return list;
}

export async function parseStudentImportFromPdfBuffer(buffer: ArrayBuffer): Promise<StudentImportResult> {
  const text = (await extractPdfTextFromBuffer(buffer)).trim();
  if (!text) return readSepListFromScan(buffer);

  const itson = parseItsonAttendanceListText(text);
  if (itson) return itson;

  const lines = text.split(/\r?\n/);
  return parseGenericPdfTextFromLines(lines);
}
