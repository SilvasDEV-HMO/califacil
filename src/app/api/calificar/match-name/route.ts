import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { stripPrintedSheetLabels } from '@/lib/handwrittenNameSanitize';

export const maxDuration = 20;

const MAX_IMAGE_CHARS = 900_000;

function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/');
}

function validImage(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return isDataImageUrl(s) && s.length <= MAX_IMAGE_CHARS ? s : '';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY no configurada', code: 'NO_KEY' },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      image?: string;
      givenImage?: string;
      surnamesImage?: string;
      candidates?: { id?: string; name?: string }[];
    };
    const image =
      validImage(body.image) || validImage(body.givenImage) || validImage(body.surnamesImage);
    if (!image) {
      return NextResponse.json({ error: 'Se requiere una imagen válida' }, { status: 400 });
    }

    const candidates = (Array.isArray(body.candidates) ? body.candidates : [])
      .map((row) => ({
        id: typeof row?.id === 'string' ? row.id.trim() : '',
        name: typeof row?.name === 'string' ? row.name.trim() : '',
      }))
      .filter((row) => row.id && row.name)
      .slice(0, 120);
    const roster =
      candidates.length > 0
        ? candidates.map((row) => `${row.id} | ${row.name}`).join('\n')
        : '';

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'JSON only: {"readText":"","studentId":null}. The photo is the name header of a Mexican exam (given name and surnames, often uppercase handwriting). Transcribe every handwritten letter you can see. Omit printed labels NOMBRE, APELLIDOS, APELLIDO, GRUPO. Do not invent letters that are not in the image. If a roster is provided, set studentId to that id only when the handwriting clearly matches that full name (at least the surname and one given name, allowing small OCR slips). Otherwise studentId must be null.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: roster
                ? `Roster (id | name):\n${roster}\nTranscribe the handwriting and pick studentId only on a clear match.`
                : 'Transcribe the handwritten given names and surnames.',
            },
            { type: 'image_url', image_url: { url: image, detail: 'high' } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 120,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: { readText?: unknown; givenText?: unknown; surnamesText?: unknown; studentId?: unknown } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = {};
    }

    const givenText = stripPrintedSheetLabels(
      typeof parsed.givenText === 'string' ? parsed.givenText : ''
    );
    const surnamesText = stripPrintedSheetLabels(
      typeof parsed.surnamesText === 'string' ? parsed.surnamesText : ''
    );
    const readText = stripPrintedSheetLabels(
      [givenText, surnamesText].filter(Boolean).join(' ') ||
        (typeof parsed.readText === 'string' ? parsed.readText : '')
    );

    const rawId = typeof parsed.studentId === 'string' ? parsed.studentId.trim() : '';
    const studentId = candidates.some((row) => row.id === rawId) ? rawId : null;

    return NextResponse.json({ studentId, readText, givenText, surnamesText, model: 'gpt-4o-mini' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('calificar/match-name:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
