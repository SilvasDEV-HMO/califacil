/**
 * Elimina grupos de 2.º y 3.º grado (y sus exámenes) de admin@califacil.com.
 * Conserva solo 1.º (nombres tipo "CCT · 1-A").
 *
 *   node --env-file=.env.local scripts/delete-raf-grade-2-3.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const teacherEmail =
  (process.env.RAF_TEACHER_EMAIL?.trim() || 'admin@califacil.com').toLowerCase();

/** Coincide "CCT · 2-A" / "CCT · 3-B" (no 1.º). */
const GRADE_23 = / · [23]-/;

if (!url || !serviceKey || serviceKey.startsWith('sb_publishable_')) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY válida (service_role).');
  process.exit(1);
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

async function deleteInChunks(table, column, ids, chunkSize = 200) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .in(column, chunk);
    if (error) throw error;
    deleted += count ?? chunk.length;
    if ((i / chunkSize) % 5 === 0 || i + chunkSize >= ids.length) {
      console.log(`  ${table}: ${Math.min(i + chunkSize, ids.length)}/${ids.length}`);
    }
  }
  return deleted;
}

const teacherId = await findTeacherId(teacherEmail);
if (!teacherId) {
  console.error('No encontré usuario', teacherEmail);
  process.exit(1);
}
console.log('teacher_id', teacherId);

const groups = await fetchAllGroups(teacherId);
const toDelete = groups.filter((g) => GRADE_23.test(g.name));
const keep = groups.filter((g) => !GRADE_23.test(g.name));
const grade1 = keep.filter((g) => / · 1-/.test(g.name));
const other = keep.filter((g) => !/ · 1-/.test(g.name));

console.log('Total grupos:', groups.length);
console.log('A eliminar (2.º/3.º):', toDelete.length);
console.log('Conservar 1.º:', grade1.length);
if (other.length) {
  console.log('Otros (no RAF grado):', other.length, other.slice(0, 5).map((g) => g.name));
}

if (toDelete.length === 0) {
  console.log('Nada que borrar.');
  process.exit(0);
}

const groupIds = toDelete.map((g) => g.id);

// Exámenes ligados por group_id (cascade SET NULL dejaría huérfanos)
const examIds = new Set();
for (let i = 0; i < groupIds.length; i += 200) {
  const chunk = groupIds.slice(i, i + 200);
  const { data, error } = await supabase
    .from('exams')
    .select('id')
    .eq('teacher_id', teacherId)
    .in('group_id', chunk);
  if (error) throw error;
  for (const e of data || []) examIds.add(e.id);
}

// Por título por si group_id ya era null
for (const kind of ['Lenguaje', 'Matemáticas']) {
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('exams')
      .select('id,title')
      .eq('teacher_id', teacherId)
      .like('title', `${kind} · %`)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    for (const e of data || []) {
      // title: "Lenguaje · CCT · 2-A"
      if (GRADE_23.test(e.title)) examIds.add(e.id);
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}

const examIdList = [...examIds];
console.log('Exámenes a eliminar:', examIdList.length);

if (examIdList.length) {
  await deleteInChunks('exams', 'id', examIdList);
}

await deleteInChunks('groups', 'id', groupIds);

const after = await fetchAllGroups(teacherId);
const after23 = after.filter((g) => GRADE_23.test(g.name));
const after1 = after.filter((g) => / · 1-/.test(g.name));
console.log(
  `Listo. Grupos restantes: ${after.length} (1.º: ${after1.length}, 2.º/3.º: ${after23.length}).`
);
