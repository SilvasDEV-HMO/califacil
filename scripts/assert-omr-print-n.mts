/**
 * Verifica HTML de hoja OMR: siempre plantilla fija de 30 filas (N≤30).
 * Run: npx tsx scripts/assert-omr-print-n.mts
 */
import {
  assertFixedAnswerSheetLayoutRatios,
  buildPrintExamHtml,
  CALIFACIL_PRINT_MAX_QUESTIONS,
} from '../src/lib/printExam.ts';
import type { ExamWithQuestions, Question } from '../src/types';

function mkExam(n: number): ExamWithQuestions {
  const questions: Question[] = Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    exam_id: 'e',
    type: 'multiple_choice',
    text: `Pregunta ${i + 1}`,
    options: ['a', 'b', 'c', 'd'],
    correct_answer: 'a',
    points: 1,
    order_index: i,
  })) as Question[];
  return {
    id: 'e',
    title: 'chilo',
    questions,
  } as ExamWithQuestions;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const GRID = CALIFACIL_PRINT_MAX_QUESTIONS;

const h10 = buildPrintExamHtml(mkExam(10), { baseUrl: 'http://localhost' });
const h30 = buildPrintExamHtml(mkExam(30), { baseUrl: 'http://localhost' });

const rowsAttr = (html: string) => html.match(/data-califacil-omr-rows="(\d+)"/)?.[1];
const activeAttr = (html: string) => html.match(/data-califacil-omr-active-rows="(\d+)"/)?.[1];
const bodyRows = (html: string) => (html.match(/<tr class="omr-tr(?: omr-tr--filler)?"/g) || []).length;

assert(rowsAttr(h10) === String(GRID), `N=10 rows attr got ${rowsAttr(h10)}`);
assert(activeAttr(h10) === '10', `N=10 active rows got ${activeAttr(h10)}`);
assert(bodyRows(h10) === GRID, `N=10 tbody got ${bodyRows(h10)}`);
assert(h10.includes('plantilla 30'), 'N=10 label must mention plantilla 30');
assert(h10.includes('Reactivos 1–10'), 'N=10 label must mention reactivos 1–10');
assert(h10.includes('--omr-row-count: 30'), 'CSS var row count 30 for N=10');

assert(rowsAttr(h30) === String(GRID), `N=30 rows attr got ${rowsAttr(h30)}`);
assert(activeAttr(h30) === '30', `N=30 active rows got ${activeAttr(h30)}`);
assert(bodyRows(h30) === GRID, `N=30 tbody got ${bodyRows(h30)}`);
assert(h30.includes('Reactivos 1–30'), 'N=30 label got Reactivos 1–30');
assert(h30.includes('--omr-row-count: 30'), 'CSS var row count 30');

assertFixedAnswerSheetLayoutRatios();
console.log('ok: print HTML always 30-row template (N=10 filler + N=30 full) + fixed layout');
