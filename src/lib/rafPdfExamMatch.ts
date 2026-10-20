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

/** CCT + grado + letra, y turno opcional: `_V`, `V` (vespertino) o `M` (matutino). */
const CCT_TAIL =
  /^([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])([0-9])([A-Z])(?:(_V)|([VM]))?$/i;

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

/** Basename de `RAFL26DST0067Y1D.pdf` / `RAFM637426DST0057R1E_V.pdf` / `RAFM…0004M1AM.pdf`. */
export function parseRafPdfFileName(fileName: string): RafPdfIdentity | null {
  const base = fileName
    .replace(/^.*[/\\]/, '')
    .replace(/\.[^.]+$/, '')
    .trim();
  if (!base) return null;
  const upper = base.toUpperCase();
  let subject: RafSubject | null = null;
  let rest = upper;
  if (rest.startsWith('RAFL')) {
    subject = 'lenguaje';
    rest = rest.slice(4);
  } else if (rest.startsWith('RAFM')) {
    subject = 'matematicas';
    rest = rest.slice(4);
  } else {
    return null;
  }

  const found = rest.match(
    /^(.*?)([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z][0-9][A-Z](?:_V|[VM])?)$/i
  );
  if (!found) return null;
  const tail = found[2] ?? '';
  const m = tail.match(CCT_TAIL);
  if (!m || !subject) return null;

  const identity = {
    subject,
    cct: (m[1] ?? '').toUpperCase(),
    grade: m[2] ?? '',
    groupLetter: (m[3] ?? '').toUpperCase(),
    vespertino: Boolean(m[4] || (m[5] && m[5].toUpperCase() === 'V')),
  };
  const examTitle = rafExamTitleForIdentity(identity);
  const groupKey = `${identity.cct} · ${identity.grade}-${identity.groupLetter}${identity.vespertino ? ' V' : ''}`;
  return { ...identity, groupKey, examTitle };
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
