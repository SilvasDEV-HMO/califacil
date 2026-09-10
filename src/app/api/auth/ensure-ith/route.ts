import { NextResponse } from 'next/server';
import { ensureIthTeacherAccount } from '@/lib/ithTeacherProvision';
import { isCalifacilIthEmail, normalizeAuthEmail } from '@/lib/ithAuth';

export const runtime = 'nodejs';

/**
 * POST /api/auth/ensure-ith
 * Crea o confirma docentes @ith.com sin verificación de correo (service_role).
 */
export async function POST(request: Request) {
  let body: { email?: string; password?: string; fullName?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string; fullName?: string };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const email = normalizeAuthEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName : '';

  if (!isCalifacilIthEmail(email)) {
    return NextResponse.json({ error: 'Solo correos @ith.com' }, { status: 400 });
  }

  const result = await ensureIthTeacherAccount({ email, password, fullName });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, hint: result.hint },
      { status: result.hint ? 503 : 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    userId: result.userId,
    created: result.created,
  });
}
