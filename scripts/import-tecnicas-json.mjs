/**
 * Importa grupos/alumnos RAF desde JSON extraídos de listas.
 *   node --env-file=.env.local scripts/import-tecnicas-json.mjs
 */
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
if (!url || !serviceKey || serviceKey.startsWith('sb_publishable_')) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY válida.');
  process.exit(1);
}

const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
const CURP_ALPHABET = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
function checkDigit(curp17) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const valueOf = CURP_ALPHABET.indexOf(curp17[i]);
    if (valueOf < 0) return null;
    sum += valueOf * (18 - i);
  }
  return String((10 - (sum % 10)) % 10);
}
function isValidCurp(value) {
  const curp = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!CURP_RE.test(curp)) return false;
  return curp.endsWith(checkDigit(curp.slice(0, 17)));
}
function repairCurp(raw) {
  let curp = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!curp) return null;
  if (isValidCurp(curp)) return curp;
  if (curp.length === 17 && /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]$/.test(curp)) {
    const d = checkDigit(curp);
    if (d != null && isValidCurp(curp + d)) return curp + d;
  }
  if (curp.length === 18) {
    const withDigit = curp.slice(0, 17) + (checkDigit(curp.slice(0, 17)) ?? '');
    if (isValidCurp(withDigit)) return withDigit;
  }
  return isValidCurp(curp) ? curp : null;
}

const LENGUAJE_KEY = [
  'A', 'C', 'C', 'A', 'B', 'A', 'B', 'A', 'A', 'C',
  'C', 'C', 'A', 'C', 'C', 'B', 'A', 'B', 'C', 'A',
  'A', 'C', 'A', 'A', 'C', 'B', 'C', 'B', 'B', 'A',
];
const MATE_KEY = [
  'A', 'C', 'B', 'D', 'D', 'C', 'B', 'A', 'D', 'C',
  'C', 'B', 'B', 'B', 'B', 'C', 'C', 'A', 'D', 'C',
];
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

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Uso: node --env-file=.env.local scripts/import-tecnicas-json.mjs archivo.json ...');
  process.exit(1);
}

const allowNoCurp = process.env.ALLOW_NO_CURP === '1';
const lists = [];
for (const f of files) {
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  lists.push(...raw);
}

const studentsByGroup = new Map();
const rejected = [];
for (const list of lists) {
  const groupName = list.groupName;
  if (!studentsByGroup.has(groupName)) studentsByGroup.set(groupName, []);
  const out = studentsByGroup.get(groupName);
  const seen = new Set(out.map((s) => s.controlNumber).filter(Boolean));
  const seenName = new Set(out.map((s) => s.name.toLowerCase()));
  for (const s of list.students || []) {
    const name = String(s.name || '')
      .replace(/\s+/g, ' ')
      .trim();
    const curp = repairCurp(s.curp);
    if (!name) continue;
    if (!curp && !allowNoCurp) {
      rejected.push({ group: groupName, name, rawCurp: s.curp });
      continue;
    }
    if (curp && seen.has(curp)) continue;
    if (seenName.has(name.toLowerCase())) continue;
    if (curp) seen.add(curp);
    seenName.add(name.toLowerCase());
    out.push({ name, controlNumber: curp || null });
  }
}

console.log('Validación:');
for (const [g, list] of studentsByGroup) {
  console.log(`  ${g}: ${list.length}`);
}
if (rejected.length) {
  console.warn('Rechazados CURP:', rejected.length);
  for (const r of rejected.slice(0, 40)) {
    console.warn(`  ${r.group} | ${r.name} | ${r.rawCurp}`);
  }
  if (rejected.length > 40) console.warn(`  ... +${rejected.length - 40}`);
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
    if (page > 50) break;
  }
  return null;
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

const groupNames = [...studentsByGroup.keys()];
const { data: existingGroups, error: gErr } = await supabase
  .from('groups')
  .select('id,name')
  .eq('teacher_id', teacherId)
  .in('name', groupNames);
if (gErr) {
  console.error(gErr.message);
  process.exit(1);
}
const groupIdByName = new Map((existingGroups || []).map((g) => [g.name, g.id]));
const missingGroups = groupNames.filter((n) => !groupIdByName.has(n));
if (missingGroups.length) {
  const { data, error } = await supabase
    .from('groups')
    .insert(missingGroups.map((name) => ({ teacher_id: teacherId, name })))
    .select('id,name');
  if (error) {
    console.error('Error grupos:', error.message);
    process.exit(1);
  }
  for (const g of data || []) groupIdByName.set(g.name, g.id);
}

let inserted = 0;
let skipped = 0;
for (const [groupName, list] of studentsByGroup) {
  const groupId = groupIdByName.get(groupName);
  const { data: existing, error: exErr } = await supabase
    .from('students')
    .select('name,control_number')
    .eq('group_id', groupId);
  if (exErr) {
    console.error(exErr.message);
    process.exit(1);
  }
  const haveCurp = new Set(
    (existing || [])
      .map((s) => (s.control_number || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const haveName = new Set(
    (existing || []).map((s) => (s.name || '').trim().toLowerCase()).filter(Boolean)
  );
  const inserts = [];
  for (const s of list) {
    if (
      (s.controlNumber && haveCurp.has(s.controlNumber)) ||
      haveName.has(s.name.toLowerCase())
    ) {
      skipped++;
      continue;
    }
    if (s.controlNumber) haveCurp.add(s.controlNumber);
    haveName.add(s.name.toLowerCase());
    inserts.push({
      group_id: groupId,
      name: s.name,
      control_number: s.controlNumber,
    });
  }
  if (inserts.length) {
    const { error } = await supabase.from('students').insert(inserts);
    if (error) {
      console.error('Error alumnos:', error.message);
      process.exit(1);
    }
    inserted += inserts.length;
  }
  console.log(`  ${groupName}: +${inserts.length} (lista ${list.length})`);
}

const titles = groupNames.flatMap((n) => [
  titleFor('lenguaje', n),
  titleFor('matematicas', n),
]);
const { data: existingExams, error: eErr } = await supabase
  .from('exams')
  .select('id,title,group_id')
  .eq('teacher_id', teacherId)
  .in('title', titles);
if (eErr) {
  console.error(eErr.message);
  process.exit(1);
}
const examByTitle = new Map((existingExams || []).map((e) => [e.title, e]));
for (const groupName of groupNames) {
  const groupId = groupIdByName.get(groupName);
  for (const kind of ['lenguaje', 'matematicas']) {
    const title = titleFor(kind, groupName);
    let exam = examByTitle.get(title);
    if (!exam) {
      const { data, error } = await supabase
        .from('exams')
        .insert({
          teacher_id: teacherId,
          group_id: groupId,
          title,
          description:
            kind === 'lenguaje'
              ? 'Diagnóstico Lenguaje (clave despegue). Solo este grupo.'
              : 'Diagnóstico Matemáticas. Solo este grupo.',
          status: 'published',
          qr_code: null,
        })
        .select('id,title,group_id')
        .single();
      if (error) {
        console.error('Error examen:', title, error.message);
        process.exit(1);
      }
      exam = data;
      examByTitle.set(title, exam);
      const key = kind === 'lenguaje' ? LENGUAJE_KEY : MATE_KEY;
      await insertQuestions(questionRows(exam.id, key, ['A', 'B', 'C', 'D']));
      console.log('  examen creado:', title);
    }
    const { data: asg } = await supabase
      .from('exam_group_assignments')
      .select('exam_id')
      .eq('exam_id', exam.id)
      .eq('group_id', groupId)
      .maybeSingle();
    if (!asg) {
      const { error: asgErr } = await supabase
        .from('exam_group_assignments')
        .insert({ exam_id: exam.id, group_id: groupId });
      if (asgErr) {
        console.error('Error asignación:', asgErr.message);
        process.exit(1);
      }
    }
  }
}

console.log(
  `Listo. Nuevos: ${inserted}. Ya existían: ${skipped}. Rechazados CURP: ${rejected.length}.`
);
