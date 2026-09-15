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
import { buildCalifacilVirtualKey, CALIFACIL_PRINT_MAX_QUESTIONS, examSupportsCalifacilOmr } from '../src/lib/printExam.ts';
import { isMultipleChoiceAnswerCorrect, resolveOptionIndexFromValue } from '../src/lib/utils.ts';
import {
  isAnswerSheetOmrMostlyBlank,
  sanitizeAnswerSheetOmrMeta,
} from '../src/lib/omrScan.ts';
import { pickBetterOmrMeta } from '../src/lib/omr/unified-grade-scan.ts';
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

// Vacío nunca es acierto (evita "" === "" cuando falta clave).
assert(!isMultipleChoiceAnswerCorrect(opts4, '', ''), 'vacío/vacío = incorrecto');
assert(!isMultipleChoiceAnswerCorrect(opts4, '', null), 'vacío/null = incorrecto');
assert(!isMultipleChoiceAnswerCorrect(opts4, null, null), 'null/null = incorrecto');

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

// --- 30 preguntas en blanco → 0/30 ---
const chunk30 = Array.from({ length: 30 }, (_, i) =>
  mkMc(`q30_${i}`, opts4, opts4[i % 4]!, 1, i)
);
const key30 = buildVirtualKeyMaps(buildCalifacilVirtualKey(chunk30).rows);
const blank30 = gradeOmrChunkPicksAgainstVirtualKey(
  chunk30,
  Array.from({ length: 30 }, () => null),
  key30
);
assert(blank30.correct === 0 && blank30.total === 30 && blank30.pct === 0, 'blank 0/30');

// --- 3 picks falsos en hoja mostly-blank deben sanitizarse a 0 (no 3/30) ---
{
  const rows = 30;
  const picks: (number | null)[] = Array.from({ length: rows }, () => null);
  picks[0] = 0;
  picks[1] = 1;
  picks[2] = 2;
  const rowMetas = Array.from({ length: rows }, (_, i) => ({
    pick: picks[i],
    ambiguous: false,
    inkFractions:
      picks[i] != null
        ? [0.08, 0.05, 0.04, 0.04]
        : [0.04, 0.03, 0.03, 0.03],
  }));
  const meta = {
    picks,
    rows: rowMetas,
    needsVisionAssist: false,
    maxSameColumnCount: 3,
    geometry: null,
    reviewSourceCanvas: null,
    controlNumberDigits: [] as (number | null)[],
    controlNumber: null as string | null,
  };
  assert(isAnswerSheetOmrMostlyBlank(meta, rows), 'meta debe ser mostly-blank');
  const cleaned = sanitizeAnswerSheetOmrMeta(meta, rows);
  const resolved = cleaned.picks.filter((p) => p != null).length;
  assert(resolved === 0, `sanitize blank+3falsos → 0 picks, got ${resolved}`);
  const after = gradeOmrChunkPicksAgainstVirtualKey(chunk30, cleaned.picks, key30);
  assert(after.correct === 0 && after.pct === 0, 'tras sanitize grade 0/30');
}

// --- 5 picks débiles (caso móvil foto/pantalla) → blank → 0/30 ---
{
  const rows = 30;
  const picks: (number | null)[] = Array.from({ length: rows }, () => null);
  for (let i = 0; i < 5; i++) picks[i] = i % 4;
  const rowMetas = Array.from({ length: rows }, (_, i) => ({
    pick: picks[i],
    ambiguous: false,
    inkFractions:
      picks[i] != null
        ? [0.12, 0.06, 0.05, 0.05]
        : [0.05, 0.04, 0.04, 0.04],
  }));
  const meta = {
    picks,
    rows: rowMetas,
    needsVisionAssist: false,
    maxSameColumnCount: 2,
    geometry: null,
    reviewSourceCanvas: null,
    controlNumberDigits: [] as (number | null)[],
    controlNumber: null as string | null,
  };
  assert(isAnswerSheetOmrMostlyBlank(meta, rows), '5 picks débiles = mostly-blank');
  const cleaned = sanitizeAnswerSheetOmrMeta(meta, rows);
  assert(
    cleaned.picks.every((p) => p == null),
    '5 picks débiles sanitizados a null'
  );
  const after = gradeOmrChunkPicksAgainstVirtualKey(chunk30, cleaned.picks, key30);
  assert(after.correct === 0 && after.pct === 0, '5 falsos → 0/30');
}

// --- 1 pick "fuerte" + mediana de hoja vacía (madera/strip) → blank → 0/30 ---
{
  const rows = 30;
  const picks: (number | null)[] = Array.from({ length: rows }, () => null);
  picks[7] = 2; // coincide con clave → sería 1/30 sin sanitize
  const rowMetas = Array.from({ length: rows }, (_, i) => ({
    pick: picks[i],
    ambiguous: false,
    inkFractions:
      picks[i] != null
        ? [0.06, 0.05, 0.28, 0.05]
        : [0.045, 0.04, 0.04, 0.038],
  }));
  const meta = {
    picks,
    rows: rowMetas,
    needsVisionAssist: false,
    maxSameColumnCount: 1,
    geometry: null,
    reviewSourceCanvas: null,
    controlNumberDigits: [] as (number | null)[],
    controlNumber: null as string | null,
  };
  assert(isAnswerSheetOmrMostlyBlank(meta, rows), '1 pick fuerte + mediana ruido = mostly-blank');
  const cleaned = sanitizeAnswerSheetOmrMeta(meta, rows);
  assert(
    cleaned.picks.every((p) => p == null),
    '1 pick fuerte sanitizado a null'
  );
  const after = gradeOmrChunkPicksAgainstVirtualKey(chunk30, cleaned.picks, key30);
  assert(after.correct === 0 && after.pct === 0, '1 falso fuerte → 0/30');
}

// --- pickBetterOmrMeta: blank gana a strip con 1 pick ---
{
  const rows = 30;
  const blankMeta = {
    picks: Array.from({ length: rows }, () => null as number | null),
    rows: Array.from({ length: rows }, () => ({
      pick: null as number | null,
      ambiguous: false,
      inkFractions: [0.04, 0.03, 0.03, 0.03],
    })),
    needsVisionAssist: false,
    maxSameColumnCount: 0,
    geometry: null,
    reviewSourceCanvas: null,
    controlNumberDigits: [] as (number | null)[],
    controlNumber: null as string | null,
  };
  const stripPicks: (number | null)[] = Array.from({ length: rows }, () => null);
  stripPicks[3] = 1;
  const stripMeta = {
    picks: stripPicks,
    rows: Array.from({ length: rows }, (_, i) => ({
      pick: stripPicks[i],
      ambiguous: false,
      inkFractions:
        stripPicks[i] != null
          ? [0.05, 0.26, 0.04, 0.04]
          : [0.045, 0.04, 0.04, 0.038],
    })),
    needsVisionAssist: false,
    maxSameColumnCount: 1,
    geometry: null,
    reviewSourceCanvas: null,
    controlNumberDigits: [] as (number | null)[],
    controlNumber: null as string | null,
  };
  // stripMeta es mostly-blank por la regla sparse-fuerte; sanitize ambos a 0.
  // pickBetter: si blank vs no-blank sintético (sin pasar por mostly-blank en strip)...
  const stripNotBlank = {
    ...stripMeta,
    // Simula strip que escapa blank (muchas filas con tinta alta mediana)
    rows: Array.from({ length: rows }, (_, i) => ({
      pick: stripPicks[i],
      ambiguous: false,
      inkFractions:
        stripPicks[i] != null
          ? [0.05, 0.35, 0.04, 0.04]
          : [0.14, 0.13, 0.12, 0.12],
    })),
  };
  assert(isAnswerSheetOmrMostlyBlank(blankMeta, rows), 'blankMeta blank');
  assert(!isAnswerSheetOmrMostlyBlank(stripNotBlank, rows), 'stripNotBlank no blank');
  const chosen = pickBetterOmrMeta(blankMeta, stripNotBlank, rows);
  assert(
    chosen.picks.every((p) => p == null),
    'pickBetterOmrMeta prefiere blank sobre strip con 1 pick'
  );
}

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

// --- gate Calificar: mixtos no aptos ---
assert(examSupportsCalifacilOmr(chunk10) === true, 'solo MC debe soportar Calificar');
assert(
  examSupportsCalifacilOmr([
    mkMc('mA', opts4, 'alpha', 10, 0),
    {
      id: 'open1',
      exam_id: 'e',
      type: 'open_answer',
      text: 'explica',
      options: null,
      correct_answer: 'x',
      points: 10,
      order_index: 1,
    } as Question,
  ]) === false,
  'examen mixto no debe pasar el gate de Calificar'
);

// --- Resultados: filas fantasma abiertas (is_correct null, score 0) no diluyen ---
{
  const mcPts = 80;
  const openGhost = { is_correct: null as boolean | null, score: 0 };
  const earned = mcPts; // 8/8 MC
  let max = mcPts;
  // ghost open no suma al máximo
  if (typeof openGhost.is_correct === 'boolean') max += 20;
  assert(Math.round((earned / max) * 100) === 100, 'fantasma abierta no diluye (80/80=100)');
  // comportamiento anterior incorrecto: 80/100=80
  assert(Math.round((earned / (mcPts + 20)) * 100) === 80, 'sanity dilución antigua 80%');
}

console.log(
  'ok: calificar grading (paridad, vacío, gate mixto, 100%, blank 0/30, sanitize, puntos, muted)'
);
