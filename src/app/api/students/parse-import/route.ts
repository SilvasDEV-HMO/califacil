import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { parseStudentImportFromPdfBuffer } from '@/lib/studentImportPdf.server';

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
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Solo se aceptan archivos PDF' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: 'El PDF supera el límite de 15 MB' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = await parseStudentImportFromPdfBuffer(buffer);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[parse-import]', error);
    return NextResponse.json(
      { error: 'Error al procesar el PDF', message },
      { status: 500 }
    );
  }
}
