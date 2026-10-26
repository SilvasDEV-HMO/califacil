import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { stripPrintedSheetLabels } from '@/lib/handwrittenNameSanitize';

export const maxDuration = 30;

const MAX_IMAGE_CHARS = 900_000;
const MAX_STUDENTS = 250;

type RosterStudent = { id: string; name: string; control?: string };

function foldToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Apellidos que se repiten: hay que leer más letras para desempate. */
function sharedSurnameHints(students: RosterStudent[]): string {
  const counts = new Map<string, string[]>();
  for (const s of students) {
    const first = foldToken(s.name).split(' ')[0] ?? '';
    if (first.length < 4) continue;
    const list = counts.get(first) ?? [];
    list.push(s.name);
    counts.set(first, list);
  }
  const lines: string[] = [];
  for (const [key, names] of counts) {
    if (names.length < 2) continue;
    lines.push(`- ${key.toUpperCase()}: ${names.join(' | ')}`);
  }
  if (lines.length === 0) return '';
  return `\nSame surname still in this remaining list — copy letters from BOTH boxes:\n${lines.join('\n')}\n`;
}

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
      students?: { id?: string; name?: string; control?: string; control_number?: string }[];
    };
    const givenImage = validImage(body.givenImage);
    const surnamesImage = validImage(body.surnamesImage);
    const image = validImage(body.image);
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

    const hasSplit = Boolean(givenImage || surnamesImage);
    if (!hasSplit && !image) {
      return NextResponse.json({ error: 'Se requiere una imagen válida' }, { status: 400 });
    }
    if (students.length === 0) {
      return NextResponse.json({ error: 'Falta la lista del grupo' }, { status: 400 });
    }

    const roster = students.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const collisions = sharedSurnameHints(students);

    const openai = new OpenAI({ apiKey });
    const dual = Boolean(givenImage && surnamesImage);
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: dual
          ? `Mexican school form. Image 1 = GIVEN NAME box. Image 2 = SURNAMES box.
Roster order is SURNAMES then GIVEN NAMES. Remaining students only:
Ignore printed labels: NOMBRE, NOMBRES, APELLIDO, APELLIDOS, GRUPO, TURNO, ESCUELA.
Copy consecutive handwritten letters even if they are not a full word (Igcio, anguame, hermo, sele, ose). If you can read a full word, include it.
Do not invent letters. givenText + surnamesText must both be filled when letters are visible.
n = roster number only if letter runs uniquely match ONE line; else n=null.
${collisions}

${roster}

{"n":null,"givenText":"","surnamesText":"","readText":""}`
          : `Mexican school form. Left = given name(s), right = surname(s). Roster is SURNAMES then GIVEN NAMES.
Remaining students only. Ignore printed labels.
Copy consecutive handwritten letters even if incomplete; include full words when readable.
n only if uniquely one roster line.
${collisions}

${roster}

{"n":null,"readText":""}`,
      },
    ];
    if (dual) {
      content.push(
        { type: 'text', text: 'Image 1 — given names:' },
        { type: 'image_url', image_url: { url: givenImage, detail: 'high' } },
        { type: 'text', text: 'Image 2 — surnames:' },
        { type: 'image_url', image_url: { url: surnamesImage, detail: 'high' } }
      );
    } else if (givenImage) {
      content.push(
        { type: 'text', text: 'Given-name box:' },
        { type: 'image_url', image_url: { url: givenImage, detail: 'high' } }
      );
    } else if (surnamesImage) {
      content.push(
        { type: 'text', text: 'Surnames box:' },
        { type: 'image_url', image_url: { url: surnamesImage, detail: 'high' } }
      );
    } else {
      content.push({ type: 'image_url', image_url: { url: image, detail: 'high' } });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'JSON only. Copy handwritten letter runs from each box. Full words when sure, otherwise consecutive letters. Never copy printed labels.',
        },
        { role: 'user', content },
      ],
      temperature: 0,
      max_tokens: 180,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: {
      n?: unknown;
      studentId?: unknown;
      readText?: unknown;
      givenText?: unknown;
      surnamesText?: unknown;
    } = {};
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
    const combined = [givenText, surnamesText].filter(Boolean).join(' ');
    const readText = stripPrintedSheetLabels(
      combined || (typeof parsed.readText === 'string' ? parsed.readText : '')
    );
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

    return NextResponse.json({ studentId, readText, givenText, surnamesText, model: 'gpt-4o-mini' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('calificar/match-name:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
