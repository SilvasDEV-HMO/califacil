/**
 * Sincroniza los 248 grupos técnicos (ODT Ricardo Cota) contra Matriz RAF
 * y los crea en la cuenta del docente si faltan (idempotente).
 *
 *   node scripts/sync-ricardo-cota-groups.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import xlsxModule from 'xlsx';

const XLSX = xlsxModule.default ?? xlsxModule;

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const url =
  process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const teacherHint =
  (process.env.RAF_TEACHER_EMAIL?.trim() || 'admin@califacil.com').toLowerCase();
const xlsxPath =
  process.env.RAF_XLSX?.trim() || 'E:\\Matriz_RAF_Ciclo-2026-2027-RevDGSR.xlsx';
const odtPath =
  process.env.RAF_ODT?.trim() ||
  'C:\\Users\\alfon\\Downloads\\lista tecnicas cuenta ricardo cota.odt';

if (!url || !serviceKey || serviceKey.startsWith('sb_publishable_')) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY válida.');
  process.exit(1);
}

const CODE_RE = /^RAFL([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])([0-9])([A-Z])(_V)?$/i;

function parseOdtCodes(filePath) {
  const tmp = path.join(tmpdir(), `cota-odt-${Date.now()}`);
  const zipPath = `${tmp}.zip`;
  copyFileSync(filePath, zipPath);
  mkdirSync(tmp, { recursive: true });
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`],
      { stdio: 'pipe' }
    );
  } catch {
    execFileSync('tar', ['-xf', zipPath, '-C', tmp], { stdio: 'pipe' });
  }
  const xml = readFileSync(path.join(tmp, 'content.xml'), 'utf8');
  try {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
  } catch {
    /* ignore */
  }
  const text = xml
    .replace(/<text:tab[^/]*\/>/g, '\t')
    .replace(/<\/text:p>/g, '\n')
    .replace(/<\/text:h>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const codes = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.trim().toUpperCase();
    if (c) codes.push(c);
  }
  return codes;
}

function codeToGroupName(code) {
  const m = CODE_RE.exec(code);
  if (!m) return null;
  const cct = m[1].toUpperCase();
  const grado = m[2];
  const grupo = m[3].toUpperCase();
  const vespertino = Boolean(m[4]);
  const base = `${cct} · ${grado}-${grupo}`;
  return vespertino ? `${base} V` : base;
}

function fullName(ap1, ap2, nom) {
  return [ap1, ap2, nom].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
}

function loadMatrix(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const groups = new Set();
  const studentsByGroup = new Map();
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
    const gname = `${cct} · ${grado}-${grupo}`;
    groups.add(gname);
    if (!name || curp.length < 16) continue;
    const key = `${gname}|${curp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!studentsByGroup.has(gname)) studentsByGroup.set(gname, []);
    studentsByGroup.get(gname).push({ name, controlNumber: curp });
  }
  return { groups, studentsByGroup };
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findTeacher(hint) {
  const hits = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users || []) {
      const em = (u.email || '').toLowerCase();
      const meta = `${u.user_metadata?.full_name || ''} ${u.user_metadata?.name || ''}`.toLowerCase();
      const blob = `${em} ${meta}`;
      if (blob.includes(hint) || (blob.includes('cota') && blob.includes('ricardo'))) {
        hits.push({ id: u.id, email: u.email, name: u.user_metadata?.full_name || u.user_metadata?.name || '' });
      }
    }
    if (!data.users?.length || data.users.length < 200) break;
    page += 1;
    if (page > 40) break;
  }
  return hits;
}

async function fetchAllGroups(teacherId) {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('groups')
      .select('id,name')
      .eq('teacher_id', teacherId)
      .range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return all;
}

const codes = parseOdtCodes(odtPath);
console.log(`ODT códigos: ${codes.length}`);
const parsed = [];
const bad = [];
for (const code of codes) {
  const name = codeToGroupName(code);
  if (!name) bad.push(code);
  else parsed.push({ code, name, vespertino: name.endsWith(' V') });
}
if (bad.length) {
  console.error('Códigos no parseados:', bad);
  process.exit(1);
}

const uniqueNames = [...new Set(parsed.map((p) => p.name))];
console.log(`Nombres de grupo únicos: ${uniqueNames.length}`);

const { groups: matrixGroups, studentsByGroup } = loadMatrix(xlsxPath);
console.log(`Grupos en matriz RAF: ${matrixGroups.size}`);

const missingInMatrix = [];
for (const g of uniqueNames) {
  const base = g.endsWith(' V') ? g.slice(0, -2).trimEnd() : g;
  if (!matrixGroups.has(base)) missingInMatrix.push(g);
}

const teacherEmail = teacherHint;
const teachers = await findTeacher(teacherEmail);
const teacher = teachers.find((t) => (t.email || '').toLowerCase() === teacherEmail) || teachers[0];
if (!teacher) {
  console.error(`No encontré ${teacherEmail}. No se crea ninguna cuenta.`);
  process.exit(1);
}
console.log(`Docente: ${teacher.email} ${teacher.name ? `(${teacher.name})` : ''}`);

const existing = await fetchAllGroups(teacher.id);
const groupIdByName = new Map(existing.map((g) => [g.name, g.id]));
const missingGroups = uniqueNames.filter((n) => !groupIdByName.has(n));
console.log(`Grupos actuales en cuenta: ${existing.length}`);
console.log(`Faltan en cuenta: ${missingGroups.length}`);
if (missingInMatrix.length) {
  console.log(`En ODT pero no en matriz (base CCT·grado-grupo): ${missingInMatrix.length}`);
  for (const n of missingInMatrix.slice(0, 40)) console.log('  matriz?', n);
}

const GROUP_BATCH = 100;
for (let i = 0; i < missingGroups.length; i += GROUP_BATCH) {
  const chunk = missingGroups.slice(i, i + GROUP_BATCH).map((name) => ({
    teacher_id: teacher.id,
    name,
  }));
  const { data, error } = await supabase.from('groups').insert(chunk).select('id,name');
  if (error) {
    console.error('Error grupos:', error.message);
    process.exit(1);
  }
  for (const g of data || []) groupIdByName.set(g.name, g.id);
  console.log(`  creados ${Math.min(i + chunk.length, missingGroups.length)}/${missingGroups.length}`);
}

let inserted = 0;
let skipped = 0;
for (const name of uniqueNames) {
  const groupId = groupIdByName.get(name);
  if (!groupId) continue;
  // Vespertino no viene separado en la matriz: se crea el grupo vacío.
  const list = name.endsWith(' V') ? [] : studentsByGroup.get(name) || [];
  if (list.length === 0) continue;

  const { data: existingStudents, error: exErr } = await supabase
    .from('students')
    .select('name,control_number')
    .eq('group_id', groupId);
  if (exErr) {
    console.error('Error alumnos:', exErr.message);
    process.exit(1);
  }
  const haveCurp = new Set(
    (existingStudents || []).map((s) => (s.control_number || '').trim().toUpperCase()).filter(Boolean)
  );
  const haveName = new Set(
    (existingStudents || []).map((s) => (s.name || '').trim().toLowerCase()).filter(Boolean)
  );
  const inserts = [];
  for (const s of list) {
    if (haveCurp.has(s.controlNumber) || haveName.has(s.name.toLowerCase())) {
      skipped += 1;
      continue;
    }
    haveCurp.add(s.controlNumber);
    haveName.add(s.name.toLowerCase());
    inserts.push({ group_id: groupId, name: s.name, control_number: s.controlNumber });
  }
  for (let i = 0; i < inserts.length; i += 400) {
    const chunk = inserts.slice(i, i + 400);
    const { error } = await supabase.from('students').insert(chunk);
    if (error) {
      console.error('Error insert alumnos:', error.message);
      process.exit(1);
    }
    inserted += chunk.length;
  }
}

console.log(
  JSON.stringify(
    {
      odtCodes: codes.length,
      uniqueGroups: uniqueNames.length,
      missingInMatrix: missingInMatrix.length,
      createdGroups: missingGroups.length,
      studentsInserted: inserted,
      studentsSkipped: skipped,
      teacher: teacher.email,
    },
    null,
    2
  )
);
