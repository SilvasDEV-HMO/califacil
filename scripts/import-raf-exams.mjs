/**
 * Crea 1 examen Lenguaje (30) + 1 Matemáticas (20) por cada grupo
 * de admin@califacil.com, asignado solo a ese grupo.
 *
 *   node --env-file=.env.local scripts/import-raf-exams.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const teacherEmail =
  (process.env.RAF_TEACHER_EMAIL?.trim() || 'admin@califacil.com').toLowerCase();

/** Clave Lenguaje = Prueba de despegue (30). */
const LENGUAJE_KEY = [
  'A', 'C', 'C', 'A', 'B', 'A', 'B', 'A', 'A', 'C',
  'C', 'C', 'A', 'C', 'C', 'B', 'A', 'B', 'C', 'A',
  'A', 'C', 'A', 'A', 'C', 'B', 'C', 'B', 'B', 'A',
];

/** Clave Matemáticas diagnóstico (20). */
const MATE_KEY = [
  'A', 'C', 'B', 'D', 'D', 'C', 'B', 'A', 'D', 'C',
  'C', 'B', 'B', 'B', 'B', 'C', 'C', 'A', 'D', 'C',
];

const EXAM_BATCH = 80;
const Q_BATCH = 400;
const ASG_BATCH = 400;

if (!url || !serviceKey || serviceKey.startsWith('sb_publishable_')) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY válida (service_role).');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function titleFor(kind, groupName) {
  return kind === 'lenguaje'
    ? `Lenguaje · ${groupName}`
    : `Matemáticas · ${groupName}`;
}

function questionRows(examId, key, options) {
  return key.map((letter, index) => ({
    exam_id: examId,
    text: `Reactivo ${index + 1}`,
    type: 'multiple_choice',
    options,
    correct_answer: letter,
    points: 1,
    sort_order: index,
  }));
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
    if (page > 50) break;
  }
  return null;
}

async function fetchAllGroups(teacherId) {
  const all = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('groups')
      .select('id,name')
      .eq('teacher_id', teacherId)
      .order('name')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchExistingTitles(teacherId) {
  const titles = new Set();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('exams')
      .select('title')
      .eq('teacher_id', teacherId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data || []) titles.add(row.title);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return titles;
}

async function insertQuestions(rows) {
  let { error } = await supabase.from('questions').insert(rows);
  if (error && /sort_order/i.test(error.message)) {
    const stripped = rows.map(({ sort_order: _s, ...r }) => r);
    error = (await supabase.from('questions').insert(stripped)).error;
  }
  if (error && /points/i.test(error.message)) {
    const stripped = rows.map(({ sort_order: _s, points: _p, ...r }) => r);
    error = (await supabase.from('questions').insert(stripped)).error;
  }
  if (error) throw new Error(error.message);
}

const teacherId = await findTeacherId(teacherEmail);
if (!teacherId) {
  console.error('No existe', teacherEmail);
  process.exit(1);
}
console.log('teacher_id', teacherId);

const groups = await fetchAllGroups(teacherId);
console.log('Grupos:', groups.length);
const existing = await fetchExistingTitles(teacherId);
console.log('Exámenes ya existentes:', existing.size);

const planned = [];
for (const g of groups) {
  for (const kind of ['lenguaje', 'matematicas']) {
    const title = titleFor(kind, g.name);
    if (existing.has(title)) continue;
    planned.push({ groupId: g.id, groupName: g.name, kind, title });
  }
}
console.log('Exámenes por crear:', planned.length);

let created = 0;
for (let i = 0; i < planned.length; i += EXAM_BATCH) {
  const chunk = planned.slice(i, i + EXAM_BATCH);
  const examInserts = chunk.map((p) => ({
    teacher_id: teacherId,
    group_id: p.groupId,
    title: p.title,
    description:
      p.kind === 'lenguaje'
        ? 'Diagnóstico Lenguaje (clave despegue). Solo este grupo.'
        : 'Diagnóstico Matemáticas. Solo este grupo.',
    status: 'published',
    qr_code: null,
  }));

  const { data: exams, error: examErr } = await supabase
    .from('exams')
    .insert(examInserts)
    .select('id,title,group_id');
  if (examErr) {
    console.error('Error exámenes:', examErr.message);
    process.exit(1);
  }

  const byTitle = new Map((exams || []).map((e) => [e.title, e]));
  const allQuestions = [];
  const allAssignments = [];

  for (const p of chunk) {
    const exam = byTitle.get(p.title);
    if (!exam) continue;
    if (p.kind === 'lenguaje') {
      allQuestions.push(...questionRows(exam.id, LENGUAJE_KEY, ['A', 'B', 'C', 'D']));
    } else {
      allQuestions.push(...questionRows(exam.id, MATE_KEY, ['A', 'B', 'C', 'D']));
    }
    allAssignments.push({ exam_id: exam.id, group_id: p.groupId });
  }

  for (let q = 0; q < allQuestions.length; q += Q_BATCH) {
    await insertQuestions(allQuestions.slice(q, q + Q_BATCH));
  }

  for (let a = 0; a < allAssignments.length; a += ASG_BATCH) {
    const { error: asgErr } = await supabase
      .from('exam_group_assignments')
      .insert(allAssignments.slice(a, a + ASG_BATCH));
    if (asgErr) {
      console.error('Error asignaciones:', asgErr.message);
      process.exit(1);
    }
  }

  created += exams?.length || 0;
  console.log(`  creados ${created}/${planned.length}`);
}

console.log(
  `Listo. Nuevos: ${created}. Ya existían: ${existing.size}. Total esperado ~${groups.length * 2}.`
);
