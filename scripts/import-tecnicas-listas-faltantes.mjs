/**
 * Crea grupos + alumnos (y exámenes RAF si faltan) desde listas de asistencia
 * de Técnicas que no estaban en la Matriz RAF:
 *   26DST0017Q · 1-A, 26DST0017Q · 1-B, 26DST0040R · 1-A
 *
 *   node --env-file=.env.local scripts/import-tecnicas-listas-faltantes.mjs
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
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY válida (service_role).');
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
  if (isValidCurp(curp)) return curp;

  if (curp.length === 17 && /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]$/.test(curp)) {
    const d = checkDigit(curp);
    if (d != null && isValidCurp(curp + d)) return curp + d;
  }

  if (curp.length === 17) {
    for (const ch of CURP_ALPHABET) {
      const cand = curp.slice(0, 16) + ch + curp.slice(16);
      if (isValidCurp(cand)) return cand;
    }
  }

  if (curp.length === 18) {
    const withDigit = curp.slice(0, 17) + (checkDigit(curp.slice(0, 17)) ?? '');
    if (isValidCurp(withDigit)) return withDigit;
  }

  const swaps = [
    ['O', '0'],
    ['0', 'O'],
    ['I', '1'],
    ['1', 'I'],
    ['S', '5'],
    ['5', 'S'],
    ['B', '8'],
    ['8', 'B'],
    ['Z', '2'],
    ['2', 'Z'],
    ['G', '6'],
    ['6', 'G'],
  ];
  for (const [a, b] of swaps) {
    if (!curp.includes(a)) continue;
    const cand = curp.replace(a, b);
    if (isValidCurp(cand)) return cand;
    if (cand.length === 18) {
      const fixed = cand.slice(0, 17) + (checkDigit(cand.slice(0, 17)) ?? '');
      if (isValidCurp(fixed)) return fixed;
    }
  }
  return null;
}

function nameFromParts(paterno, materno, nombres) {
  return [paterno, materno, nombres]
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

/** Listas transcritas de las fotos. No se inventan filas. */
const LISTS = [
  {
    groupName: '26DST0017Q · 1-A',
    rows: [
      ['BUCE140408HSRSCZA4', 'BUSTAMANTE', 'CECENA', 'EZEQUIEL'],
      ['CAOM140201MSRLCLB2', 'CALIXTRO', 'OCHOA', 'MELISSA GUADALUPE'],
      ['CAGI140308HSRSRSA8', 'CASTRO', 'GARCIA', 'ISELA ARIATNA'],
      ['CAZI140526HQRHPNA2', 'CHAN', 'ZAPATA', 'IAN JEREMY'],
      ['CUDM141111HSRRRRA8', 'CRUZ', 'DUARTE', 'MAURO MATEO'],
      ['DEMA141002MSRLNNA7', 'DELGADO', 'MENDOZA', 'ANGELLYNE ALEXANDRA'],
      ['EAGV140327MSRSRCA0', 'ESCALANTE', 'GARCIA', 'VICTORIA'],
      ['GACJ141202HSRLHDA8', 'GALLEGOS', 'CHA', 'JUDAS TADEO'],
      ['JITA141003HSRMHNA3', 'JIMENEZ', 'THOMPSON', 'ANGEL MANUEL'],
      ['LOAA140307MSRPNRA2', 'LOPEZ', 'ANDRADE', 'ARANZA GUADALUPE'],
      ['MASD140407HNELNM0', 'MALDONADO', 'SINOTEZ', 'DOMINIC'],
      ['MOCD141018HSRRRSAB', 'MORALES', 'CARRILLO', 'DUSTYN GAEL'],
      ['MONF140811HSRRRRA9', 'MORALES', 'NORIEGA', 'FRANCISCO EMANUEL'],
      ['OOWC140417HSRLTSA5', 'OLONO', 'WITCHART', 'CESAR ISMAEL'],
      ['RIIM140622MSRVBNA2', 'RIVERA', 'IBARRA', 'MONTSERRAT'],
      ['SIQA140816MSRRDNA0', 'SIERRA', 'QUINONEZ', 'ANYELI GUADALUPE'],
      ['TAOD140321MSRTJNA3', 'TAUTIMEZ', 'QUIJADA', 'DANNA PATRICIA'],
      ['VECM140117MSRGHRA5', 'VEGA', 'CHA', 'MARYORIE TAMARA'],
      ['VECM141209MSRRSNA1', 'VERDUGO', 'CASTRO', 'MONICA CAROLINA'],
    ],
  },
  {
    groupName: '26DST0017Q · 1-B',
    rows: [
      ['AUQV140323MSRCNRA2', 'AGUILAR', 'QUINTERO', 'VIRGINIA GRISELDA'],
      ['AALI141022MJCLXLA5', 'ALCARAZ', 'INIGUEZ', 'JULIA ANILEETH'],
      ['BUPR140125HSRSRMA7', 'BUSTAMANTE', 'PARRA', 'RAMON ANGEL'],
      ['CABY141027MSRMTNA1', 'CAMPANA', 'BAUTISTA', 'VANIA HANANI'],
      ['COVS140225HSRNGBA0', 'CONTRERAS', 'VEGA', 'SEBASTIAN ZAID'],
      ['COFK150324MSRRLA3', 'CORELLA', 'FLORES', 'KAELYNN NICOLE'],
      ['DONO140715MSRVVNA8', 'DOMINGUEZ', 'NAVARRO', 'DANNA MARIA'],
      ['HELD140224HSRRPYA5', 'HERRERA', 'LOPEZ', 'DYLAN YANNICK'],
      ['LITL140507MSRZVNA3', 'LIZARRAGA', 'TOVAR', 'LUNA MARIANNE'],
      ['LOXI140111MSRPVSA7', 'LOPEZ', '', 'MARIA ISABEL'],
      ['LOCJ141231HSRPRLA9', 'LOPEZ', 'CORRALES', 'JULIO EMILIO'],
      ['LOMC141026MSRPRMAB', 'LOPEZ', 'MORALES', 'CAMILA ALEJANDRA'],
      ['MOMJ141012HSRNLSA4', 'MONTOYA', 'MOLINA', 'JESUS LEOBARDO'],
      ['MOAA140701HSRRGNA7', 'MORALES', 'AGUILAR', 'ANGEL FRANCISCO'],
      ['OOTD140418HSRCTMA5', 'OCHOA', 'TAUTIMEZ', 'DOMINIC SAMUEL'],
      ['OEFA140417MSRLLRA9', 'OLVERA', 'FLORES', 'ARANZA'],
      ['ROCM141214HSRMHRA4', 'ROMERO', 'CHA', 'MARTIN ALEJANDRO'],
      ['VAHS141211HSRSGNA3', 'VASQUEZ', 'HUGUES', 'SANTIAGO'],
      ['VEAL140321HSRLNSA2', 'VELARDE', 'ANDRADE', 'JOSE LUIS'],
    ],
  },
  {
    groupName: '26DST0040R · 1-A',
    rows: [
      ['AUOD141008MSRHXNA9', 'AHUMADA', 'QUINONEZ', 'DANIELA ALEJANDRA'],
      ['AARI140313HSRNVKA3', 'ANDRADE', 'RIVERA', 'IKER ALEJANDRO'],
      ['ARBC141129HSRBRSA0', 'ARVIZU', 'BRACAMONTES', 'CESAR RAFAEL'],
      ['ARJS140606HSRBNRA5', 'ARVIZU', 'SANTACRUZ', 'JORGE ALEJANDRO'],
      ['CAJE140720HSRBDNA2', 'CASTORENA', 'MADA', 'JOSE ENRIQUE'],
      ['COMD140516HSRRNYA2', 'CORTEZ', 'MONTES', 'DEYSI MARICELA'],
      ['DALR141127HSRLMAS', 'DANZOS', 'LEAL', 'ROMAN SAUL'],
      ['DEFI140810HSRZXNA3', 'DELGADILLO', '', 'IAN FERNANDO'],
      ['ESJM141010HSRRSA6', 'ESPINOZA', 'MORENO', 'JESUS ARIEL'],
      ['GALC140422HSRLPSA5', 'GALVEZ', 'LOPEZ', 'CESAR ALFONSO'],
      ['GUCA140104MSRRNNA2', 'GUERRERO', 'CANO', 'ANGELES BERENICE'],
      ['LADN140808MSRRNYA2', 'LANDAVAZO', 'DUARTE', 'NAYLEEN FERNANDA'],
      ['LAEM140731MSRNSRA4', 'LANDAVAZO', 'ESPINOZA', 'MIRIAM YURITZIA'],
      ['LUGH140107MSRCROA5', 'LUCERO', 'GARCIA', 'HEIDY KARLETH'],
      ['MAMZ141204HSRDRYA9', 'MADA', 'MORENO', 'ZAYEL ARIADNE'],
      ['MASM140812MSRDNNA5', 'MADA', 'SANTOS', 'MONSERRATH'],
      ['MECF140904HSRNRRA7', 'MENDOZA', 'CORDOVA', 'FRANCISCO GUADALUPE'],
      ['MESA141222MHRNNSA3', 'MENESES', 'SANTA CRUZ', 'ASLHY JORANA'],
      ['MOAA140821MSRRRLA9', 'MORENO', 'ARREOLA', 'AILYN SOFIA'],
      ['MORB140316MSRRMRA3', 'MORENO', 'ROMERO', 'BRIANDA LIZETH'],
      ['OARN140615MSRLMDA2', 'OLAGUES', 'RAMIREZ', 'NAIDELINNE NAHOMI'],
      ['PEGG141023HSRLPLA9', 'PEREZ', 'GALVEZ', 'GAEL ALEJANDRO'],
      ['RALS140121HSRSNLA2', 'RASCON', 'LUNA', 'SAUL ALEJANDRO'],
      ['ROAM140527MSRDNLA8', 'RODRIGUEZ', 'ANDRADE', 'MELANY REBECA'],
      ['VESD141214MSHCNYA7', 'VECINO', 'SANTACRUZ', 'DAYANA'],
    ],
  },
];

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

const studentsByGroup = new Map();
const rejected = [];
for (const list of LISTS) {
  const out = [];
  const seen = new Set();
  for (const [rawCurp, paterno, materno, nombres] of list.rows) {
    const name = nameFromParts(paterno, materno, nombres);
    const curp = repairCurp(rawCurp);
    if (!curp || !name) {
      rejected.push({ group: list.groupName, name, rawCurp });
      continue;
    }
    if (seen.has(curp)) continue;
    seen.add(curp);
    out.push({ name, controlNumber: curp });
  }
  studentsByGroup.set(list.groupName, out);
}

console.log('Validación CURP:');
for (const [g, list] of studentsByGroup) {
  console.log(`  ${g}: ${list.length} alumnos con CURP válida`);
}
if (rejected.length) {
  console.warn('Omitidos (CURP no verificable):');
  for (const r of rejected) {
    console.warn(`  ${r.group} | ${r.name} | ${r.rawCurp}`);
  }
}

const teacherId = await findTeacherId(teacherEmail);
if (!teacherId) {
  console.error('No existe', teacherEmail);
  process.exit(1);
}
console.log('Usuario:', teacherEmail, teacherId);

const groupNames = LISTS.map((l) => l.groupName);
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
console.log('Grupos:', [...groupIdByName.keys()].join(' | '));

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
  if (inserts.length) {
    const { error } = await supabase.from('students').insert(inserts);
    if (error) {
      console.error('Error alumnos:', error.message);
      process.exit(1);
    }
    inserted += inserts.length;
  }
  console.log(
    `  ${groupName}: +${inserts.length} nuevos, ${skipped} omitidos acumulados, total lista ${list.length}`
  );
}

const { data: existingExams, error: eErr } = await supabase
  .from('exams')
  .select('id,title,group_id')
  .eq('teacher_id', teacherId)
  .in(
    'title',
    groupNames.flatMap((n) => [titleFor('lenguaje', n), titleFor('matematicas', n)])
  );
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
  `Listo. Alumnos nuevos: ${inserted}. Omitidos (ya existían): ${skipped}. Rechazados CURP: ${rejected.length}.`
);
