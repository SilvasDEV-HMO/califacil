import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
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

const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const teacherEmail =
  (process.env.RAF_TEACHER_EMAIL?.trim() || 'admin@califacil.com').toLowerCase();

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
    if (error) throw new Error(`${table}: ${error.message}`);
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

const exams = (
  await fetchAll('exams', 'id,title,group_id', (q) => q.eq('teacher_id', teacherId))
).filter((e) => e.title.toLowerCase().startsWith('lenguaje'));

const groups = await fetchAll('groups', 'id,name', (q) =>
  q.eq('teacher_id', teacherId)
);
const groupName = new Map(groups.map((g) => [g.id, g.name]));

const hasAnswers = new Set();
const BATCH = 25;
for (let i = 0; i < exams.length; i += BATCH) {
  const chunk = exams.slice(i, i + BATCH);
  const results = await Promise.all(
    chunk.map((exam) =>
      supabase
        .from('answers')
        .select('student_id')
        .eq('exam_id', exam.id)
        .limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return data?.length ? exam.id : null;
        })
    )
  );
  for (const id of results) if (id) hasAnswers.add(id);
  console.error(`revisados ${Math.min(i + BATCH, exams.length)}/${exams.length}`);
}

const emptyExams = exams.filter((e) => !hasAnswers.has(e.id));
const emptyGroupIds = [...new Set(emptyExams.map((e) => e.group_id).filter(Boolean))];
const studentCount = new Map();
for (let i = 0; i < emptyGroupIds.length; i += BATCH) {
  const ids = emptyGroupIds.slice(i, i + BATCH);
  const results = await Promise.all(
    ids.map((gid) =>
      supabase
        .from('students')
        .select('id')
        .eq('group_id', gid)
        .limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return [gid, data?.length || 0];
        })
    )
  );
  for (const [gid, n] of results) studentCount.set(gid, n);
}

const empty = exams
  .filter((e) => !hasAnswers.has(e.id))
  .map((e) => ({
    title: e.title,
    group: groupName.get(e.group_id) || e.title.replace(/^Lenguaje\s*·\s*/i, ''),
    students: studentCount.get(e.group_id) || 0, // 0 o 1 (¿hay lista?)
  }))
  .sort((a, b) => a.group.localeCompare(b.group, 'es'));

const withStudents = empty.filter((e) => e.students > 0);
const noStudents = empty.filter((e) => e.students === 0);

console.log(`Lenguaje total: ${exams.length}`);
console.log(`Sin ningún alumno calificado: ${empty.length}`);
console.log(`  con lista: ${withStudents.length}`);
console.log(`  sin alumnos: ${noStudents.length}`);
console.log('\n=== CON ALUMNOS, 0 calificados ===');
for (const e of withStudents) {
  console.log(e.group);
}
console.log('\n=== SIN ALUMNOS Y 0 calificados ===');
for (const e of noStudents) {
  console.log(e.group);
}
