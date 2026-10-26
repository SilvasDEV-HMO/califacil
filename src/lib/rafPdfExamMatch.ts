export type RafSubject = 'lenguaje' | 'matematicas';

export type RafPdfIdentity = {
  subject: RafSubject;
  cct: string;
  grade: string;
  groupLetter: string;
  vespertino: boolean;
  groupKey: string;
  examTitle: string;
};

const SUBSYSTEM = 'DST|DES|EST|EES|ETV';
const CCT_GROUP_GAP =
  `([0-9]{2}(?:${SUBSYSTEM})[0-9]{4}[A-Z])[\\s\\-_]*([0-9])[\\s\\-_]*([A-Z])`;

export function normalizeRafTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function rafSubjectFromTitle(title: string): RafSubject | null {
  const name = normalizeRafTitle(title);
  if (name.startsWith('lenguaje')) return 'lenguaje';
  if (name.startsWith('matematicas') || name.startsWith('mate ')) return 'matematicas';
  return null;
}

export function rafExamTitleForIdentity(id: Omit<RafPdfIdentity, 'examTitle' | 'groupKey'>): string {
  const groupKey = `${id.cct} · ${id.grade}-${id.groupLetter}${id.vespertino ? ' V' : ''}`;
  const subjectLabel = id.subject === 'lenguaje' ? 'Lenguaje' : 'Matemáticas';
  return `${subjectLabel} · ${groupKey}`;
}

function foldFileBase(fileName: string): string {
  return fileName
    .replace(/^.*[/\\]/, '')
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function subjectFromRafName(folded: string, compact: string): RafSubject | null {
  if (compact.includes('RAFLENGUAJE') || compact.includes('RAFLENG')) return 'lenguaje';
  if (compact.includes('RAFMATEMATICAS') || compact.includes('RAFMATE')) return 'matematicas';
  const fromRaf = compact.includes('RAF') ? compact.slice(compact.indexOf('RAF')) : compact;
  if (fromRaf.startsWith('RAFL') && !fromRaf.startsWith('RAFM')) return 'lenguaje';
  if (fromRaf.startsWith('RAFM')) return 'matematicas';
  if (/\bRAF\s+LENG/.test(folded) || (folded.includes('RAF') && folded.includes('LENGUAJE'))) {
    return 'lenguaje';
  }
  if (/\bRAF\s+MATE/.test(folded) || (folded.includes('RAF') && folded.includes('MATEMATICAS'))) {
    return 'matematicas';
  }
  return null;
}

function parseCctGroup(source: string): {
  cct: string;
  grade: string;
  groupLetter: string;
  vespertino: boolean;
} | null {
  const re = new RegExp(CCT_GROUP_GAP, 'gi');
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) last = m;
  if (!last) return null;
  const end = (last.index ?? 0) + last[0].length;
  const after = source.slice(end, end + 3);
  const vespertino = /^_V/i.test(after) || /^V(?:$|[^A-Z])/i.test(after);
  return {
    cct: (last[1] ?? '').toUpperCase(),
    grade: last[2] ?? '',
    groupLetter: (last[3] ?? '').toUpperCase(),
    vespertino,
  };
}

function parseCctGroupCompact(compact: string): {
  cct: string;
  grade: string;
  groupLetter: string;
  vespertino: boolean;
} | null {
  const re = new RegExp(
    `([0-9]{2}(?:${SUBSYSTEM})[0-9]{4}[A-Z])([0-9])([A-Z])(_V|V)?`,
    'gi'
  );
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(compact)) !== null) last = m;
  if (!last) return null;
  const flag = (last[4] ?? '').toUpperCase();
  return {
    cct: (last[1] ?? '').toUpperCase(),
    grade: last[2] ?? '',
    groupLetter: (last[3] ?? '').toUpperCase(),
    vespertino: flag === 'V' || flag === '_V',
  };
}

/**
 * Técnicas compactas (`RAFL26DST…1D`) y Generales con año/espacios/guion
 * (`RAFMatematicas2026-26DES0045U-1A`, `RAF Lenguaje 26DES0036M-1E`, `2RAFM26DES0036M1J`).
 */
export function parseRafPdfFileName(fileName: string): RafPdfIdentity | null {
  const folded = foldFileBase(fileName);
  if (!folded) return null;
  const compact = folded.replace(/[^A-Z0-9]/g, '');
  const subject = subjectFromRafName(folded, compact);
  if (!subject) return null;

  const loc = parseCctGroup(folded) ?? parseCctGroupCompact(compact);
  if (!loc || !loc.cct || !loc.grade || !loc.groupLetter) return null;

  const identity = {
    subject,
    cct: loc.cct,
    grade: loc.grade,
    groupLetter: loc.groupLetter,
    vespertino: loc.vespertino,
  };
  const examTitle = rafExamTitleForIdentity(identity);
  const groupKey = `${identity.cct} · ${identity.grade}-${identity.groupLetter}${identity.vespertino ? ' V' : ''}`;
  return { ...identity, groupKey, examTitle };
}

/** `Lenguaje · 26DST0076F · 1-A V` ↔ `Lenguaje · 26DST0076F · 1-A`. */
export function rafShiftSiblingExamTitle(title: string): string | null {
  const raw = title.trim();
  if (!raw) return null;
  if (/\sV$/i.test(raw)) return raw.replace(/\sV$/i, '');
  if (/[0-9][A-Z]$/i.test(raw) && raw.includes(' · ')) return `${raw} V`;
  return null;
}

/** Grupos que comparten roster: `CCT · 1-A` y `CCT · 1-A V`. */
export function rafSharedGroupNamesFromExamTitle(title: string): string[] {
  const m = title
    .trim()
    .match(/([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])\s*·\s*(\d-[A-Z])(?:\s+V)?$/i);
  if (!m) return [];
  const base = `${(m[1] ?? '').toUpperCase()} · ${(m[2] ?? '').toUpperCase()}`;
  return [base, `${base} V`];
}

export function matchRafPdfToExam<T extends { id: string; title: string }>(
  fileName: string,
  subject: RafSubject,
  exams: T[]
): T | null {
  const parsed = parseRafPdfFileName(fileName);
  if (!parsed) return null;
  if (parsed.subject !== subject) return null;
  const expected = normalizeRafTitle(parsed.examTitle);
  const hits = exams.filter((exam) => normalizeRafTitle(exam.title) === expected);
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) return hits[0]!;
  const loose = exams.filter((exam) => {
    const t = normalizeRafTitle(exam.title);
    return rafSubjectFromTitle(exam.title) === subject && t.includes(normalizeRafTitle(parsed.groupKey));
  });
  return loose[0] ?? null;
}
