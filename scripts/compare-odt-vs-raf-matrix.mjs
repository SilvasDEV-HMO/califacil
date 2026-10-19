import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import xlsxModule from 'xlsx';

const XLSX = xlsxModule.default ?? xlsxModule;
const xlsxPath = process.env.RAF_XLSX?.trim() || 'E:\\Matriz_RAF_Ciclo-2026-2027-RevDGSR.xlsx';
const odtPath =
  process.env.RAF_ODT?.trim() ||
  'C:\\Users\\alfon\\Downloads\\lista tecnicas cuenta ricardo cota.odt';

const CODE_RE = /^RAFL([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])([0-9])([A-Z])(_V)?$/i;

function parseOdtCodes(filePath) {
  const tmp = path.join(tmpdir(), `cota-odt-cmp-${Date.now()}`);
  const zipPath = `${tmp}.zip`;
  copyFileSync(filePath, zipPath);
  mkdirSync(tmp, { recursive: true });
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', tmp], { stdio: 'pipe' });
  } catch {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`],
      { stdio: 'pipe' }
    );
  }
  const xml = readFileSync(path.join(tmp, 'content.xml'), 'utf8');
  try {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
  } catch {
    /* ignore */
  }
  const text = xml
    .replace(/<\/text:p>/g, '\n')
    .replace(/<\/text:h>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return text
    .split(/\r?\n/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function parseGrado(raw) {
  const t = String(raw ?? '').trim().toUpperCase();
  const m = t.match(/(\d)/);
  return m ? m[1] : t;
}

function parseGrupo(raw) {
  const t = String(raw ?? '').trim().toUpperCase();
  const m = t.match(/[A-Z]/);
  return m ? m[0] : t;
}

const codes = parseOdtCodes(odtPath);
const odt = [];
for (const code of codes) {
  const m = CODE_RE.exec(code);
  if (!m) {
    odt.push({ code, parseError: true });
    continue;
  }
  odt.push({
    code,
    cct: m[1].toUpperCase(),
    grado: m[2],
    grupo: m[3].toUpperCase(),
    vespertino: Boolean(m[4]),
  });
}

if (!existsSync(xlsxPath)) {
  console.error('No encuentro Excel', xlsxPath);
  process.exit(1);
}

const wb = XLSX.readFile(xlsxPath, { cellDates: false });
console.log('Hojas:', wb.SheetNames.join(' | '));

const allRows = [];
for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  console.log(`  ${sheetName}: ${rows.length} filas, ${rows[0]?.length ?? 0} cols`);
  console.log('  encabezado:', JSON.stringify(rows[0]));
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    allRows.push({ sheetName, row });
  }
}

const exact = new Map(); // cct|grado|grupo -> count
const cctIndex = new Map(); // cct -> Set of grado-grupo
for (const { row } of allRows) {
  const cct = norm(row[0]);
  const grado = parseGrado(row[5]);
  const grupo = parseGrupo(row[6]);
  if (!cct || !grado || !grupo) continue;
  const k = `${cct}|${grado}|${grupo}`;
  exact.set(k, (exact.get(k) || 0) + 1);
  if (!cctIndex.has(cct)) cctIndex.set(cct, new Set());
  cctIndex.get(cct).add(`${grado}-${grupo}`);
}

function nearestCcts(cct) {
  const stem = cct.slice(0, 9); // without check digit
  const hits = [];
  for (const other of cctIndex.keys()) {
    if (other === cct) continue;
    if (other.startsWith(stem) || stem.startsWith(other.slice(0, 9))) hits.push(other);
    else if (other.includes(cct.slice(2, 9)) || cct.includes(other.slice(2, 9))) hits.push(other);
  }
  // also numeric sequential near
  const num = cct.slice(5, 9);
  for (const other of cctIndex.keys()) {
    if (other.slice(0, 5) === cct.slice(0, 5) && other.slice(5, 9) === num && other !== cct) {
      if (!hits.includes(other)) hits.push(other);
    }
  }
  return hits;
}

const missing = [];
const present = [];
for (const item of odt) {
  if (item.parseError) {
    missing.push({ ...item, reason: 'codigo_no_parseado' });
    continue;
  }
  const k = `${item.cct}|${item.grado}|${item.grupo}`;
  const n = exact.get(k) || 0;
  if (n > 0) {
    present.push({ ...item, alumnos: n });
    continue;
  }
  const sameCct = cctIndex.get(item.cct);
  const near = nearestCcts(item.cct);
  missing.push({
    code: item.code,
    grupoEsperado: `${item.cct} · ${item.grado}-${item.grupo}${item.vespertino ? ' V' : ''}`,
    cct: item.cct,
    grado: item.grado,
    grupo: item.grupo,
    vespertino: item.vespertino,
    cctEnMatriz: Boolean(sameCct),
    gruposDelCctEnMatriz: sameCct ? [...sameCct].sort().join(', ') : '',
    cctsParecidos: near.join(', '),
  });
}

const uniqueMissing = [];
const seenM = new Set();
for (const m of missing) {
  const key = m.grupoEsperado || m.code;
  if (seenM.has(key)) continue;
  seenM.add(key);
  uniqueMissing.push(m);
}

console.log('\n=== Resumen ===');
console.log('Códigos ODT:', odt.length);
console.log('En matriz (CCT+grado+grupo):', present.length);
console.log('NO en matriz:', uniqueMissing.length);
console.log('CCTs distintos en matriz:', cctIndex.size);

const cctsMissing = [...new Set(uniqueMissing.filter((m) => !m.cctEnMatriz).map((m) => m.cct))].sort();
console.log('\nCCTs del ODT que no aparecen en ninguna fila de la matriz:');
for (const c of cctsMissing) {
  const near = nearestCcts(c);
  console.log(`  ${c}${near.length ? `  (parecidos: ${near.join(', ')})` : '  (sin CCT parecido)'}`);
}

console.log('\n=== Lista de grupos ODT que NO vienen en la matriz ===');
for (const m of uniqueMissing) {
  const extra = m.cctEnMatriz
    ? `CCT sí existe; grupos 1.er/otros en matriz: ${m.gruposDelCctEnMatriz}`
    : m.cctsParecidos
      ? `CCT no existe; parecidos: ${m.cctsParecidos}`
      : 'CCT no existe en la matriz';
  console.log(`${m.code}\t${m.grupoEsperado}\t${extra}`);
}

const out = path.join(process.cwd(), 'scripts', 'odt-grupos-faltantes-en-matriz.txt');
const lines = [
  `ODT: ${odtPath}`,
  `Excel: ${xlsxPath}`,
  `Hojas: ${wb.SheetNames.join(', ')}`,
  `Códigos ODT: ${odt.length}`,
  `Presentes en matriz: ${present.length}`,
  `Faltantes únicos: ${uniqueMissing.length}`,
  '',
  'CCTs del ODT ausentes por completo:',
  ...cctsMissing.map((c) => `  ${c}`),
  '',
  'Grupos que no vienen:',
  ...uniqueMissing.map((m) => {
    const extra = m.cctEnMatriz
      ? `CCT sí; grupos en matriz: ${m.gruposDelCctEnMatriz}`
      : m.cctsParecidos
        ? `CCT no; parecidos: ${m.cctsParecidos}`
        : 'CCT no existe';
    return `${m.grupoEsperado}\t${m.code}\t${extra}`;
  }),
];
writeFileSync(out, lines.join('\n'), 'utf8');
console.log('\nLista escrita en', out);
