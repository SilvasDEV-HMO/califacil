import path from 'node:path';
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

async function readSepListFromScan(buffer: ArrayBuffer): Promise<StudentImportResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no configurada');
  }
  const { jpeg } = await renderPdfPageToJpeg(buffer, 1, 1400);
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Lees listas escolares mexicanas. Respondes solo JSON con cct, grupo, turno (V, M o N) y alumnos: [{nombre, curp}]. No inventes filas.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extrae la clave CCT de la escuela, el grupo (como 1-A), el turno y cada alumno con nombre completo y CURP.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' },
          },
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
