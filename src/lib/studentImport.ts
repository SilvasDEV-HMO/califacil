import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const NAME_KEYS = ['nombre', 'name', 'Nombre', 'Name', 'alumno', 'Alumno', 'estudiante', 'Estudiante'];

function rowToName(row: Record<string, unknown>): string | null {
  for (const k of NAME_KEYS) {
    if (!(k in row)) continue;
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  for (const v of Object.values(row)) {
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Nombres desde la primera hoja de un libro Excel. */
export function parseStudentNamesFromXlsxArrayBuffer(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return rows.map(rowToName).filter((n): n is string => Boolean(n));
}

export function parseStudentNamesFromCsvFile(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const names = (results.data || [])
          .map((row) => rowToName(row))
          .filter((n): n is string => Boolean(n));
        resolve(names);
      },
      error: (err) => reject(err),
    });
  });
}

/** CSV (exportado desde Excel o nativo) o Excel `.xlsx` / `.xls`. */
export async function parseStudentNamesFromImportFile(file: File): Promise<string[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    return parseStudentNamesFromXlsxArrayBuffer(buf);
  }
  return parseStudentNamesFromCsvFile(file);
}
