/**
 * Verifica HTML de hoja OMR: siempre plantilla fija de 30 filas (N≤30).
 * Run: npx tsx scripts/assert-omr-print-n.mts
 */
import {
  assertFixedAnswerSheetLayoutRatios,
  buildCalifacilAnswerSheetOmrTemplate,
  buildPrintExamHtml,
  CALIFACIL_PRINT_MAX_QUESTIONS,
  getAnswerSheetNameFieldPageRatios,
} from '../src/lib/printExam.ts';
import { buildAnswerSheetOmrGeometry } from '../src/lib/omrScan.ts';
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

// --- ratios nombre en franja superior (cabecera/meta), no en cuerpo de tabla ---
const nameRatios = getAnswerSheetNameFieldPageRatios();
const t30 = buildCalifacilAnswerSheetOmrTemplate(30);
assert(nameRatios.top > 0.015, `name.top too small: ${nameRatios.top}`);
assert(nameRatios.top < 0.12, `name.top too low (tabla?): ${nameRatios.top}`);
const bubbleBodyTop =
  t30.tableTopRatio + t30.tableHeightRatio * t30.titleStripRatioOfTable;
assert(
  nameRatios.top + nameRatios.height < bubbleBodyTop,
  `name debe quedar arriba del cuerpo A–D: nameBottom=${nameRatios.top + nameRatios.height} bubbleBodyTop=${bubbleBodyTop}`
);
assert(nameRatios.width > 0.2 && nameRatios.width < 0.7, `name.width sane: ${nameRatios.width}`);
assert(nameRatios.height > 0.008 && nameRatios.height < 0.04, `name.height sane: ${nameRatios.height}`);

// --- geometría overlay 30×4: centros de celda dentro del marco de tabla ---
const geom = buildAnswerSheetOmrGeometry(30, 4, 850, 1100);
assert(geom.cells.length === 30, `geom rows=${geom.cells.length}`);
assert(geom.cells[0]?.length === 4, `geom cols=${geom.cells[0]?.length}`);
const tableLeft = t30.tableLeftRatio;
const tableRight = t30.tableLeftRatio + t30.tableWidthRatio;
const tableTop = t30.tableTopRatio;
const tableBot = t30.tableTopRatio + t30.tableHeightRatio;
let outside = 0;
for (let r = 0; r < 30; r++) {
  for (let c = 0; c < 4; c++) {
    const cell = geom.cells[r]![c]!;
    const cx = cell.x + cell.w * 0.5;
    const cy = cell.y + cell.h * 0.5;
    if (cx < tableLeft - 0.02 || cx > tableRight + 0.02 || cy < tableTop - 0.02 || cy > tableBot + 0.02) {
      outside++;
    }
  }
}
assert(outside === 0, `celdas fuera del marco tabla: ${outside}`);

console.log('ok: print HTML always 30-row template (N=10 filler + N=30 full) + fixed layout + name/overlay geometry');
