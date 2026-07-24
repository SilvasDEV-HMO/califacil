/**
 * Verifica lógica de calificación MC (clave virtual, picks OMR, puntos, fillers).
 * Run: npx tsx scripts/assert-calificar-grading.mts
 */
import {
  buildVirtualKeyMaps,
  gradeMcDraftAgainstVirtualKey,
  gradeMcQuestionForPersist,
  gradeOmrChunkPicksAgainstVirtualKey,
  isMcAnswerCorrectAgainstKey,
  isMcPickCorrect,
  mapOmrPicksToMcDraftDetailed,
} from '../src/lib/calificarGrading.ts';
import { buildCalifacilVirtualKey, CALIFACIL_PRINT_MAX_QUESTIONS } from '../src/lib/printExam.ts';
import { isMultipleChoiceAnswerCorrect, resolveOptionIndexFromValue } from '../src/lib/utils.ts';
import type { Question } from '../src/types';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function mkMc(
  id: string,
  opts: string[],
  correct: string,
  points = 1,
  order = 0
): Question {
  return {
    id,
    exam_id: 'e',
    type: 'multiple_choice',
    text: id,
    options: opts,
    correct_answer: correct,
    points,
    order_index: order,
  } as Question;
}

const opts4 = ['alpha', 'beta', 'gamma', 'delta'];

// --- resolveOptionIndexFromValue / paridad ---
assert(resolveOptionIndexFromValue(opts4, 'beta') === 1, 'texto → índice');
assert(resolveOptionIndexFromValue(opts4, 'C') === 2, 'letra C → 2');
assert(resolveOptionIndexFromValue(opts4, 'A)') === 0, 'letra A) → 0');
assert(resolveOptionIndexFromValue(opts4, '2') === 1, 'número 2 → 1');
assert(resolveOptionIndexFromValue(opts4, '') === null, 'vacío → null');
assert(resolveOptionIndexFromValue(opts4, 'Z') === null, 'letra OOB → null');

assert(isMcPickCorrect(1, 1, opts4), 'pick correcto por índice');
assert(!isMcPickCorrect(1, null, opts4, ''), 'vacío = incorrecto');
assert(!isMcPickCorrect(1, 0, opts4), 'pick incorrecto');

const qParity = mkMc('qp', opts4, 'gamma');
const expectedIdx = resolveOptionIndexFromValue(opts4, 'gamma')!;
assert(expectedIdx === 2, 'clave gamma = 2');
assert(
  isMcAnswerCorrectAgainstKey(opts4, 'gamma', expectedIdx) ===
    isMultipleChoiceAnswerCorrect(opts4, 'gamma', 'gamma'),
  'paridad texto correcto'
);
assert(
  isMcAnswerCorrectAgainstKey(opts4, 'C', expectedIdx) ===
    isMultipleChoiceAnswerCorrect(opts4, 'C', 'gamma'),
  'paridad letra C'
);
assert(
  isMcAnswerCorrectAgainstKey(opts4, '', expectedIdx) ===
    isMultipleChoiceAnswerCorrect(opts4, '', 'gamma'),
  'paridad vacío'
);
assert(
  !isMcAnswerCorrectAgainstKey(opts4, 'alpha', expectedIdx) &&
    !isMultipleChoiceAnswerCorrect(opts4, 'alpha', 'gamma'),
  'paridad incorrecto'
);

// --- 10 preguntas, picks perfectos → 100%; fillers fuera del total ---
const chunk10 = Array.from({ length: 10 }, (_, i) =>
  mkMc(`q${i}`, opts4, opts4[i % 4]!, 1, i)
);
const { rows } = buildCalifacilVirtualKey(chunk10);
assert(rows.length === 10, 'clave virtual 10');
const key = buildVirtualKeyMaps(rows);
const perfectPicks = chunk10.map((_, i) => i % 4);
const perfectStats = gradeOmrChunkPicksAgainstVirtualKey(chunk10, perfectPicks, key);
assert(perfectStats.correct === 10, `perfect correct=${perfectStats.correct}`);
assert(perfectStats.total === 10, `perfect total=${perfectStats.total} (no 30)`);
assert(perfectStats.wrong === 0, 'perfect wrong=0');
assert(perfectStats.pct === 100, `perfect pct=${perfectStats.pct}`);

// Picks con filler basura en posiciones 10..29 no deben afectar (map solo usa chunk.length)
const picksWithFiller: (number | null)[] = [
  ...perfectPicks,
  ...Array.from({ length: CALIFACIL_PRINT_MAX_QUESTIONS - 10 }, () => 0),
];
const fillerStats = gradeOmrChunkPicksAgainstVirtualKey(chunk10, picksWithFiller, key);
assert(fillerStats.total === 10, 'filler ignorado: total 10');
assert(fillerStats.pct === 100, 'filler ignorado: 100%');

// --- hoja en blanco → 0/N ---
const blankPicks = Array.from({ length: 30 }, () => null);
const blankStats = gradeOmrChunkPicksAgainstVirtualKey(chunk10, blankPicks, key);
assert(blankStats.correct === 0 && blankStats.total === 10 && blankStats.pct === 0, 'blank 0/10');

// --- 1 error, puntos iguales ---
const oneWrong = [...perfectPicks];
oneWrong[0] = (oneWrong[0]! + 1) % 4;
const oneWrongStats = gradeOmrChunkPicksAgainstVirtualKey(chunk10, oneWrong, key);
assert(oneWrongStats.correct === 9 && oneWrongStats.wrong === 1, '1 error conteo');
assert(oneWrongStats.pct === 90, `1 error pct=${oneWrongStats.pct}`);

// --- puntos mixtos: draft y omr chunk deben coincidir ---
const mixed = [
  mkMc('m0', opts4, 'alpha', 1, 0),
  mkMc('m1', opts4, 'beta', 3, 1),
  mkMc('m2', opts4, 'gamma', 1, 2),
];
const mixedKey = buildVirtualKeyMaps(buildCalifacilVirtualKey(mixed).rows);
// correct, wrong, correct → earned 1+0+1=2 / max 5 → 40%
const mixedPicks: (number | null)[] = [0, 0, 2];
const omrMixed = gradeOmrChunkPicksAgainstVirtualKey(mixed, mixedPicks, mixedKey);
const draftMixed = mapOmrPicksToMcDraftDetailed(mixed, mixedPicks).draft;
const draftStats = gradeMcDraftAgainstVirtualKey(draftMixed, mixed, mixedKey);
assert(omrMixed.pct === draftStats.pct, `pct unificado omr=${omrMixed.pct} draft=${draftStats.pct}`);
assert(omrMixed.correct === draftStats.correct, 'correct unificado');
assert(omrMixed.pct === 40, `mixed pct=${omrMixed.pct}`);

// --- pick en columna muted (opción inexistente) → incorrecto ---
const q3 = [mkMc('short', ['a', 'b'], 'a')];
const shortKey = buildVirtualKeyMaps(buildCalifacilVirtualKey(q3).rows);
const mutedPick = gradeOmrChunkPicksAgainstVirtualKey(q3, [3], shortKey); // col D inexistente
assert(mutedPick.correct === 0 && mutedPick.total === 1, 'muted pick = incorrecto');

// --- persist round-trip conceptual ---
let persistCorrect = 0;
let persistEarned = 0;
let persistMax = 0;
for (let i = 0; i < mixed.length; i++) {
  const q = mixed[i]!;
  const text = draftMixed[q.id] ?? '';
  const { isCorrect, score } = gradeMcQuestionForPersist(q, text, mixedKey);
  persistMax += q.points ?? 1;
  if (isCorrect) persistCorrect++;
  persistEarned += score;
}
assert(persistCorrect === draftStats.correct, 'persist correct count');
assert(persistEarned === 2, `persist earned=${persistEarned}`);

console.log('ok: calificar grading (paridad, 100%, blank, filler, puntos, muted)');
