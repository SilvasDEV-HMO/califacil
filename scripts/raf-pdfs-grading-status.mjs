/**
 * Cruza PDFs RAF de una carpeta con respuestas en Supabase.
 *   node --env-file=.env.local scripts/raf-pdfs-grading-status.mjs [carpeta] [lenguaje|matematicas]
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  'C:\\Users\\alfon\\proyectos\\zipgrade-pdf-downloader\\zipgrade_pdfs\\lenguaje\\listo';
const subjectFilter = (process.argv[3] || 'lenguaje').toLowerCase();
const teacherEmail =
  (process.env.RAF_TEACHER_EMAIL?.trim() || 'admin@califacil.com').toLowerCase();
const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceKey) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const CCT_TAIL =
  /^([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])([0-9])([A-Z])(?:(_V)|([VM]))?$/i;

function parseRafPdfFileName(fileName) {
  const base = fileName.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '').trim();
  const upper = base.toUpperCase();
  let subject = null;
  let rest = upper;
  if (rest.startsWith('RAFL')) {
    subject = 'lenguaje';
    rest = rest.slice(4);
  } else if (rest.startsWith('RAFM')) {
    subject = 'matematicas';
    rest = rest.slice(4);
  } else return null;
  const found = rest.match(
    /^(.*?)([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z][0-9][A-Z](?:_V|[VM])?)$/i
  );
  if (!found) return null;
  const m = (found[2] ?? '').match(CCT_TAIL);
  if (!m) return null;
  const vespertino = Boolean(m[4] || (m[5] && m[5].toUpperCase() === 'V'));
  const groupKey = `${m[1].toUpperCase()} · ${m[2]}-${m[3].toUpperCase()}${vespertino ? ' V' : ''}`;
  const subjectLabel = subject === 'lenguaje' ? 'Lenguaje' : 'Matemáticas';
  return {
    subject,
    groupKey,
    examTitle: `${subjectLabel} · ${groupKey}`,
    vespertino,
  };
}

function sharedNames(title) {
  const m = title
    .trim()
    .match(/([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])\s*·\s*(\d-[A-Z])(?:\s+V)?$/i);
  if (!m) return [];
  const base = `${m[1].toUpperCase()} · ${m[2].toUpperCase()}`;
  return [base, `${base} V`];
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

async function fetchAll(table, select, apply) {
  const all = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    q = apply(q);
    const { data, error } = await q;
    if (error) {
      console.error(table, error.message || error);
      throw error;
    }
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

const teacherId = await findTeacherId(teacherEmail);
if (!teacherId) {
  console.error('No existe', teacherEmail);
  process.exit(1);
}

const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'));
console.log('Carpeta:', folder);
console.log('PDFs:', files.length, '| usuario:', teacherEmail);

const exams = await fetchAll('exams', 'id,title,group_id,teacher_id', (q) =>
  q.eq('teacher_id', teacherId)
);
const groups = await fetchAll('groups', 'id,name', (q) =>
  q.eq('teacher_id', teacherId)
);
const groupByName = new Map(groups.map((g) => [g.name, g.id]));
const groupById = new Map(groups.map((g) => [g.id, g]));

const students = [];
for (let i = 0; i < groups.length; i += 80) {
  const ids = groups.slice(i, i + 80).map((g) => g.id);
  students.push(
    ...(await fetchAll('students', 'id,group_id', (q) => q.in('group_id', ids)))
  );
}
const studentsByGroup = new Map();
for (const s of students) {
  if (!studentsByGroup.has(s.group_id)) studentsByGroup.set(s.group_id, []);
  studentsByGroup.get(s.group_id).push(s.id);
}

const examByTitle = new Map();
for (const e of exams) {
  examByTitle.set(e.title.trim().toLowerCase(), e);
}

const lenguajeExamIds = exams
  .filter((e) => e.title.toLowerCase().startsWith('lenguaje'))
  .map((e) => e.id);
const answersByExam = new Map();
for (let i = 0; i < lenguajeExamIds.length; i += 40) {
  const chunk = lenguajeExamIds.slice(i, i + 40);
  const rows = await fetchAll('answers', 'exam_id,student_id', (q) =>
    q.in('exam_id', chunk)
  );
  for (const a of rows) {
    if (!answersByExam.has(a.exam_id)) answersByExam.set(a.exam_id, new Set());
    answersByExam.get(a.exam_id).add(a.student_id);
  }
}

function idsForGroupName(name) {
  const gid = groupByName.get(name);
  if (!gid) return new Set();
  return new Set(studentsByGroup.get(gid) || []);
}

function rosterIdsForExam(exam) {
  const ids = new Set();
  if (exam.group_id) {
    for (const id of studentsByGroup.get(exam.group_id) || []) ids.add(id);
  }
  for (const name of sharedNames(exam.title)) {
    for (const id of idsForGroupName(name)) ids.add(id);
  }
  return ids;
}

const done = [];
const partial = [];
const empty = [];
const noExam = [];
const unparsed = [];
const wrongSubject = [];

for (const file of files.sort((a, b) => a.localeCompare(b, 'es'))) {
  const parsed = parseRafPdfFileName(file);
  if (!parsed) {
    unparsed.push(file);
    continue;
  }
  if (parsed.subject !== subjectFilter) {
    wrongSubject.push(file);
    continue;
  }
  const exam =
    examByTitle.get(parsed.examTitle.toLowerCase()) ||
    exams.find((e) => e.title.toLowerCase().includes(parsed.groupKey.toLowerCase()) && e.title.toLowerCase().startsWith(subjectFilter === 'lenguaje' ? 'lenguaje' : 'matem'));
  if (!exam) {
    noExam.push({ file, title: parsed.examTitle, groupKey: parsed.groupKey });
    continue;
  }
  const roster = rosterIdsForExam(exam);
  const own = idsForGroupName(parsed.groupKey);
  const graded = answersByExam.get(exam.id) || new Set();
  const gradedInRoster = [...roster].filter((id) => graded.has(id)).length;
  const gradedOwn = [...own].filter((id) => graded.has(id)).length;
  const remaining = roster.size - gradedInRoster;
  const remainingOwn = own.size - gradedOwn;
  const row = {
    file,
    title: exam.title,
    roster: own.size,
    graded: gradedOwn,
    remaining: remainingOwn,
    sharedRoster: roster.size,
    sharedRemaining: remaining,
  };
  if (roster.size === 0) {
    empty.push({ ...row, note: 'sin alumnos' });
  } else if (remaining === 0) {
    done.push(row);
  } else if (gradedInRoster === 0) {
    empty.push(row);
  } else {
    partial.push(row);
  }
}

function printBlock(title, rows, extra) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const r of rows) {
    if (typeof r === 'string') console.log(r);
    else if (r.file && r.roster != null) {
      console.log(
        `${r.file}  |  ${r.title}  |  ${r.graded}/${r.roster} calificados` +
          (r.remaining ? `  FALTAN ${r.remaining}` : '') +
          (r.note ? `  (${r.note})` : '')
      );
    } else extra?.(r);
  }
}

printBlock('YA CALIFICADOS (no subas)', done);
printBlock('PARCIALES (sí subir)', partial);
printBlock('SIN CALIFICAR (sí subir)', empty);
printBlock('SIN EXAMEN EN LA APP (revisar)', noExam, (r) =>
  console.log(`${r.file}  →  ${r.title}`)
);
printBlock('NO SE PUDO LEER EL NOMBRE', unparsed);
if (wrongSubject.length) printBlock('OTRA MATERIA', wrongSubject);

const pending = [
  ...partial,
  ...empty.filter((r) => r.note !== 'sin alumnos'),
  ...noExam,
];
const outDir = folder;
writeFileSync(
  path.join(outDir, '_YA_CALIFICADOS.txt'),
  done.map((r) => r.file).join('\n') + (done.length ? '\n' : ''),
  'utf8'
);
writeFileSync(
  path.join(outDir, '_FALTAN_SUBIR.txt'),
  pending.map((r) => r.file).join('\n') + (pending.length ? '\n' : ''),
  'utf8'
);

console.log('\n--- RESUMEN ---');
console.log('PDFs:', files.length);
console.log('Ya calificados:', done.length);
console.log('Parciales:', partial.length);
console.log('Sin calificar:', empty.filter((r) => r.note !== 'sin alumnos').length);
console.log('Sin alumnos en grupo:', empty.filter((r) => r.note === 'sin alumnos').length);
console.log('Sin examen:', noExam.length);
console.log('Nombre ilegible:', unparsed.length);
console.log('A SUBIR:', pending.length);
console.log('Listas escritas: _FALTAN_SUBIR.txt y _YA_CALIFICADOS.txt');
