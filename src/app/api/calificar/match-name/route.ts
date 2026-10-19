import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

export const maxDuration = 30;

const MAX_IMAGE_CHARS = 900_000;
const MAX_STUDENTS = 250;

type RosterStudent = { id: string; name: string };

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
      students?: RosterStudent[];
    };
    const image = (body.image ?? '').trim();
    const students = Array.isArray(body.students)
      ? body.students
          .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
          .map((s) => ({ id: s.id.trim(), name: s.name.trim() }))
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

    const ids = new Set(students.map((s) => s.id));
    const roster = students.map((s) => `${s.id} | ${s.name}`).join('\n');

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Respondes solo JSON válido. Eliges un alumno de la lista o null. No inventes ids.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `La imagen es el recorte Nombre | Apellido manuscrito de una hoja.
Lee lo escrito (aunque la letra sea irregular).
Compara con la lista del grupo (formato: id | NOMBRE EN MAYÚSCULAS, a veces apellidos primero).
Si hay un único alumno que encaje (p. ej. "Miriam Amador" → AMADOR … MIRIAM …), devuelve su id.
Si el nombre no está en la lista, hay empate, o no se lee, studentId = null.
No elijas a alguien solo porque un nombre de pila coincida (Carlos, José).

Lista:
${roster}

JSON: {"studentId":"<id o null>","readText":"<nombre leído>"}`,
            },
            { type: 'image_url', image_url: { url: image, detail: 'low' } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: { studentId?: unknown; readText?: unknown } = {};
    try {
      parsed = JSON.parse(raw) as { studentId?: unknown; readText?: unknown };
    } catch {
      parsed = {};
    }

    const readText = typeof parsed.readText === 'string' ? parsed.readText.trim() : '';
    const sidRaw =
      parsed.studentId == null || parsed.studentId === 'null' ? '' : String(parsed.studentId).trim();
    const studentId = sidRaw && ids.has(sidRaw) ? sidRaw : null;

    return NextResponse.json({ studentId, readText, model: 'gpt-4o-mini' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('calificar/match-name:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
