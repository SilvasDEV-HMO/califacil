import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import {
  PDF_GRADE_MAX_FILE_BYTES,
  PDF_OMR_RENDER_MAX_SIDE,
  countPdfPages,
  extractPdfPageTextFromBuffer,
  renderPdfPageToJpeg,
} from '@/lib/renderPdfPage.server';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo PDF' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Solo se aceptan archivos PDF' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 });
    }
    if (file.size > PDF_GRADE_MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: 'PDF demasiado grande',
          message: `El PDF supera el límite de ${Math.round(PDF_GRADE_MAX_FILE_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const metaOnly = form.get('metaOnly') === '1';

    if (metaOnly) {
      const numPages = await countPdfPages(buffer);
      return NextResponse.json({ numPages });
    }

    const page = Math.max(1, Number(form.get('page')) || 1);

    if (form.get('textOnly') === '1') {
      const { text, numPages } = await extractPdfPageTextFromBuffer(buffer, page);
      return NextResponse.json({ text, numPages, page });
    }
    const maxSide = Math.min(
      2400,
      Math.max(800, Number(form.get('maxSide')) || PDF_OMR_RENDER_MAX_SIDE)
    );

    const { jpeg, width, height, numPages } = await renderPdfPageToJpeg(buffer, page, maxSide);

    return new NextResponse(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Pdf-Num-Pages': String(numPages),
        'X-Pdf-Page': String(page),
        'X-Pdf-Width': String(width),
        'X-Pdf-Height': String(height),
      },
    });
  } catch (error: unknown) {
    console.error('[calificar/render-pdf-page]', error);
    const message = error instanceof Error ? error.message : 'Error al renderizar el PDF';
    return NextResponse.json({ error: 'Error al renderizar el PDF', message }, { status: 500 });
  }
}
