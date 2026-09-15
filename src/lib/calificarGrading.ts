import type { CalifacilVirtualKeyRow } from '@/lib/printExam';
import { calculatePercentage, questionPoints, resolveOptionIndexFromValue } from '@/lib/utils';
import type { Question } from '@/types';

export type McGradeStats = {
  pct: number;
  correct: number;
  wrong: number;
  total: number;
};

export type VirtualKeyMaps = {
  byQuestionId: Record<string, string>;
  indexByQuestionId: Record<string, number>;
};

export function buildVirtualKeyMaps(rows: CalifacilVirtualKeyRow[]): VirtualKeyMaps {
  const byQuestionId: Record<string, string> = {};
  const indexByQuestionId: Record<string, number> = {};
  for (const row of rows) {
    byQuestionId[row.questionId] = row.correctOption;
    indexByQuestionId[row.questionId] = row.correctIndex;
  }
  return { byQuestionId, indexByQuestionId };
}

/** Columna OMR 0=A, 1=B… → texto de opción impresa en la hoja. */
export function omrColumnIndexToOptionText(
  options: string[] | null | undefined,
  columnIndex: number | null | undefined
): string {
  if (columnIndex === null || columnIndex === undefined || columnIndex < 0) return '';
  const opts = options ?? [];
  if (columnIndex >= opts.length) return '';
  return String(opts[columnIndex] ?? '').trim();
}

export function resolveStudentPickIndex(
  options: string[] | null | undefined,
  answerText: string | null | undefined
): number | null {
  return resolveOptionIndexFromValue(options, answerText);
}

/** Compara respuesta del alumno contra índice de la clave (fuente de verdad del examen). */
export function isMcPickCorrect(
  expectedIndex: number,
  studentPickIndex: number | null,
  options: string[] | null | undefined,
  studentAnswerText?: string | null
): boolean {
  if (studentPickIndex !== null && studentPickIndex >= 0) {
    return studentPickIndex === expectedIndex;
  }
  const fromText = resolveOptionIndexFromValue(options, studentAnswerText);
  return fromText !== null && fromText === expectedIndex;
}

export function mapOmrPicksToMcDraft(
  chunk: Question[],
  picks: (number | null)[]
): Record<string, string> {
  return mapOmrPicksToMcDraftDetailed(chunk, picks).draft;
}

export function mapOmrPicksToMcDraftDetailed(
  chunk: Question[],
  picks: (number | null)[]
): {
  draft: Record<string, string>;
  pickIndices: (number | null)[];
  resolvedCount: number;
  unresolvedCount: number;
} {
  const draft: Record<string, string> = {};
  const pickIndices: (number | null)[] = [];
  let resolvedCount = 0;

  for (let i = 0; i < chunk.length; i++) {
    const q = chunk[i];
    if (!q) {
      pickIndices.push(null);
      continue;
    }
    const rawPick = picks[i] ?? null;
    const opts = q.options ?? [];
    const validPick =
      rawPick !== null && Number.isInteger(rawPick) && rawPick >= 0 && rawPick < opts.length
        ? rawPick
        : null;
    pickIndices.push(validPick);
    const text = omrColumnIndexToOptionText(opts, validPick);
    draft[q.id] = text;
    if (validPick !== null) resolvedCount++;
  }

  return {
    draft,
    pickIndices,
    resolvedCount,
    unresolvedCount: Math.max(0, chunk.length - resolvedCount),
  };
}

/** Índices OMR esperados por fila del chunk (desde clave virtual). */
export function expectedPicksForChunk(
  chunk: Question[],
  indexByQuestionId: Record<string, number>
): (number | null)[] {
  return chunk.map((q) => {
    const idx = indexByQuestionId[q.id];
    return idx !== undefined && idx >= 0 ? idx : null;
  });
}

export function draftSelectionsToColumnPicks(
  chunk: Question[],
  draft: Record<string, string>
): (number | null)[] {
  return chunk.map((q) => resolveStudentPickIndex(q.options, draft[q.id]?.trim() ?? ''));
}

export function gradeMcDraftAgainstVirtualKey(
  draft: Record<string, string>,
  questions: Question[],
  key: VirtualKeyMaps
): McGradeStats {
  const mcQuestions = questions.filter((q) => q.type === 'multiple_choice');
  let correctCount = 0;
  let earnedPoints = 0;
  let maxMcPoints = 0;
  let gradedTotal = 0;
  const debug = process.env.NEXT_PUBLIC_GRADING_DEBUG === 'true';

  for (const q of mcQuestions) {
    const expectedIndex = key.indexByQuestionId[q.id];
    if (expectedIndex === undefined) continue;
    gradedTotal++;
    const pts = questionPoints(q);
    maxMcPoints += pts;
    const answerText = (draft[q.id] ?? '').trim();
    const gotIdx = resolveStudentPickIndex(q.options, answerText);
    const ok = isMcPickCorrect(expectedIndex, gotIdx, q.options, answerText);
    if (ok) {
      correctCount++;
      earnedPoints += pts;
    }
    if (debug) {
      // Un solo examen de prueba: traza mínima por pregunta.
      console.info('[grading]', {
        questionId: q.id,
        student: answerText,
        expectedIndex,
        gotIdx,
        ok,
        pts: ok ? pts : 0,
        earnedPoints,
      });
    }
  }

  const total = gradedTotal;
  const wrong = Math.max(0, total - correctCount);
  const pct = maxMcPoints > 0 ? calculatePercentage(earnedPoints, maxMcPoints) : 0;
  if (debug) {
    console.info('[grading:final]', {
      formula: 'round(earnedPoints / maxMcPoints * 100)',
      earnedPoints,
      maxMcPoints,
      pct,
      correct: correctCount,
      total,
    });
  }
  return { pct, correct: correctCount, wrong, total };
}

export function gradeOmrChunkPicksAgainstVirtualKey(
  chunk: Question[],
  picks: (number | null)[],
  key: VirtualKeyMaps
): McGradeStats {
  // Misma fórmula ponderada que gradeMcDraftAgainstVirtualKey (picks → draft → puntos).
  const { draft } = mapOmrPicksToMcDraftDetailed(chunk, picks);
  return gradeMcDraftAgainstVirtualKey(draft, chunk, key);
}

/**
 * Paridad con Results/online: índice de clave + respuesta del alumno
 * (vacío / OOB / sin marca → incorrecto).
 */
export function isMcAnswerCorrectAgainstKey(
  options: string[] | null | undefined,
  studentAnswer: string | null | undefined,
  expectedIndex: number
): boolean {
  const gotIdx = resolveStudentPickIndex(options, studentAnswer);
  return isMcPickCorrect(expectedIndex, gotIdx, options, studentAnswer);
}

export function gradeMcQuestionForPersist(
  question: Question,
  answerText: string,
  key: VirtualKeyMaps
): { isCorrect: boolean | null; score: number } {
  if (question.type !== 'multiple_choice') {
    return { isCorrect: null, score: 0 };
  }
  const expectedIndex = key.indexByQuestionId[question.id];
  if (expectedIndex === undefined) {
    return { isCorrect: null, score: 0 };
  }
  const pts = questionPoints(question);
  const gotIdx = resolveStudentPickIndex(question.options, answerText);
  const isCorrect = isMcPickCorrect(expectedIndex, gotIdx, question.options, answerText);
  return { isCorrect, score: isCorrect ? pts : 0 };
}
