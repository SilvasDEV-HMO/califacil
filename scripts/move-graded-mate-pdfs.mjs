/**
 * Mueve a "ya estan" los PDF cuyo examen de Matemáticas ya tiene ≥1 respuesta.
 * Deja en la carpeta raíz los que están en 0.
 *
 *   node --env-file=.env.local scripts/move-graded-mate-pdfs.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

function loadEnvLocal() {
  const p = path.join(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal();

const folder =
  process.argv[2] ||
  'C:\\Users\\alfon\\proyectos\\zipgrade-pdf-downloader\\zipgrade_pdfs\\matemáticas';
const dest = path.join(folder, 'ya estan');
mkdirSync(dest, { recursive: true });

const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const teacherEmail =
  (process.env.RAF_TEACHER_EMAIL?.trim() || 'admin@califacil.com').toLowerCase();
const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CCT_TAIL =
  /^([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])([0-9])([A-Z])(?:(_V)|([VM]))?$/i;

function norm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseRafPdfFileName(fileName) {
  const base = fileName.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '').trim();
  const upper = base.toUpperCase();
  if (!upper.startsWith('RAFM')) return null;
  const rest = upper.slice(4);
  const found = rest.match(
    /^(.*?)([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z][0-9][A-Z](?:_V|[VM])?)$/i
  );
  if (!found) return null;
  const m = (found[2] ?? '').match(CCT_TAIL);
  if (!m) return null;
  const vespertino = Boolean(m[4] || (m[5] && m[5].toUpperCase() === 'V'));
  const groupKey = `${m[1].toUpperCase()} · ${m[2]}-${m[3].toUpperCase()}${vespertino ? ' V' : ''}`;
  return { examTitle: `Matemáticas · ${groupKey}`, groupKey };
}

async function findTeacherId(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = (data.users || []).find(
      (u) => (u.email || '').trim().toLowerCase() === email
    );
    if (hit) return hit.id;
    if (!data.users?.length || data.users.length < 200) break;
    page += 1;
  }
  return null;
}

const teacherId = await findTeacherId(teacherEmail);
const exams = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('exams')
    .select('id,title')
    .eq('teacher_id', teacherId)
    .range(from, from + 999);
  if (error) throw error;
  exams.push(...(data || []));
  if (!data || data.length < 1000) break;
}
const examByTitle = new Map();
for (const e of exams) examByTitle.set(norm(e.title), e);

function findExam(parsed) {
  return (
    examByTitle.get(norm(parsed.examTitle)) ||
    exams.find(
      (e) =>
        norm(e.title).startsWith('matematicas') &&
        norm(e.title).includes(norm(parsed.groupKey))
    ) ||
    null
  );
}

const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'));
const move = [];
const keep = [];
const unknown = [];
const pendingChecks = [];

for (const file of files) {
  const parsed = parseRafPdfFileName(file);
  if (!parsed) {
    unknown.push(file);
    keep.push(file);
    continue;
  }
  const exam = findExam(parsed);
  if (!exam) {
    unknown.push(file);
    keep.push(file);
    continue;
  }
  pendingChecks.push({ file, examId: exam.id });
}

const BATCH = 20;
for (let i = 0; i < pendingChecks.length; i += BATCH) {
  const chunk = pendingChecks.slice(i, i + BATCH);
  const results = await Promise.all(
    chunk.map(({ file, examId }) =>
      supabase
        .from('answers')
        .select('student_id')
        .eq('exam_id', examId)
        .limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return { file, has: Boolean(data?.length) };
        })
    )
  );
  for (const r of results) {
    if (r.has) move.push(r.file);
    else keep.push(r.file);
  }
}

let moved = 0;
for (const file of move) {
  renameSync(path.join(folder, file), path.join(dest, file));
  moved += 1;
}

console.log(`Carpeta: ${folder}`);
console.log(`PDFs en raíz: ${files.length}`);
console.log(`Movidos a "ya estan": ${moved}`);
console.log(`Quedan sin calificar: ${keep.length}`);
for (const f of keep.sort((a, b) => a.localeCompare(b, 'es'))) {
  console.log('  ' + f);
}
if (unknown.length) {
  console.log('Sin match de examen (se dejaron):', unknown.length);
  for (const f of unknown) console.log('  ? ' + f);
}
