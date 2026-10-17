/**
 * Crea grupos + alumnos desde Matriz RAF solo para admin@califacil.com.
 * Idempotente (no duplica grupo por nombre ni alumno por CURP/nombre).
 *
 * Requiere service_role real (no publishable):
 *   node --env-file=.env.local scripts/import-raf-groups.mjs
 *
 * Alternativa sin clave: scripts/raf-import/*.sql en SQL Editor.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'node:fs';
import xlsxModule from 'xlsx';
const XLSX = xlsxModule.default ?? xlsxModule;

const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const teacherEmail =
  (process.env.RAF_TEACHER_EMAIL?.trim() || 'admin@califacil.com').toLowerCase();
const xlsxPath =
  process.env.RAF_XLSX?.trim() ||
  'E:\\Matriz_RAF_Ciclo-2026-2027-RevDGSR.xlsx';
const GROUP_BATCH = 200;
const STUDENT_BATCH = 400;

if (!url || !serviceKey) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL.');
  process.exit(1);
}
if (serviceKey.startsWith('sb_publishable_')) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY es publishable. Usa service_role (eyJ… / sb_secret_).\n' +
      'O ejecuta scripts/raf-import/*.sql en el SQL Editor.'
  );
  process.exit(1);
}
if (!existsSync(xlsxPath)) {
  console.error('No encuentro Excel:', xlsxPath);
  process.exit(1);
}

function schoolGroupLabel(cct, grado, grupo) {
  return `${cct} · ${grado}-${grupo}`;
}

function fullName(ap1, ap2, nom) {
  return [ap1, ap2, nom].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
}

function loadMatrix(path) {
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const groups = new Set();
  const students = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const cct = String(row[0] ?? '').trim().toUpperCase();
    const curp = String(row[1] ?? '').trim().toUpperCase().replace(/\s+/g, '');
    const name = fullName(row[2], row[3], row[4]);
    const grado = String(row[5] ?? '').trim();
    const grupo = String(row[6] ?? '').trim().toUpperCase();
    if (!cct || !grado || !grupo) continue;
    const gname = schoolGroupLabel(cct, grado, grupo);
    groups.add(gname);
    if (!name || curp.length < 16) continue;
    const key = `${gname}|${curp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    students.push({ groupName: gname, name, controlNumber: curp });
  }
  return {
    groupNames: [...groups].sort((a, b) => a.localeCompare(b, 'es')),
    students,
  };
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findTeacherId(email) {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = (data.users || []).find(
      (u) => (u.email || '').trim().toLowerCase() === email
    );
    if (hit) return hit.id;
    if (!data.users?.length || data.users.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }
  return null;
}

console.log('Leyendo', xlsxPath);
const { groupNames, students } = loadMatrix(xlsxPath);
console.log(`Grupos: ${groupNames.length} | Alumnos: ${students.length}`);
console.log('Usuario:', teacherEmail);

const teacherId = await findTeacherId(teacherEmail);
if (!teacherId) {
  console.error('No existe', teacherEmail);
  process.exit(1);
}

const { data: existingGroups, error: gErr } = await supabase
  .from('groups')
  .select('id,name')
  .eq('teacher_id', teacherId);
if (gErr) {
  console.error(gErr.message);
  process.exit(1);
}

const groupIdByName = new Map((existingGroups || []).map((g) => [g.name, g.id]));
const missingGroups = groupNames.filter((n) => !groupIdByName.has(n));
console.log(`Grupos existentes: ${groupIdByName.size}. Por crear: ${missingGroups.length}`);

for (let i = 0; i < missingGroups.length; i += GROUP_BATCH) {
  const chunk = missingGroups.slice(i, i + GROUP_BATCH).map((name) => ({
    teacher_id: teacherId,
    name,
  }));
  const { data, error } = await supabase.from('groups').insert(chunk).select('id,name');
  if (error) {
    console.error('Error grupos:', error.message);
    process.exit(1);
  }
  for (const g of data || []) groupIdByName.set(g.name, g.id);
  console.log(`  grupos ${Math.min(i + chunk.length, missingGroups.length)}/${missingGroups.length}`);
}

const byGroupName = new Map();
for (const s of students) {
  if (!byGroupName.has(s.groupName)) byGroupName.set(s.groupName, []);
  byGroupName.get(s.groupName).push(s);
}

let inserted = 0;
let skipped = 0;
let groupDone = 0;
const groupTotal = byGroupName.size;

for (const [groupName, list] of byGroupName) {
  groupDone += 1;
  const groupId = groupIdByName.get(groupName);
  if (!groupId) {
    skipped += list.length;
    continue;
  }

  const { data: existing, error: exErr } = await supabase
    .from('students')
    .select('name,control_number')
    .eq('group_id', groupId);
  if (exErr) {
    console.error('Error leyendo alumnos:', exErr.message);
    process.exit(1);
  }

  const haveCurp = new Set(
    (existing || []).map((s) => (s.control_number || '').trim().toUpperCase()).filter(Boolean)
  );
  const haveName = new Set(
    (existing || []).map((s) => (s.name || '').trim().toLowerCase()).filter(Boolean)
  );
  const inserts = [];
  for (const s of list) {
    if (haveCurp.has(s.controlNumber) || haveName.has(s.name.toLowerCase())) {
      skipped++;
      continue;
    }
    haveCurp.add(s.controlNumber);
    haveName.add(s.name.toLowerCase());
    inserts.push({
      group_id: groupId,
      name: s.name,
      control_number: s.controlNumber,
    });
  }

  for (let i = 0; i < inserts.length; i += STUDENT_BATCH) {
    const chunk = inserts.slice(i, i + STUDENT_BATCH);
    const { error } = await supabase.from('students').insert(chunk);
    if (error) {
      console.error('Error alumnos:', error.message);
      process.exit(1);
    }
    inserted += chunk.length;
  }

  if (groupDone % 50 === 0 || groupDone === groupTotal) {
    console.log(
      `  grupos ${groupDone}/${groupTotal} | alumnos insertados ${inserted} | omitidos ${skipped}`
    );
  }
}

console.log(`Listo. Grupos: ${groupIdByName.size}. Alumnos nuevos: ${inserted}. Omitidos: ${skipped}.`);
