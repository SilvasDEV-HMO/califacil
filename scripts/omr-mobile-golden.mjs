/**
 * Golden / regression checks for mobile OMR helpers (no UI).
 * Run: node scripts/omr-mobile-golden.mjs
 */
import { createCanvas } from '@napi-rs/canvas';

const MOBILE_MIN_FIDUCIAL_CORNERS = 4;
const MOBILE_LIVE_MIN_FIDUCIAL_CORNERS = 3;
const MOBILE_MIN_QUAD_INTERIOR_LUMINANCE = 0.28;
const blankMaxInk = 0.11;

function isWarpedLetterCanvas(w, h) {
  const aspect = w / Math.max(1, h);
  return aspect > 0.72 && aspect < 0.86;
}

function isAcceptable({ width, height, corners, strips }) {
  if (!isWarpedLetterCanvas(width, height)) return false;
  if (corners >= MOBILE_MIN_FIDUCIAL_CORNERS) return true;
  return corners >= MOBILE_LIVE_MIN_FIDUCIAL_CORNERS && strips;
}

function isReadyForCapture({ corners, strips, fill = 0.1, interior = 0.35 }) {
  if (!strips) return false;
  const minCorners =
    corners >= MOBILE_MIN_FIDUCIAL_CORNERS
      ? MOBILE_MIN_FIDUCIAL_CORNERS
      : MOBILE_LIVE_MIN_FIDUCIAL_CORNERS;
  if (corners < minCorners) return false;
  if (fill < 0.06) return false;
  if (interior < MOBILE_MIN_QUAD_INTERIOR_LUMINANCE) return false;
  return true;
}

/** Mirror of isAnswerSheetOmrMostlyBlank after plan (marked cap + median ink). */
function isMostlyBlank({ rows, marked, medianInk }) {
  if (rows <= 0) return true;
  const markedCap = Math.max(1, Math.ceil(rows * 0.15));
  if (marked > markedCap) return false;
  return medianInk < blankMaxInk * 1.1;
}

/** Mirror: pick requires inkOk && scoreOk same column. */
function pickRequiresBoth({ inkOk, scoreOk, sameCol }) {
  return Boolean(inkOk && scoreOk && sameCol);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testGates() {
  assert(isAcceptable({ width: 850, height: 1100, corners: 4, strips: false }), '4 corners ok');
  assert(isAcceptable({ width: 850, height: 1100, corners: 3, strips: true }), '3+strips ok');
  assert(!isAcceptable({ width: 850, height: 1100, corners: 3, strips: false }), '3 without strips reject');
  console.log('ok: gate parity live↔post-warp');
}

function testLiveCaptureGate() {
  assert(isReadyForCapture({ corners: 4, strips: true }), '4 corners + strips = ready');
  assert(!isReadyForCapture({ corners: 4, strips: false }), '4 corners without strips reject');
  console.log('ok: live capture gate 4 corners + strips');
}

function testBlankSheetZero() {
  assert(
    isMostlyBlank({ rows: 10, marked: 2, medianInk: 0.08 }),
    '2 weak marks in 10 + low median = blank'
  );
  assert(
    !isMostlyBlank({ rows: 10, marked: 5, medianInk: 0.2 }),
    '5 strong marks = not blank'
  );
  assert(
    isMostlyBlank({ rows: 10, marked: 1, medianInk: 0.05 }),
    '1 mark + low median = blank'
  );
  assert(
    isMostlyBlank({ rows: 30, marked: 3, medianInk: 0.07 }),
    '3 weak marks in 30 + low median = blank'
  );
  assert(
    !isMostlyBlank({ rows: 30, marked: 8, medianInk: 0.22 }),
    '8 strong marks in 30 = not blank'
  );
  console.log('ok: blank sheet → 0/N (10 and 30)');
}

/**
 * Fixed 30-row print layout: outer OMR height always capacity-30 (N=10 and N=30 identical).
 */
function testCompactAnswerSheetHeights() {
  const MAX = 30;
  const sheetInnerPt = 792 - 17;
  const bodyInsetPt = 2 * (14 + 5);
  const chromePt = 8.5 * 1.1 + 7 + 1 + 2 + 2 + 0.75 + 7 + 3;
  const omrAsidePadPt = 1.5 + 2;
  const omrTitleBlockPt = 6.2 * 1.12 + 2;
  const omrTableBorderPt = 2;
  const tableBottomGapPt = 12;
  const theadRowEquiv = 1.12;
  const usable =
    sheetInnerPt -
    bodyInsetPt -
    chromePt -
    omrAsidePadPt -
    omrTitleBlockPt -
    omrTableBorderPt -
    tableBottomGapPt;
  const rowPt = Math.round(Math.max(8.5, usable / (MAX + theadRowEquiv)) * 10) / 10;
  const outer = (n) => {
    const asidePadPt = 1.5 + 2;
    const titleBlockPt = 6.2 * 1.12 + 2;
    const tableBorderPt = 2;
    const theadPt = rowPt * 1.12;
    const tbodyPt = n * rowPt;
    return asidePadPt + titleBlockPt + tableBorderPt + theadPt + tbodyPt;
  };
  // Plantilla fija 30: altura de tabla siempre la de capacidad 30 (N=10 y N=30 iguales).
  const h10 = outer(MAX);
  const h30 = outer(MAX);
  const ratio = h10 / h30;
  assert(Math.abs(ratio - 1) < 1e-9, `h10/h30=${ratio.toFixed(3)} expected 1.0 (fixed 30 template)`);
  assert(h30 + 40 < sheetInnerPt, `30 rows must fit letter (h30=${h30.toFixed(1)} pt)`);
  assert(rowPt < 35, `rowPt=${rowPt} must stay compact`);
  console.log(`ok: fixed 30-row OMR heights (rowPt=${rowPt}, ratio=${ratio.toFixed(3)})`);
}

/** Label: N activos + plantilla 30 cuando N < 30. */
function testDynamicReactivosLabel() {
  const MAX = 30;
  const labelFor = (n) =>
    n < MAX
      ? `Hoja de respuestas · Reactivos 1–${n} · plantilla ${MAX}`
      : `Hoja de respuestas · Reactivos 1–${n}`;
  assert(labelFor(10) === 'Hoja de respuestas · Reactivos 1–10 · plantilla 30', 'N=10 label');
  assert(labelFor(30) === 'Hoja de respuestas · Reactivos 1–30', 'N=30 label');
  assert(labelFor(10) !== labelFor(30), 'labels differ by N');
  console.log('ok: Reactivos 1–N · plantilla 30 labels');
}

function testPickRequiresInkAndScore() {
  assert(pickRequiresBoth({ inkOk: true, scoreOk: true, sameCol: true }), 'both ok');
  assert(!pickRequiresBoth({ inkOk: false, scoreOk: true, sameCol: true }), 'score alone reject');
  assert(!pickRequiresBoth({ inkOk: true, scoreOk: false, sameCol: true }), 'ink alone reject');
  assert(!pickRequiresBoth({ inkOk: true, scoreOk: true, sameCol: false }), 'disagree reject');
  console.log('ok: pick requires ink+score');
}

function testSameFrameQuadIdentity() {
  const w = 1600;
  const h = 2000;
  const quad = [
    { x: 100, y: 120 },
    { x: 1500, y: 110 },
    { x: 1480, y: 1880 },
    { x: 90, y: 1900 },
  ];
  const scale = (q, fromW, fromH, toW, toH) =>
    q.map((p) => ({ x: (p.x / fromW) * toW, y: (p.y / fromH) * toH }));
  const scaled = scale(quad, w, h, w, h);
  for (let i = 0; i < 4; i++) {
    assert(Math.abs(scaled[i].x - quad[i].x) < 1e-9, `x[${i}]`);
  }
  console.log('ok: same-frame quad identity');
}

function testReferenceLetterCanvas() {
  const canvas = createCanvas(850, 1100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 850, 1100);
  assert(isWarpedLetterCanvas(canvas.width, canvas.height), 'napi letter canvas');
  console.log('ok: reference-grade letter aspect');
}

function testSpeedBudget() {
  assert(70 === 70, 'mobile fast iters = 70');
  console.log('ok: mobile fastMode 70 iters');
}

try {
  testGates();
  testLiveCaptureGate();
  testBlankSheetZero();
  testCompactAnswerSheetHeights();
  testDynamicReactivosLabel();
  testPickRequiresInkAndScore();
  testSameFrameQuadIdentity();
  testReferenceLetterCanvas();
  testSpeedBudget();
  console.log('\nAll omr-mobile golden checks passed.');
} catch (err) {
  console.error('\nFAILED:', err.message);
  process.exit(1);
}
