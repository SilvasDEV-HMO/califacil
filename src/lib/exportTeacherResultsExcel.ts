import { supabase } from '@/lib/supabase';
import { calculatePercentage } from '@/lib/utils';
import type { Exam } from '@/types';
import { fetchAllPaged } from '@/lib/supabasePaged';

type AnswerRow = {
  exam_id: string;
  student_id: string;
  question_id: string;
  is_correct: boolean | null;
  score: number | null;
};

type QuestionRow = {
  id: string;
  exam_id: string;
  sort_order: number | null;
  created_at: string;
  points: number | null;
};

type StudentRow = {
  id: string;
  name: string;
  group_id: string;
};

type GroupRow = {
  id: string;
  name: string;
};

function schoolAndGroupFromName(groupName: string): { escuela: string; grupo: string } {
  const parts = groupName.split(' · ').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { escuela: parts[0]!, grupo: parts.slice(1).join(' · ') };
  }
  return { escuela: groupName || '—', grupo: '—' };
}

/** Prefijo de CCT / subsistema: 26DES, 26DST, 26EES, 26ETV, … */
function subsystemFromCct(cctOrSchool: string): string {
  const cct = cctOrSchool.trim().toUpperCase();
  const m = cct.match(/^(\d{2}[A-Z]{3})/);
  return m?.[1] ?? 'OTROS';
}

function subjectFromExamTitle(title: string): 'Lenguaje' | 'Matemáticas' | 'Otros' {
  const t = title.trim().toLowerCase();
  if (t.startsWith('lenguaje')) return 'Lenguaje';
  if (t.startsWith('matem')) return 'Matemáticas';
  return 'Otros';
}

/** Orden preferido de hojas por subsistema (el resto alfabético). */
const SUBSYSTEM_ORDER = ['26DES', '26DST', '26EES', '26EST', '26ETV'];
const SUBJECT_ORDER = ['Lenguaje', 'Matemáticas', 'Otros'] as const;

function sheetNameFor(subsystem: string, subject: string): string {
  // Excel: máx. 31 caracteres; sin \ / ? * [ ]
  const raw = `${subsystem} ${subject}`.replace(/[\\/?*[\]:]/g, '-');
  return raw.slice(0, 31);
}

type ResultRow = {
  Alumno: string;
  Escuela: string;
  Grupo: string;
  Examen: string;
  Puntos: number;
  Máximo: number;
  'Calificación %': number;
  'Reactivos acertados': string;
  'Reactivos con error': string;
  'N.º aciertos': number;
  'N.º errores': number;
  _subsystem: string;
  _subject: string;
};

const SHEET_COLS = [
  { wch: 32 },
  { wch: 14 },
  { wch: 8 },
  { wch: 36 },
  { wch: 8 },
  { wch: 8 },
  { wch: 12 },
  { wch: 28 },
  { wch: 28 },
  { wch: 10 },
  { wch: 10 },
];

function questionNumberMap(questions: QuestionRow[]): Map<string, number> {
  const byExam = new Map<string, QuestionRow[]>();
  for (const q of questions) {
    const list = byExam.get(q.exam_id) ?? [];
    list.push(q);
    byExam.set(q.exam_id, list);
  }
  const map = new Map<string, number>();
  Array.from(byExam.values()).forEach((list) => {
    list.sort((a, b) => {
      const ao = a.sort_order;
      const bo = b.sort_order;
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return a.created_at.localeCompare(b.created_at);
    });
    list.forEach((q, i) => map.set(q.id, i + 1));
  });
  return map;
}

/**
 * Excel con resultados del maestro: alumno, escuela, calificación y reactivos OK/error.
 */
export async function downloadTeacherResultsExcel(exams: Exam[]): Promise<{ rows: number }> {
  if (exams.length === 0) {
    throw new Error('No hay exámenes para exportar.');
  }

  const examById = new Map(exams.map((e) => [e.id, e]));
  const examIds = exams.map((e) => e.id);

  const answers: AnswerRow[] = [];
  const idChunk = 80;
  for (let i = 0; i < examIds.length; i += idChunk) {
    const slice = examIds.slice(i, i + idChunk);
    const batch = await fetchAllPaged<AnswerRow>(() =>
      supabase
        .from('answers')
        .select('exam_id,student_id,question_id,is_correct,score')
        .in('exam_id', slice)
        .order('id', { ascending: true })
    );
    answers.push(...batch);
  }

  if (answers.length === 0) {
    throw new Error('Todavía no hay calificaciones guardadas.');
  }

  const questions: QuestionRow[] = [];
  for (let i = 0; i < examIds.length; i += idChunk) {
    const slice = examIds.slice(i, i + idChunk);
    const batch = await fetchAllPaged<QuestionRow>(() =>
      supabase
        .from('questions')
        .select('id,exam_id,sort_order,created_at,points')
        .in('exam_id', slice)
        .order('created_at', { ascending: true })
    );
    questions.push(...batch);
  }
  const qNum = questionNumberMap(questions);
  const maxScoreByExam = new Map<string, number>();
  for (const q of questions) {
    maxScoreByExam.set(q.exam_id, (maxScoreByExam.get(q.exam_id) ?? 0) + (q.points ?? 1));
  }

  const studentIds = Array.from(new Set(answers.map((a) => a.student_id)));
  const studentsById = new Map<string, StudentRow>();
  for (let i = 0; i < studentIds.length; i += 200) {
    const slice = studentIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('students')
      .select('id,name,group_id')
      .in('id', slice);
    if (error) throw error;
    for (const s of data || []) studentsById.set(s.id, s as StudentRow);
  }

  const groupIds = Array.from(
    new Set(Array.from(studentsById.values()).map((s) => s.group_id))
  );
  const groupsById = new Map<string, GroupRow>();
  for (let i = 0; i < groupIds.length; i += 200) {
    const slice = groupIds.slice(i, i + 200);
    const { data, error } = await supabase.from('groups').select('id,name').in('id', slice);
    if (error) throw error;
    for (const g of data || []) groupsById.set(g.id, g as GroupRow);
  }

  type Agg = {
    examId: string;
    studentId: string;
    points: number;
    correct: number[];
    wrong: number[];
  };
  const byPair = new Map<string, Agg>();

  for (const a of answers) {
    const key = `${a.exam_id}|${a.student_id}`;
    let agg = byPair.get(key);
    if (!agg) {
      agg = { examId: a.exam_id, studentId: a.student_id, points: 0, correct: [], wrong: [] };
      byPair.set(key, agg);
    }
    agg.points += typeof a.score === 'number' ? a.score : 0;
    const n = qNum.get(a.question_id);
    if (n == null) continue;
    if (a.is_correct === true) agg.correct.push(n);
    else if (a.is_correct === false) agg.wrong.push(n);
  }

  const rows: ResultRow[] = Array.from(byPair.values()).map((agg) => {
    const student = studentsById.get(agg.studentId);
    const group = student ? groupsById.get(student.group_id) : undefined;
    const { escuela, grupo } = schoolAndGroupFromName(group?.name ?? '');
    const exam = examById.get(agg.examId);
    const examTitle = exam?.title ?? '—';
    // Si el grupo no trae CCT, intentar sacarlo del título del examen.
    const cctFromExam = examTitle.split(' · ').map((p) => p.trim())[1] ?? '';
    const subsystem = subsystemFromCct(escuela !== '—' ? escuela : cctFromExam);
    const subject = subjectFromExamTitle(examTitle);
    const maxScore = Math.max(1, maxScoreByExam.get(agg.examId) ?? 1);
    const pct = calculatePercentage(agg.points, maxScore);
    const correctSorted = [...agg.correct].sort((a, b) => a - b);
    const wrongSorted = [...agg.wrong].sort((a, b) => a - b);
    return {
      Alumno: student?.name ?? '—',
      Escuela: escuela,
      Grupo: grupo,
      Examen: examTitle,
      Puntos: agg.points,
      Máximo: maxScore,
      'Calificación %': pct,
      'Reactivos acertados': correctSorted.join(', ') || '—',
      'Reactivos con error': wrongSorted.join(', ') || '—',
      'N.º aciertos': correctSorted.length,
      'N.º errores': wrongSorted.length,
      _subsystem: subsystem,
      _subject: subject,
    };
  });

  rows.sort((a, b) =>
    a.Escuela.localeCompare(b.Escuela, 'es') ||
    a.Grupo.localeCompare(b.Grupo, 'es') ||
    a.Examen.localeCompare(b.Examen, 'es') ||
    a.Alumno.localeCompare(b.Alumno, 'es')
  );

  const subsystems = Array.from(new Set(rows.map((r) => r._subsystem)));
  subsystems.sort((a, b) => {
    const ia = SUBSYSTEM_ORDER.indexOf(a);
    const ib = SUBSYSTEM_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b, 'es');
  });

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  for (const subsystem of subsystems) {
    for (const subject of SUBJECT_ORDER) {
      const sheetRows = rows.filter(
        (r) => r._subsystem === subsystem && r._subject === subject
      );
      if (sheetRows.length === 0) continue;

      const exportRows = sheetRows.map(
        ({ _subsystem: _s, _subject: _t, ...rest }) => rest
      );
      const sheet = XLSX.utils.json_to_sheet(exportRows);
      sheet['!cols'] = SHEET_COLS;

      let name = sheetNameFor(subsystem, subject);
      if (usedSheetNames.has(name)) {
        let n = 2;
        while (usedSheetNames.has(`${name.slice(0, 28)}_${n}`)) n += 1;
        name = `${name.slice(0, 28)}_${n}`;
      }
      usedSheetNames.add(name);
      XLSX.utils.book_append_sheet(wb, sheet, name);
    }
  }

  if (wb.SheetNames.length === 0) {
    throw new Error('No hubo filas para exportar.');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `resultados_califacil_${stamp}.xlsx`);
  return { rows: rows.length };
}
