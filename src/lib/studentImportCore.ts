import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const NAME_KEYS = ['nombre', 'name', 'Nombre', 'Name', 'alumno', 'Alumno', 'estudiante', 'Estudiante'];
const LASTNAME_KEYS = [
  'apellido',
  'apellidos',
  'apellido (s)',
  'apellido(s)',
  'last_name',
  'lastname',
  'Apellido',
  'Apellidos',
  'APELLIDO (S)',
  'APELLIDOS',
];
const FIRSTNAME_KEYS = [
  'nombre',
  'nombres',
  'nombre (s)',
  'nombre(s)',
  'first_name',
  'firstname',
  'Nombre',
  'Nombres',
  'NOMBRE (S)',
  'NOMBRES',
];

export type ImportedStudent = {
  rowNumber: number;
  controlNumber: string;
  name: string;
};

export type StudentImportResult = {
  groupName: string | null;
  students: ImportedStudent[];
  source: 'itson_pdf' | 'csv' | 'xlsx' | 'generic_pdf' | 'sep_list';
  /** Clave de la escuela, p. ej. 26DST0060E. */
  cct?: string | null;
  /** Grupo de la lista, p. ej. 1-A. */
  grupo?: string | null;
  /** Turno: V, M o N. */
  turno?: string | null;
};

const CCT_RE = /^\d{2}[A-Z]{3}\d{4}[A-Z]$/;
const GRUPO_RE = /^\d{1,2}-[A-Z]$/;
const TURNO_RE = /^[VMN]$/;
const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

export function schoolGroupLabel(cct: string, grupo: string, turno: string): string {
  return `${cct} · ${grupo} · ${turno}`;
}

/** Normaliza el JSON de una lista escolar escaneada. Descarta filas sin CURP válida. */
export function parseSepSchoolList(raw: unknown): StudentImportResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { cct?: unknown; grupo?: unknown; turno?: unknown; alumnos?: unknown };
  const cct = String(body.cct ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const grupo = String(body.grupo ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[–—]/g, '-');
  const turno = String(body.turno ?? '')
    .toUpperCase()
    .replace(/[^VMN]/g, '')
    .slice(0, 1);
  if (!CCT_RE.test(cct) || !GRUPO_RE.test(grupo) || !TURNO_RE.test(turno)) return null;
  if (!Array.isArray(body.alumnos)) return null;

  const students: ImportedStudent[] = [];
  const seen = new Set<string>();
  for (const row of body.alumnos) {
    if (!row || typeof row !== 'object') continue;
    const item = row as { nombre?: unknown; curp?: unknown };
    const name = String(item.nombre ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const curp = String(item.curp ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!name || !CURP_RE.test(curp) || seen.has(curp)) continue;
    seen.add(curp);
    students.push({ rowNumber: students.length + 1, controlNumber: curp, name });
  }
  if (students.length === 0) return null;
  return {
    groupName: schoolGroupLabel(cct, grupo, turno),
    students,
    source: 'sep_list',
    cct,
    grupo,
    turno,
  };
}

function readByKeys(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (!(k in row)) continue;
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function isTemplateJunk(value: string): boolean {
  const n = value.trim().toLowerCase();
  if (!n) return true;
  if (n === 'picture') return true;
  if (n.includes('ejemplo:')) return true;
  if (n === 'apellido (s)' || n === 'nombre (s)') return true;
  return false;
}

function cleanupCandidateName(value: string): string {
  return value
    .replace(/^[\s\-*•·\u2022]+/, '')
    .replace(/^\d+[\)\].:\-\s]+/, '')
    .replace(/\b(?:matr[ií]cula|folio|id|grupo)\s*[:#-]?\s*[\w-]+/gi, '')
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePersonName(value: string): boolean {
  const cleaned = cleanupCandidateName(value);
  if (!cleaned || isTemplateJunk(cleaned)) return false;
  if (cleaned.length < 4 || cleaned.length > 80) return false;
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(cleaned)) return false;
  if (/[@/\\]/.test(cleaned)) return false;
  if (/^\d+$/.test(cleaned)) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;
  if (words.some((word) => word.length < 1 || /\d/.test(word))) return false;
  return true;
}

/** Lista de asistencia ITSON / INC (GRUPO, CONTROL, NOMBRE DEL ALUMNO, CARRERA). */
export function parseItsonAttendanceListText(text: string): StudentImportResult | null {
  const groupMatch = text.match(/GRUPO:\s*([A-Z0-9]+)/i);
  const groupName = groupMatch?.[1]?.trim().toUpperCase() ?? null;
  const students: ImportedStudent[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^(\d+)\s+(C?\d{8})\s+(.+?)\s+IND\w+/i);
    if (!match) continue;

    const name = match[3]
      .replace(/\s+\*+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;

    students.push({
      rowNumber: Number.parseInt(match[1], 10),
      controlNumber: match[2].toUpperCase(),
      name,
    });
  }

  if (students.length === 0) return null;
  return { groupName, students, source: 'itson_pdf' };
}

function decodeStudentImportCsvBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  const payload = bytes.subarray(offset);
  const asUtf8 = new TextDecoder('utf-8').decode(payload);
  if (asUtf8.includes('\uFFFD')) {
    return new TextDecoder('windows-1252').decode(payload);
  }
  return asUtf8;
}

function rowToName(row: Record<string, unknown>): string | null {
  const last = readByKeys(row, LASTNAME_KEYS);
  const first = readByKeys(row, FIRSTNAME_KEYS);
  const full = `${first} ${last}`.trim().replace(/\s+/g, ' ');
  if (full && !isTemplateJunk(full)) return full;

  for (const k of NAME_KEYS) {
    if (!(k in row)) continue;
    const v = row[k];
    if (v != null && String(v).trim()) {
      const value = String(v).trim().replace(/\s+/g, ' ');
      if (!isTemplateJunk(value)) return value;
    }
  }
  for (const v of Object.values(row)) {
    if (v != null && String(v).trim()) {
      const value = String(v).trim().replace(/\s+/g, ' ');
      if (!isTemplateJunk(value)) return value;
    }
  }
  return null;
}

export function namesToImportResult(names: string[], source: StudentImportResult['source']): StudentImportResult {
  return {
    groupName: null,
    source,
    students: names.map((name, index) => ({
      rowNumber: index + 1,
      controlNumber: '',
      name,
    })),
  };
}

export function parseGenericPdfTextFromLines(lines: string[]): StudentImportResult {
  const names: string[] = [];
  for (const line of lines) {
    const normalized = cleanupCandidateName(line);
    if (!looksLikePersonName(normalized)) continue;
    names.push(normalized);
  }
  return namesToImportResult(names, 'generic_pdf');
}

export function parseStudentNamesFromXlsxArrayBuffer(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return rows.map(rowToName).filter((n): n is string => Boolean(n));
}

export async function parseStudentNamesFromCsvFile(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const text = decodeStudentImportCsvBytes(new Uint8Array(buf));
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return (result.data || [])
    .map((row) => rowToName(row))
    .filter((n): n is string => Boolean(n));
}
