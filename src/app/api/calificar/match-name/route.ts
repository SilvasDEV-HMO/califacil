import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

export const maxDuration = 30;

const MAX_IMAGE_CHARS = 900_000;
const MAX_STUDENTS = 250;

type RosterStudent = { id: string; name: string; control?: string };

function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/');
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
      students?: { id?: string; name?: string; control?: string; control_number?: string }[];
    };
    const image = (body.image ?? '').trim();
    const students: RosterStudent[] = Array.isArray(body.students)
      ? body.students
          .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
          .map((s) => ({
            id: s.id!.trim(),
            name: s.name!.trim(),
            control: String(s.control ?? s.control_number ?? '').trim(),
          }))
          .filter((s) => s.id && s.name)
          .slice(0, MAX_STUDENTS)
      : [];

    if (!isDataImageUrl(image)) {
      return NextResponse.json({ error: 'Se requiere una imagen válida' }, { status: 400 });
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return NextResponse.json({ error: 'Imagen demasiado grande' }, { status: 413 });
    }
    if (students.length === 0) {
      return NextResponse.json({ error: 'Falta la lista del grupo' }, { status: 400 });
    }

    const roster = students.map((s, i) => `${i + 1}. ${s.name}`).join('\n');

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'JSON only: n = roster number or null; readText = handwritten name.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Left box = given name(s), right box = surname(s). Roster is SURNAMES then GIVEN NAMES.
Pick n if uniquely matches. Else n=null. Always set readText.

${roster}

{"n":null,"readText":""}`,
            },
            { type: 'image_url', image_url: { url: image, detail: 'low' } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 80,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: { n?: unknown; studentId?: unknown; readText?: unknown } = {};
    try {
      parsed = JSON.parse(raw) as { n?: unknown; studentId?: unknown; readText?: unknown };
    } catch {
      parsed = {};
    }

    const readText = typeof parsed.readText === 'string' ? parsed.readText.trim() : '';
    let studentId: string | null = null;
    const n = Number(parsed.n);
    if (Number.isInteger(n) && n >= 1 && n <= students.length) {
      studentId = students[n - 1]!.id;
    } else {
      const sidRaw =
        parsed.studentId == null || parsed.studentId === 'null' ? '' : String(parsed.studentId).trim();
      const ids = new Set(students.map((s) => s.id));
      if (sidRaw && ids.has(sidRaw)) studentId = sidRaw;
    }

    return NextResponse.json({ studentId, readText, model: 'gpt-4o-mini' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('calificar/match-name:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
