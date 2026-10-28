import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { stripPrintedSheetLabels } from '@/lib/handwrittenNameSanitize';

export const maxDuration = 20;

const MAX_IMAGE_CHARS = 450_000;

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
    };
    const image =
      validImage(body.image) || validImage(body.givenImage) || validImage(body.surnamesImage);
    if (!image) {
      return NextResponse.json({ error: 'Se requiere una imagen válida' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'JSON only. readText = only letters you can actually see handwritten. Ignore printed labels (APELLIDOS, NOMBRE, GRUPO). If the handwriting is unclear or missing, return {"readText":""}. Never invent, guess, or reuse a name from these instructions.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe handwritten given names and surnames. {"readText":""}',
            },
            { type: 'image_url', image_url: { url: image, detail: 'low' } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 40,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: { readText?: unknown; givenText?: unknown; surnamesText?: unknown } = {};
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

    return NextResponse.json({ studentId: null, readText, givenText, surnamesText, model: 'gpt-4o-mini' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('calificar/match-name:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
