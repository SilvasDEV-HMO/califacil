import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

export const maxDuration = 60;

type RowMeta = {
  questionId: string;
  globalNumber: number;
  options: string[];
};

/**
 * Lee la zona CaliFacil (burbujas A–E) con visión; devuelve texto de opción por pregunta.
 */
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

    const body = await request.json();
    const examId: string = body.examId;
    const imageBase64: string = body.imageBase64;
    const rows: RowMeta[] = body.rows;
    const omrColumnCount: number = Number(body.omrColumnCount) || 4;
    /** Si se envía, el modelo solo rellena estos números de pregunta (ambigüedad OMR). */
    const focusNumbers: number[] | undefined = Array.isArray(body.focusNumbers)
      ? body.focusNumbers
          .map((n: unknown) => Number(n))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      : undefined;

    if (!examId || typeof examId !== 'string') {
      return NextResponse.json({ error: 'Falta examId' }, { status: 400 });
    }
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return NextResponse.json({ error: 'Falta imageBase64' }, { status: 400 });
    }
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10) {
      return NextResponse.json({ error: 'rows inválido (1–10)' }, { status: 400 });
    }

    const focusSet =
      focusNumbers && focusNumbers.length > 0 ? new Set(focusNumbers.map((n) => Math.round(n))) : null;
    const rowsFiltered = focusSet ? rows.filter((r) => focusSet.has(r.globalNumber)) : rows;
    if (rowsFiltered.length === 0) {
      return NextResponse.json({ error: 'Ninguna fila coincide con focusNumbers' }, { status: 400 });
    }

    const questionIds = Array.from(new Set(rowsFiltered.map((r) => r.questionId).filter(Boolean)));
    if (questionIds.length !== rowsFiltered.length) {
      return NextResponse.json({ error: 'Filas de preguntas duplicadas o inválidas' }, { status: 400 });
    }

    const { data: examRow, error: examErr } = await auth.supabase
      .from('exams')
      .select('id')
      .eq('id', examId)
      .single();

    if (examErr || !examRow) {
      return NextResponse.json({ error: 'Examen no encontrado o sin permiso' }, { status: 404 });
    }

    const { data: qRows, error: qErr } = await auth.supabase
      .from('questions')
      .select('id')
      .eq('exam_id', examId)
      .in('id', questionIds);

    if (qErr || !qRows || qRows.length !== questionIds.length) {
      return NextResponse.json(
        { error: 'Las preguntas no coinciden con el examen' },
        { status: 400 }
      );
    }

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, Math.min(5, Math.max(2, omrColumnCount)));

    const nums = rowsFiltered.map((r) => r.globalNumber).sort((a, b) => a - b);
    const spec = rowsFiltered
      .map((r) => {
        const n = r.options.length;
        const allowed = letters.slice(0, n);
        return `Pregunta ${r.globalNumber}: opciones ${allowed.split('').join(', ')} = [${r.options.map((o) => `"${o.replace(/"/g, "'")}"`).join(', ')}]`;
      })
      .join('\n');

    const numList = nums.join(', ');
    const scopeNote =
      focusSet && focusNumbers && focusNumbers.length > 0
        ? `IMPORTANTE: Solo debes incluir en byNumber las preguntas con número global: ${numList}. No incluyas otras claves.`
        : '';
    const prompt = `Eres un lector experto de hojas de examen tipo OPSCAN/CaliFacil.

La imagen muestra la parte inferior de una hoja impresa: un recuadro CaliFacil con una primera fila de tabla que solo indica las columnas A, B, C… y debajo filas numeradas en la primera columna; cada fila de pregunta tiene burbujas. Usa la cabecera A/B/C… para saber qué columna es cada opción; las preguntas son las filas con número a la izquierda.

TAREA:
- Identifica qué burbuja está rellenada (más oscura/tinta) en cada fila de pregunta.
- Solo UNA respuesta por número. Si ninguna está clara o hay dos marcas, usa null para esa pregunta.
- Responde ÚNICAMENTE con JSON: un objeto "byNumber" cuyas claves son STRINGS con el número de pregunta global (${numList}), y valores la letra elegida ("A","B",…) o null.

Ejemplo de forma (sustituye valores reales): {"byNumber":{"3":"B","4":null}}

${scopeNote}

Preguntas en esta hoja:
${spec}

Letra válida en cada fila: solo las primeras N letras del abecedario según cuántas opciones tenga esa pregunta.`;

    const url = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Respondes solo con JSON válido, sin bloques de código. Claves de byNumber son strings de dígitos.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url, detail: 'high' } },
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: { byNumber?: Record<string, string | null> };
    try {
      parsed = JSON.parse(raw) as { byNumber?: Record<string, string | null> };
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? (JSON.parse(m[0]) as { byNumber?: Record<string, string | null> }) : {};
    }

    const byNumber = parsed.byNumber ?? {};
    const selections: Record<string, string> = {};

    for (const row of rowsFiltered) {
      const key = String(row.globalNumber);
      const letterRaw = byNumber[key];
      const letter =
        typeof letterRaw === 'string' ? letterRaw.trim().toUpperCase().charAt(0) : null;

      if (!letter || letter === 'N' || letter === '?') {
        selections[row.questionId] = '';
        continue;
      }

      const idx = letters.indexOf(letter);
      if (idx < 0 || idx >= row.options.length) {
        selections[row.questionId] = '';
        continue;
      }

      selections[row.questionId] = row.options[idx];
    }

    return NextResponse.json({ selections, model: 'gpt-4o-mini' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('vision-omr:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
