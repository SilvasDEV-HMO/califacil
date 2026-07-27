import type { ExamWithQuestions, Question } from '@/types';
import { resolveOptionIndexFromValue } from '@/lib/utils';

export const CALIFACIL_PRINT_MAX_QUESTIONS = 30;

/** Dígitos del número de control OMR en la hoja de respuestas (0–9 por columna). */
export const CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT = 8;

/** Si la hoja impresa incluye la cuadrícula OMR de número de control (deshabilitada: solo tabla 1–N). */
export const CALIFACIL_ANSWER_SHEET_INCLUDES_CONTROL_NUMBER = false;

/**
 * Relación ancho:alto del recuadro CaliFacil impreso (borde exterior del aside: título + tabla).
 * Calíbralo con captura real: debe coincidir con la caja `.califacil-omr` (--califacil-footer-band 76mm + padding).
 * Valor más bajo = guía más alta para un mismo ancho.
 */
export const CALIFACIL_OMR_GUIDE_ASPECT_RATIO = 2.92;

/**
 * Marco del visor en Calificar (cámara y recorte `cropCanvasToCalifacilGuideOverlay`):
 * encuadre de la **hoja carta completa** (8.5×11 in vertical), no solo del pie CaliFacil.
 * Debe coincidir con los cuadros negros de esquina impresos en cada página.
 */
export const CALIFACIL_VIEWFINDER_GUIDE = {
  /** Fracción del ancho del fotograma para el rectángulo guía */
  widthFrac: 0.88,
  /** Fracción máxima de alto del fotograma (carta vertical). */
  maxHeightFrac: 0.92,
  centerXFrac: 0.5,
  /** Centrado vertical (sin barra de obturador en móvil). */
  centerYFrac: 0.5,
  /** Relación ancho÷alto del papel (carta vertical). */
  aspectRatio: 8.5 / 11,
} as const;

/** Marco de página completa en canvas warp (incluye fiduciales de esquina). */
export const CALIFACIL_WARP_PAGE_FRAME_NORM = {
  x: 0,
  y: 0,
  w: 1,
  h: 1,
} as const;

/** Layout exclusivo de la hoja de respuestas dedicada (página 2 del PDF). */
const ANSWER_SHEET_LAYOUT = {
  cornerSizePt: 14,
  cornerGapPt: 5,
  /** Franja negra vertical izquierda (además de la derecha ya existente). */
  alignStripWidthPt: 12,
  /** Separación entre franjas/cuerpo y el borde de la tabla OMR (más aire = tabla de reactivos más pequeña). */
  tableMarginXPt: 26,
  /** Margen inferior compacto: 30 filas deben caber en 1 carta sin estirar. */
  tableMarginBottomPt: 12,
} as const;

/** Medidas del bloque OMR de número de control (8 columnas × dígitos 0–9). */
export const CALIFACIL_CONTROL_NUMBER_LAYOUT = {
  blockPadHorizPt: 3,
  blockPadTopPt: 3,
  blockPadBottomPt: 4,
  blockMarginBottomPt: 4,
  titleHeightPt: 10,
  tableHeaderPt: 9,
  cornerColFrac: 0.09,
  /** Altura de fila de burbuja (debe coincidir con `.omr-control-bubble-cell`). */
  digitRowPt: 8.8,
  digitRowDensePt: 7.6,
} as const;

/** Cabecera + meta de la hoja de respuestas (pt), según CSS `.sheet-header--omr` y `.omr-sheet-meta-row`. */
function answerSheetChromeAboveControlPt(): number {
  const headerPt = 8.5 * 1.1 + 7 + 1 + 2 + 2 + 0.75;
  const metaPt = 7 + 3;
  return Math.round((headerPt + metaPt) * 10) / 10;
}

/** Bloque de control completo: margen inferior + caja impresa. */
function answerSheetControlBlockTotalPt(denseOmr: boolean): number {
  const lay = CALIFACIL_CONTROL_NUMBER_LAYOUT;
  const digitRowPt = denseOmr ? lay.digitRowDensePt : lay.digitRowPt;
  const titlePt = denseOmr ? 6.4 : lay.titleHeightPt;
  const padTop = denseOmr ? 1 : lay.blockPadTopPt;
  const padBot = denseOmr ? 2 : lay.blockPadBottomPt;
  const marginBot = denseOmr ? 2 : lay.blockMarginBottomPt;
  const borderPt = 1.25 * 2;
  const blockInner =
    padTop + padBot + borderPt + titlePt + 2 + lay.tableHeaderPt + 10 * digitRowPt;
  return marginBot + blockInner;
}

/**
 * Alto de fila compacto: siempre el de capacidad 30 (nunca estira N<30 a página completa).
 * Examen de 10 → 10 filas pequeñas; de 30 → 30 filas en 1 carta.
 */
function answerSheetCompactRowHeightPt(_rowCount?: number): number {
  return answerSheetCapacityRowHeightPt();
}

/** Alto de fila cuando la hoja está llena al máximo (30 reactivos). */
function answerSheetCapacityRowHeightPt(): number {
  return answerSheetFillRowHeightPt(CALIFACIL_PRINT_MAX_QUESTIONS);
}

/** Alto exterior de `.califacil-omr` (borde a borde) para N filas compactas. */
function answerSheetCalifacilOmrOuterHeightPt(rowCount: number): number {
  const rows = Math.min(CALIFACIL_PRINT_MAX_QUESTIONS, Math.max(1, Math.round(rowCount)));
  const rowPt = answerSheetCompactRowHeightPt(rows);
  const asidePadPt = 1.5 + 2;
  const titleBlockPt = 6.2 * 1.12 + 2;
  const tableBorderPt = 2;
  const theadPt = rowPt * 1.12;
  const tbodyPt = rows * rowPt;
  return Math.round((asidePadPt + titleBlockPt + tableBorderPt + theadPt + tbodyPt) * 10) / 10;
}

export type CalifacilVirtualKeyRow = {
  questionId: string;
  questionNumber: number;
  options: string[];
  correctIndex: number;
  correctOption: string;
};

/**
 * Construye una "clave virtual" determinista del examen para comparar contra la lectura OMR.
 * Esta simulación usa exactamente el texto/opciones guardadas en BD.
 */
export function buildCalifacilVirtualKey(questions: Question[]): {
  rows: CalifacilVirtualKeyRow[];
  issues: string[];
} {
  const rows: CalifacilVirtualKeyRow[] = [];
  const issues: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.type !== 'multiple_choice') continue;
    const optsRaw = q.options ?? [];
    const correctIndex = resolveOptionIndexFromValue(optsRaw, q.correct_answer);
    if (correctIndex === null) {
      issues.push(`La pregunta ${i + 1} no tiene respuesta correcta válida dentro de sus opciones.`);
      continue;
    }
    const options = optsRaw.map((opt) => String(opt).trim());
    const correctOption = options[correctIndex] ?? '';
    rows.push({
      questionId: q.id,
      questionNumber: i + 1,
      options,
      correctIndex,
      correctOption,
    });
  }
  return { rows, issues };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Normaliza opciones desde jsonb/array/string para impresión y OMR. */
export function normalizeQuestionOptions(options: Question['options'] | unknown): string[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((o) => String(o).trim()).filter(Boolean);
  }
  if (typeof options === 'string') {
    try {
      const parsed = JSON.parse(options) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((o) => String(o).trim()).filter(Boolean);
      }
    } catch {
      /* texto plano */
    }
    const trimmed = options.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

/** Pregunta calificable con burbujas OMR (opción múltiple con ≥2 opciones). */
export function isGradableMultipleChoiceQuestion(q: Question): boolean {
  if (q.type === 'open_answer') return false;
  return normalizeQuestionOptions(q.options).length >= 2;
}

function questionBlock(
  q: Question,
  index: number,
  includeAnswerKey: boolean
): string {
  const n = index + 1;
  const text = escapeHtml(q.text);
  let body = '';

  if (isGradableMultipleChoiceQuestion(q)) {
    const options = normalizeQuestionOptions(q.options);
    const inlineOptions = options
      .map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const isCorrect = includeAnswerKey && opt === q.correct_answer;
        const mark = isCorrect ? ' <strong>(correcta)</strong>' : '';
        return `<span class="opt-inline-item"><span class="opt-letter">${letter}.</span> ${escapeHtml(opt)}${mark}</span>`;
      })
      .join('');
    body = `<p class="opt-inline">${inlineOptions}</p>`;
  } else {
    body =
      '<div class="open-lines">' +
      Array.from({ length: 2 }, () => '<div class="write-line"></div>').join('') +
      '</div>';
  }

  return `
    <div class="question">
      <p class="q-num"><strong>${n}.</strong> ${text}</p>
      ${body}
    </div>`;
}

export function chunkQuestions<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Examen apto para impresión con hoja CaliFacil (OMR) y para la página Calificar. */
/**
 * Calificar exige examen 100 % opción múltiple (2–5 opciones).
 * Un `some()` previo dejaba pasar mixtos: la nota OMR (solo MC) se diluía
 * en Resultados al dividir entre el máximo del examen completo.
 */
export function examSupportsCalifacilOmr(questions: Question[]): boolean {
  if (!questions.length) return false;
  return questions.every((q) => {
    if (!isGradableMultipleChoiceQuestion(q)) return false;
    return normalizeQuestionOptions(q.options).length <= 5;
  });
}

/**
 * Preguntas MC que van a la hoja de bolitas / Calificar (mismo orden).
 * Una hoja carta soporta hasta {@link CALIFACIL_PRINT_MAX_QUESTIONS} filas.
 */
export function getCalifacilOmrSheetQuestions(questions: Question[]): Question[] {
  return questions.filter(isGradableMultipleChoiceQuestion);
}

export function califacilOmrColumnCount(questions: Question[]): number {
  const mc = getCalifacilOmrSheetQuestions(questions);
  if (!mc.length) return 0;
  return Math.min(
    5,
    Math.max(...mc.map((q) => Math.min(5, normalizeQuestionOptions(q.options).length)))
  );
}

/** Cuadrícula OMR para número de control: 8 columnas × dígitos 0–9. */
function answerSheetControlNumberHtml(
  digitCount = CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT
): string {
  const cols = Math.max(1, Math.min(12, Math.round(digitCount)));
  const colHeaders: string[] = [];
  for (let c = 0; c < cols; c++) {
    colHeaders.push(`<th class="omr-control-col-head" scope="col">${c + 1}</th>`);
  }
  const digitRows: string[] = [];
  for (let d = 0; d <= 9; d++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(
        `<td class="omr-control-bubble-cell"><div class="omr-bubble-wrap"><span class="omr-bubble omr-bubble--control" aria-label="Dígito ${d}, posición ${c + 1}" title="Dígito ${d}"></span></div></td>`
      );
    }
    digitRows.push(
      `<tr class="omr-control-tr"><th class="omr-control-digit" scope="row">${d}</th>${cells.join('')}</tr>`
    );
  }
  return `
    <div class="omr-control-block" aria-label="Número de control">
      <p class="omr-control-title">N.º de control — marca <strong>un círculo por columna</strong> (dígitos 0–9)</p>
      <table class="omr-control-table" data-califacil-control-digits="${cols}" data-califacil-control-rows="10">
        <thead>
          <tr class="omr-control-tr omr-control-tr--head">
            <th class="omr-control-corner" scope="col"><span class="omr-control-corner-label">Dígito</span></th>
            ${colHeaders.join('')}
          </tr>
        </thead>
        <tbody>${digitRows.join('')}</tbody>
      </table>
    </div>`;
}

/**
 * Tabla OMR de hoja de respuestas: siempre 30 filas (plantilla fija).
 * Filas 1..N = preguntas reales; N+1..30 = filler con las mismas bolitas (sin pregunta).
 */
function answerSheetOmrTableHtml(
  questions: Question[],
  omrCols: number,
  questionOffset = 0
): string {
  const activeCount = Math.min(CALIFACIL_PRINT_MAX_QUESTIONS, questions.length);
  const rowCount = CALIFACIL_PRINT_MAX_QUESTIONS;
  const headerCells: string[] = [
    `<th class="omr-qnum omr-th" scope="col"><span class="omr-th-num">N.º</span></th>`,
  ];
  for (let c = 0; c < omrCols; c++) {
    const letter = String.fromCharCode(65 + c);
    headerCells.push(
      `<th class="omr-bubble-cell omr-th" scope="col"><span class="omr-th-letter">${letter}</span></th>`
    );
  }
  const thead = `<thead><tr class="omr-tr omr-tr--head">${headerCells.join('')}</tr></thead>`;

  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const qNum = questionOffset + i + 1;
    const q = i < activeCount ? questions[i] : undefined;
    const isActive = !!q && isGradableMultipleChoiceQuestion(q);
    const nOpts = isActive
      ? Math.min(omrCols, normalizeQuestionOptions(q!.options).length)
      : omrCols;
    const cells: string[] = [];
    for (let c = 0; c < omrCols; c++) {
      const letter = String.fromCharCode(65 + c);
      if (c < nOpts) {
        cells.push(
          `<td class="omr-bubble-cell"><div class="omr-bubble-wrap"><span class="omr-bubble" aria-label="Opción ${letter}" title="Opción ${letter}"></span></div></td>`
        );
      } else {
        cells.push(`<td class="omr-bubble-cell omr-bubble-cell--muted"></td>`);
      }
    }
    const fillerClass = isActive ? '' : ' omr-tr--filler';
    rows.push(
      `<tr class="omr-tr${fillerClass}"${isActive ? '' : ' data-omr-filler="1"'}><td class="omr-qnum">${qNum}</td>${cells.join('')}</tr>`
    );
  }
  return `
    <aside class="califacil-omr" aria-label="Zona CaliFacil">
      <p class="omr-title">Marca <strong>un círculo</strong> por reactivo con bolígrafo <strong>azul o negro</strong> (tinta oscura).</p>
      <table class="omr-table" data-califacil-omr-cols="${omrCols}" data-califacil-omr-rows="${rowCount}" data-califacil-omr-active-rows="${activeCount}" data-califacil-omr-version="10">
        ${thead}
        <tbody>${rows.join('')}</tbody>
      </table>
    </aside>`;
}

function califacilOmrTableHtml(
  questions: Question[],
  omrCols: number
): string {
  const rowCount = questions.length;
  const headerCells: string[] = [
    `<th class="omr-qnum omr-th" scope="col"><span class="omr-th-num">N.º</span></th>`,
  ];
  for (let c = 0; c < omrCols; c++) {
    const letter = String.fromCharCode(65 + c);
    headerCells.push(
      `<th class="omr-bubble-cell omr-th" scope="col"><span class="omr-th-letter">${letter}</span></th>`
    );
  }
  const thead = `<thead><tr class="omr-tr omr-tr--head">${headerCells.join('')}</tr></thead>`;

  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const q = questions[i];
    const qNum = i + 1;
    if (!q || !isGradableMultipleChoiceQuestion(q)) {
      rows.push(
        `<tr class="omr-tr omr-tr--inactive"><td class="omr-qnum">${qNum}</td><td class="omr-inactive" colspan="${omrCols}">—</td></tr>`
      );
      continue;
    }
    const nOpts = Math.min(omrCols, normalizeQuestionOptions(q.options).length);
    const cells: string[] = [];
    for (let c = 0; c < omrCols; c++) {
      const letter = String.fromCharCode(65 + c);
      if (c < nOpts) {
        cells.push(
          `<td class="omr-bubble-cell"><div class="omr-bubble-wrap"><span class="omr-square" aria-label="Opción ${letter}" title="Opción ${letter}"></span></div></td>`
        );
      } else {
        cells.push(`<td class="omr-bubble-cell omr-bubble-cell--muted"></td>`);
      }
    }
    rows.push(`<tr class="omr-tr"><td class="omr-qnum">${qNum}</td>${cells.join('')}</tr>`);
  }
  return `
    <aside class="califacil-omr" aria-label="Zona CaliFacil">
      <p class="omr-title">Marca <strong>un cuadrado</strong> por reactivo con bolígrafo <strong>azul o negro</strong> (tinta oscura).</p>
      <table class="omr-table" data-califacil-omr-cols="${omrCols}" data-califacil-omr-rows="${rowCount}" data-califacil-omr-version="3">
        ${thead}
        <tbody>${rows.join('')}</tbody>
      </table>
    </aside>`;
}

const PRINT_STYLES = `    @page { size: letter; margin: 3mm 4mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 9pt;
      line-height: 1.15;
      color: #111;
      margin: 0;
      padding: 0;
    }
    .print-page {
      max-width: 7in;
      margin: 0 auto;
      position: relative;
      display: block;
      page-break-after: auto;
      break-after: auto;
    }
    /** Referencia al fotografiar con el móvil: alinear con el marco de cámara (hoja carta completa). */
    .sheet-align-corner {
      position: absolute;
      width: 6pt;
      height: 6pt;
      background: #000;
      z-index: 6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet-align-corner--tl { top: 0; left: 0; }
    .sheet-align-corner--tr { top: 0; right: 0; }
    .sheet-align-corner--bl { bottom: 0; left: 0; }
    .sheet-align-corner--br { bottom: 0; right: 0; }
    /**
     * Chromium suele partir el impreso entre Hermanos flex (preguntas vs OMR) y mandar sólo CaliFacil a la hoja siguiente.
     * El aside OMR está position:absolute al fondo de .print-page-omr-bundle (misma altura física estable + break-inside: avoid).
     * .print-page-fill sigue en flex column para que el bloque de preguntas ocupe el hueco restante; padding-bottom reserva la franja del pie.
     */
    .print-page--with-omr {
      --sheet-inner-height: calc(11in - 8mm);
      --califacil-footer-band: 76mm;
      --omr-bottom-gap: 3mm;
      overflow: visible;
    }
    .print-page-omr-bundle {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: var(--sheet-inner-height);
      min-height: var(--sheet-inner-height);
      max-height: var(--sheet-inner-height);
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    .print-page-top {
      flex: 0 0 auto;
    }
    .print-page-fill {
      flex: 1 1 0;
      min-height: 0;
      overflow: hidden;
      box-sizing: border-box;
      padding-bottom: calc(var(--califacil-footer-band) + var(--omr-bottom-gap));
    }
    .print-page--with-omr .print-page-fill .questions-block {
      overflow: hidden;
      max-height: 100%;
    }
    .print-page-omr-bundle > .califacil-omr {
      position: absolute;
      left: 0;
      right: 0;
      bottom: var(--omr-bottom-gap);
      margin: 0;
      height: var(--califacil-footer-band);
      min-height: var(--califacil-footer-band);
      width: auto;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page--with-omr .print-page-omr-bundle .omr-title {
      flex-shrink: 0;
    }
    .print-page--with-omr .print-page-omr-bundle .omr-table {
      flex: 1 1 auto;
      min-height: 0;
    }
    .print-page--with-omr .meta-grid {
      margin-bottom: 10pt;
    }
    .print-page--with-omr .question {
      margin-bottom: 2.5pt;
    }
    .print-page--with-omr .question + .question {
      padding-top: 2pt;
    }
    .print-page--with-omr .q-num {
      font-size: 8pt;
      line-height: 1.12;
    }
    .print-page--with-omr .opt-inline {
      font-size: 7.2pt;
      line-height: 1.14;
    }
    .print-page--break {
      page-break-after: always;
      break-after: page;
    }
    /** Hoja dedicada solo a la tabla de respuestas CaliFacil (separada de las preguntas). */
    .print-page--omr-only {
      --sheet-inner-height: calc(11in - 6mm);
      --corner-size: 14pt;
      --corner-gap: 5pt;
      --align-strip-width: 12pt;
      --omr-table-margin-x: 26pt;
      --omr-table-margin-bottom: 12pt;
      --omr-body-inset: calc(var(--corner-size) + var(--corner-gap));
      position: relative;
      width: 100%;
      max-width: none;
      min-height: var(--sheet-inner-height);
      height: var(--sheet-inner-height);
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .print-page--omr-first {
      page-break-before: always;
      break-before: page;
    }
    /** Cuadros negros de alineación en las esquinas del papel (fuera de la tabla). */
    .print-page--omr-only .sheet-align-corner {
      width: var(--corner-size);
      height: var(--corner-size);
      z-index: 10;
    }
    .print-page--omr-only .sheet-align-corner--tl { top: 0; left: 0; }
    .print-page--omr-only .sheet-align-corner--tr { top: 0; right: 0; }
    .print-page--omr-only .sheet-align-corner--bl { bottom: 0; left: 0; }
    .print-page--omr-only .sheet-align-corner--br { bottom: 0; right: 0; }
    .print-page--omr-only .sheet-align-strip-left,
    .print-page--omr-only .sheet-align-strip-right {
      position: absolute;
      top: var(--omr-body-inset);
      width: var(--align-strip-width);
      height: calc(100% - 2 * var(--omr-body-inset));
      background: #000;
      z-index: 10;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page--omr-only .sheet-align-strip-left {
      left: 0;
    }
    .print-page--omr-only .sheet-align-strip-right {
      right: 0;
    }
    .print-page--omr-only .print-page-omr-sheet-body {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: auto;
      height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
      max-height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
      min-height: 0;
      margin: var(--omr-body-inset);
      margin-left: calc(var(--omr-body-inset) + var(--align-strip-width) + var(--corner-gap));
      margin-right: calc(var(--omr-body-inset) + var(--align-strip-width) + var(--corner-gap));
      overflow: visible;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    .print-page--omr-answer-sheet .sheet-header--omr {
      flex: 0 0 auto;
      margin-bottom: 2pt;
      padding-bottom: 2pt;
      border-bottom: 0.75pt solid #000;
    }
    .print-page--omr-answer-sheet .sheet-header--omr .header-exam-title {
      font-size: 8.5pt;
      line-height: 1.1;
    }
    .print-page--omr-answer-sheet .sheet-header--omr .omr-sheet-label {
      font-size: 7pt;
      font-weight: bold;
      margin-top: 1pt;
      color: #333;
    }
    .omr-sheet-meta-row {
      flex: 0 0 auto;
      display: flex;
      flex-direction: row;
      align-items: flex-end;
      gap: 10pt;
      margin: 0 0 3pt;
      font-size: 6.8pt;
    }
    .omr-meta-field {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      align-items: flex-end;
      gap: 3pt;
    }
    .omr-meta-field--short {
      flex: 0 0 22%;
      max-width: 22%;
    }
    .omr-meta-field label {
      flex: 0 0 auto;
      font-weight: bold;
      white-space: nowrap;
    }
    .omr-meta-field .meta-line {
      flex: 1 1 auto;
      min-height: 7pt;
      margin-top: 0;
      border-bottom: 0.75pt solid #000;
    }
    .omr-control-block {
      flex: 0 0 auto;
      margin: 0 0 4pt;
      padding: 3pt 3pt 4pt;
      border: 1.25pt solid #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .omr-control-title {
      margin: 0 0 2pt;
      font-size: 6.5pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.12;
    }
    .omr-control-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 6pt;
    }
    .omr-control-tr--head .omr-control-corner,
    .omr-control-tr--head .omr-control-col-head {
      border: 0.75pt solid #000;
      background: #d8d8d8;
      font-weight: 800;
      padding: 1pt;
      text-align: center;
      vertical-align: middle;
      height: 9pt;
    }
    .omr-control-corner {
      width: 9%;
    }
    .omr-control-corner-label {
      font-size: 5.5pt;
    }
    .omr-control-col-head {
      font-size: 6pt;
    }
    .omr-control-digit {
      width: 9%;
      border: 0.75pt solid #000;
      background: #efefef;
      font-size: 6pt;
      font-weight: bold;
      text-align: center;
      vertical-align: middle;
      padding: 0;
    }
    .omr-control-bubble-cell {
      border: 0.75pt solid #000;
      padding: 0;
      text-align: center;
      vertical-align: middle;
      height: 8.8pt;
    }
    .omr-control-tr:nth-child(2n) .omr-control-bubble-cell {
      background: #faf8f5;
    }
    .omr-control-tr:nth-child(2n) .omr-control-digit {
      background: #e8e8e8;
    }
    .omr-bubble--control {
      width: 7pt;
      height: 7pt;
      min-width: 0;
      min-height: 0;
      border: 0.85pt solid #000;
      border-radius: 50%;
      background: #fff;
      box-sizing: border-box;
      display: inline-block;
    }
    /** Tabla OMR compacta: altura = N filas (no estira a llenar la carta). */
    .print-page--omr-answer-sheet .califacil-omr {
      position: relative;
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: auto;
      max-height: none;
      width: calc(100% - 2 * var(--omr-table-margin-x));
      margin: 0 auto var(--omr-table-margin-bottom);
      padding: 1.5pt 2pt 2pt;
      border: 1.5pt solid #000;
      border-radius: 0;
      background: #fff;
      overflow: visible;
      z-index: 2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page--omr-answer-sheet .omr-title {
      flex: 0 0 auto;
      font-size: 6.2pt;
      margin: 0 0 2pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.12;
    }
    .print-page--omr-answer-sheet .omr-table {
      flex: 0 0 auto;
      width: 100%;
      min-height: 0;
      height: auto;
      font-size: 7.2pt;
      border: 1pt solid #000;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .print-page--omr-answer-sheet tbody tr.omr-tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .print-page--omr-answer-sheet .omr-tr--head .omr-th {
      border: 0.75pt solid #000;
      background: #d8d8d8;
      color: #000;
      font-weight: 800;
      padding: 1pt 2pt;
      vertical-align: middle;
      height: calc(var(--omr-row-pt, 10pt) * 1.12);
    }
    .print-page--omr-answer-sheet tbody .omr-tr .omr-qnum {
      width: 9%;
      border: 0.75pt solid #000;
      background: #efefef;
      font-size: 7pt;
      padding: 0 2pt;
      font-weight: bold;
      text-align: right;
      vertical-align: middle;
    }
    .print-page--omr-answer-sheet tbody .omr-tr .omr-bubble-cell {
      border: 0.75pt solid #000;
      background: #fff;
      padding: 0;
      vertical-align: middle;
      text-align: center;
    }
    .print-page--omr-answer-sheet tbody .omr-tr:nth-child(2n) .omr-bubble-cell {
      background: #faf8f5;
    }
    .print-page--omr-answer-sheet tbody .omr-tr:nth-child(2n) .omr-qnum {
      background: #e8e8e8;
    }
    .print-page--omr-answer-sheet tbody .omr-tr {
      height: var(--omr-row-pt, 10pt);
    }
    .print-page--omr-answer-sheet .omr-bubble-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      height: 100%;
    }
    .print-page--omr-answer-sheet .omr-bubble {
      width: var(--omr-bubble-pt, 8pt);
      height: var(--omr-bubble-pt, 8pt);
      min-width: 0;
      min-height: 0;
      border: 0.85pt solid #000;
      border-radius: 50%;
      background: #fff;
      box-sizing: border-box;
    }
    .print-page--omr-answer-sheet .omr-square {
      width: var(--omr-square-pt, 10pt);
      height: var(--omr-square-pt, 10pt);
      min-width: 0;
      min-height: 0;
      border: 1pt solid #000;
      border-radius: 0;
      background: #fff;
      box-sizing: border-box;
    }
    .print-page--omr-answer-sheet .omr-th-letter {
      font-size: 8.5pt;
    }
    .print-page--omr-answer-sheet .omr-th-num {
      font-size: 6.8pt;
    }
    /** 16–30 reactivos: tipografía un poco más compacta; filas siguen --omr-row-pt calculado. */
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-title {
      font-size: 5.8pt;
      margin-bottom: 1pt;
      line-height: 1.1;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-table {
      font-size: 6.6pt;
      flex: 0 0 auto;
      height: auto;
      min-height: 0;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr tbody .omr-tr .omr-qnum {
      font-size: calc(var(--omr-row-pt, 10pt) * 0.58);
      padding: 0 1.5pt;
      line-height: 1;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-th-letter {
      font-size: calc(var(--omr-row-pt, 10pt) * 0.68);
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-control-block {
      margin-bottom: 2pt;
      padding: 1pt 2pt 2pt;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-control-title {
      font-size: 5.4pt;
      margin-bottom: 1pt;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-control-bubble-cell {
      height: 7.6pt;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-bubble--control {
      width: 6pt;
      height: 6pt;
    }
    .print-page--questions-only .question {
      margin-bottom: 5pt;
    }
    .print-page--questions-only .q-num {
      font-size: 8.5pt;
      line-height: 1.16;
    }
    .print-page--questions-only .opt-inline {
      font-size: 8pt;
      line-height: 1.18;
    }
    /** Una sola hoja con todas las preguntas (hasta 30). */
    .print-page--all-questions {
      --sheet-inner-height: calc(11in - 6mm);
      page-break-after: always;
      break-after: page;
      max-width: none;
      width: 100%;
      min-height: var(--sheet-inner-height);
      height: var(--sheet-inner-height);
    }
    .print-page--all-questions .print-page-questions-body {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: 100%;
      min-height: var(--sheet-inner-height);
      height: var(--sheet-inner-height);
    }
    .print-page--all-questions .sheet-header {
      flex: 0 0 auto;
      margin-bottom: 6pt;
      padding-bottom: 4pt;
      border-bottom: 0.75pt solid #222;
    }
    .print-page--all-questions .header-exam-title {
      font-size: 10pt;
      letter-spacing: 0.01em;
    }
    .print-page--all-questions .header-exam-range {
      font-size: 7.5pt;
      color: #444;
      margin-top: 1pt;
    }
    .print-page--all-questions .meta-grid {
      flex: 0 0 auto;
      margin-bottom: 10pt;
    }
    .print-page--all-questions .print-chunk {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .print-page--all-questions .questions-block {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 0;
    }
    .print-page--all-questions .question {
      margin-bottom: 0;
      flex: 0 0 auto;
    }
    .print-page--all-questions .question + .question {
      padding-top: 0;
      border-top: none;
    }
    .print-page--all-questions .q-num {
      font-size: 7.2pt;
      line-height: 1.14;
      margin-bottom: 1.5pt;
    }
    .print-page--all-questions .opt-inline {
      font-size: 6.8pt;
      line-height: 1.15;
      margin-left: 6pt;
      margin-top: 1pt;
    }
    .print-page--all-questions .opt-inline-item {
      margin-right: 7pt;
      margin-bottom: 0;
    }
    .print-page--dense-questions .q-num {
      font-size: 6.6pt;
      line-height: 1.12;
    }
    .print-page--dense-questions .opt-inline {
      font-size: 6.4pt;
      line-height: 1.13;
    }
    .omr-sheet-meta {
      display: grid;
      grid-template-columns: minmax(0, 2.35fr) minmax(0, 0.55fr) minmax(0, 1.1fr);
      gap: 2pt 6pt;
      margin: 0 0 10pt;
      font-size: 7pt;
    }
    .omr-sheet-meta label { font-weight: bold; }
    .omr-sheet-label {
      font-size: 8pt;
      font-weight: bold;
      margin: 2pt 0 0;
      color: #222;
    }
    /* Siguientes bloques de 10 reactivos: nueva hoja fiable en todos los navegadores */
    .print-page--continuation {
      page-break-before: always;
      break-before: page;
    }
    .print-chunk {
      display: block;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
    .sheet-header {
      display: flex;
      flex-direction: column;
      gap: 2pt;
      border-bottom: 1px solid #000;
      padding-bottom: 2pt;
      margin-bottom: 2pt;
    }
    .sheet-header-text {
      width: 100%;
      min-width: 0;
      text-align: right;
    }
    .header-exam-title {
      font-size: 9pt;
      font-weight: bold;
      margin: 0;
      line-height: 1.1;
    }
    .header-exam-range {
      font-size: 8pt;
      font-weight: bold;
      margin: 2pt 0 0;
      color: #333;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: minmax(0, 2.35fr) minmax(0, 0.55fr) minmax(0, 1.1fr);
      gap: 2pt 6pt;
      margin-top: 3pt;
      margin-bottom: 18pt;
      font-size: 7pt;
    }
    .meta-grid label { font-weight: bold; }
    .meta-line {
      border-bottom: 1px solid #000;
      min-height: 9pt;
      margin-top: 2pt;
    }
    .questions-block { margin-top: 0; }
    .question { margin-bottom: 4pt; page-break-inside: avoid; break-inside: avoid-page; }
    .question + .question {
      border-top: 0.6pt solid #e3e3e3;
      padding-top: 3pt;
    }
    .question--placeholder .q-num { color: #777; }
    .q-num { margin: 0 0 1pt; text-align: justify; font-size: 8.2pt; line-height: 1.14; }
    .opt-letter { font-weight: bold; }
    .opt-inline {
      margin: 0 0 0 8pt;
      font-size: 7.5pt;
      line-height: 1.16;
      text-align: left;
    }
    .opt-inline-item {
      display: inline-block;
      margin-right: 10pt;
      margin-bottom: 1pt;
      max-width: 100%;
      vertical-align: top;
    }
    .open-lines { margin-top: 1pt; margin-left: 5pt; }
    .write-line {
      border-bottom: 1px solid #333;
      min-height: 7pt;
      margin-bottom: 2pt;
    }
    .footer-note {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 1pt;
      margin-top: 0;
      font-size: 6.5pt;
      text-align: center;
      color: #666;
      border-top: 0;
      padding-top: 1pt;
    }
    .empty-note { font-size: 9pt; color: #666; font-style: italic; }
    .califacil-omr {
      position: relative;
      margin: 0;
      padding: 2.5pt 4pt 3pt;
      border: 1.7pt solid #000;
      break-inside: avoid-page;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .omr-title {
      font-size: 6pt;
      font-weight: bold;
      text-align: center;
      margin: 0 0 2pt;
      line-height: 1.15;
    }
    .omr-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 7pt;
      border: 1pt solid #000;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
    .omr-tr--head .omr-th {
      font-weight: 800;
      text-align: center;
      vertical-align: middle;
      padding: 1.6pt 2pt;
      border: 0.8pt solid #000;
      background: #d8d8d8;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .omr-tr--head .omr-qnum.omr-th {
      text-align: center;
      background: #c8c8c8;
    }
    .omr-th-letter {
      font-size: 8.4pt;
      letter-spacing: 0.02em;
    }
    .omr-th-num {
      font-size: 6.6pt;
    }
    .omr-tr--inactive .omr-inactive {
      text-align: center;
      font-style: italic;
      color: #888;
      padding: 2pt;
    }
    .omr-qnum {
      width: 9%;
      font-weight: bold;
      text-align: right;
      padding: 1.4pt 3pt 1.4pt 2pt;
      vertical-align: middle;
      border: 0.8pt solid #000;
      background: #efefef;
      font-size: 7pt;
    }
    .omr-bubble-cell {
      text-align: center;
      vertical-align: middle;
      padding: 1.2pt 2.5pt;
      border: 0.8pt solid #000;
    }
    .omr-bubble-cell--muted {
      background: #ebebeb;
    }
    .omr-bubble-wrap {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      min-height: 9pt;
    }
    .omr-square {
      width: 9pt;
      height: 9pt;
      min-width: 9pt;
      min-height: 9pt;
      border: 1pt solid #000;
      border-radius: 1.2pt;
      background: #fff;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tbody .omr-tr:nth-child(2n) .omr-bubble-cell {
      background: #faf8f5;
    }
    tbody .omr-tr:nth-child(2n) .omr-qnum {
      background: #e8e8e8;
    }
    thead {
      display: table-header-group;
    }
    tbody tr.omr-tr {
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    @media print {
      body { max-width: none; }
      .no-print { display: none; }
      .print-page--all-questions,
      .print-page--all-questions .print-page-questions-body {
        height: var(--sheet-inner-height);
        min-height: var(--sheet-inner-height);
      }
      .print-page--all-questions .questions-block {
        justify-content: space-between;
      }
      .print-page--with-omr .print-page-omr-bundle {
        height: var(--sheet-inner-height);
        min-height: var(--sheet-inner-height);
        max-height: var(--sheet-inner-height);
        overflow: hidden;
      }
      .print-page--with-omr .print-page-fill,
      .print-page--with-omr .print-page-fill .questions-block {
        overflow: hidden;
      }
      .print-page--omr-only {
        height: var(--sheet-inner-height);
        min-height: var(--sheet-inner-height);
        max-height: var(--sheet-inner-height);
        overflow: hidden;
      }
      .print-page--omr-only .print-page-omr-sheet-body {
        height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
        max-height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
        overflow: visible;
      }
      .print-page--omr-answer-sheet .califacil-omr {
        flex: 0 0 auto;
        min-height: 0;
        height: auto;
        max-height: none;
        overflow: visible;
        display: flex;
        flex-direction: column;
      }
      .print-page--omr-answer-sheet .omr-table {
        flex: 0 0 auto;
        height: auto;
        min-height: 0;
      }
    }`;

function answerSheetAlignMarkersHtml(): string {
  return `
    <span class="sheet-align-corner sheet-align-corner--tl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--tr" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--bl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--br" aria-hidden="true"></span>
    <span class="sheet-align-strip-left" aria-hidden="true"></span>
    <span class="sheet-align-strip-right" aria-hidden="true"></span>`;
}

function sheetAlignCornersHtml(): string {
  return `
    <span class="sheet-align-corner sheet-align-corner--tl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--tr" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--bl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--br" aria-hidden="true"></span>`;
}

function buildQuestionPageSection(
  questions: Question[],
  title: string,
  includeAnswerKey: boolean
): string {
  const questionsInPage = questions
    .map((q, i) => questionBlock(q, i, includeAnswerKey))
    .join('');

  const qb = questionsInPage || '<p class="empty-note">Sin preguntas.</p>';

  const denseClass = questions.length > 15 ? ' print-page--dense-questions' : '';

  return `
  <section class="print-page print-page--questions-only print-page--all-questions${denseClass} print-page--break">
    <div class="print-page-questions-body">
    <header class="sheet-header">
      <div class="sheet-header-text">
        <div class="header-exam-title">${title}</div>
        <div class="header-exam-range">Preguntas 1 a ${questions.length}</div>
      </div>
    </header>
  <div class="meta-grid">
    <div><label>Nombre del alumno</label><div class="meta-line"></div></div>
    <div><label>Grupo</label><div class="meta-line"></div></div>
    <div><label>Fecha</label><div class="meta-line"></div></div>
  </div>
    <div class="print-chunk">
      <div class="questions-block">
        ${qb}
      </div>
    </div>
    </div>
  </section>`;
}

/** Altura de fila en la hoja de respuestas dedicada (página 2). */
function answerSheetFillRowHeightPt(rowCount: number): number {
  const denseOmr = rowCount > 15;
  const sheetInnerPt = CALIFACIL_ANSWER_SHEET_PAGE.innerHeightPt - 17;
  const bodyInsetPt = 2 * (ANSWER_SHEET_LAYOUT.cornerSizePt + ANSWER_SHEET_LAYOUT.cornerGapPt);
  const chromePt = answerSheetChromeAboveControlPt();
  const controlBlockPt = CALIFACIL_ANSWER_SHEET_INCLUDES_CONTROL_NUMBER
    ? answerSheetControlBlockTotalPt(denseOmr)
    : 0;
  const omrAsidePadPt = 1.5 + 2;
  const omrTitleBlockPt = 6.2 * 1.12 + 2;
  const omrTableBorderPt = 2;
  const tableBottomGapPt = ANSWER_SHEET_LAYOUT.tableMarginBottomPt;
  const theadRowEquiv = 1.12;
  const usable =
    sheetInnerPt -
    bodyInsetPt -
    chromePt -
    controlBlockPt -
    omrAsidePadPt -
    omrTitleBlockPt -
    omrTableBorderPt -
    tableBottomGapPt;
  const rowPt = usable / (rowCount + theadRowEquiv);
  return Math.round(Math.max(8.5, rowPt) * 10) / 10;
}

/** Altura de fila OMR (pt) para que la tabla llene la hoja sin cortar filas. */
function omrFillRowHeightPt(rowCount: number): number {
  const sheetInnerPt = CALIFACIL_ANSWER_SHEET_PAGE.innerHeightPt - 17; // ~11in − 6mm márgenes @page
  const bodyInsetPt = 24; // cuadros de esquina + gap (×2)
  const chromeOutsideOmrPt = 54; // cabecera + meta del alumno
  const omrTitlePt = 10;
  const omrBorderPadPt = 9;
  const theadRowEquiv = 1.15;
  const usable =
    sheetInnerPt - bodyInsetPt - chromeOutsideOmrPt - omrTitlePt - omrBorderPadPt;
  const rowPt = usable / (rowCount + theadRowEquiv);
  return Math.round(Math.max(8.5, rowPt) * 10) / 10;
}

/** Mismas medidas que `.print-page--omr-answer-sheet` (carta vertical, márgenes @page). */
export const CALIFACIL_ANSWER_SHEET_PAGE = {
  widthPt: 612,
  /** Altura útil carta vertical (11 in @ 72 dpi). */
  innerHeightPt: 792,
  bodyInsetPt: 12,
  omrBorderPadTopPt: 3.5,
  omrTitlePt: 10,
  qnumColFrac: 0.09,
} as const;

/** Canvas carta tras warp fiducial (8.5×11 in @ 100 px/in). */
export const CALIFACIL_WARP_PAGE = {
  widthPx: 850,
  heightPx: 1100,
  widthIn: 8.5,
  heightIn: 11,
} as const;

function ptToWarpPx(pt: number): number {
  return (pt / 72) * (CALIFACIL_WARP_PAGE.widthPx / CALIFACIL_WARP_PAGE.widthIn);
}

/**
 * Plantilla OMR en canvas 850×1100 tras warp fiducial.
 * Calculada desde el layout impreso de la hoja de respuestas (página 2).
 */
/** Ajuste empírico: compensa warp vs. impreso (valores altos suben la cuadrícula de filas). */
const ANSWER_SHEET_OMR_ROW_SHIFT_UP_RATIO = 0.014;
/** Nudge vertical tras warp fiducial (pt negativos = sube el marco naranja). */
const ANSWER_SHEET_TABLE_TOP_NUDGE_PT = -16;
const ANSWER_SHEET_TABLE_HEIGHT_NUDGE_PT = 4;

function computeAnswerSheetPageTemplate(rowCount: number): CalifacilAnswerSheetOmrTemplate {
  const rows = Math.min(CALIFACIL_PRINT_MAX_QUESTIONS, Math.max(1, Math.round(rowCount)));
  /** Compacto = siempre tipografía dense (fila = capacidad 30). */
  const denseOmr = true;
  const pageWPt = CALIFACIL_ANSWER_SHEET_PAGE.widthPt;
  const pageHPt = CALIFACIL_ANSWER_SHEET_PAGE.innerHeightPt;
  const { cornerSizePt, cornerGapPt, alignStripWidthPt, tableMarginXPt } = ANSWER_SHEET_LAYOUT;

  const bodyInsetPt = cornerSizePt + cornerGapPt;
  const sideMarginPt = bodyInsetPt + alignStripWidthPt + cornerGapPt;
  const chromePt = answerSheetChromeAboveControlPt();
  const controlTotalPt = CALIFACIL_ANSWER_SHEET_INCLUDES_CONTROL_NUMBER
    ? answerSheetControlBlockTotalPt(denseOmr)
    : 0;
  const omrHeightPt = answerSheetCalifacilOmrOuterHeightPt(rows);

  const tableTopPt = bodyInsetPt + chromePt + controlTotalPt + ANSWER_SHEET_TABLE_TOP_NUDGE_PT;
  const tableLeftPt = sideMarginPt + tableMarginXPt;
  const tableWidthPt = pageWPt - 2 * sideMarginPt - 2 * tableMarginXPt;
  const tableHeightPt = omrHeightPt + ANSWER_SHEET_TABLE_HEIGHT_NUDGE_PT;

  const rowPt = answerSheetCompactRowHeightPt(rows);
  const titleStripPt = 1.5 + 6.2 * 1.12 + 2 + 1 + rowPt * 1.12;
  const titleStripRatio = Math.max(
    0.028,
    titleStripPt / Math.max(1, omrHeightPt) - ANSWER_SHEET_OMR_ROW_SHIFT_UP_RATIO
  );

  return {
    tableLeftRatio: tableLeftPt / pageWPt,
    tableTopRatio: tableTopPt / pageHPt,
    tableWidthRatio: tableWidthPt / pageWPt,
    tableHeightRatio: tableHeightPt / pageHPt,
    titleStripRatioOfTable: titleStripRatio,
    qnumWidthRatio: CALIFACIL_ANSWER_SHEET_PAGE.qnumColFrac,
  };
}

export const CALIFACIL_ANSWER_SHEET_WARP_CALIBRATION = (() => {
  const t = computeAnswerSheetPageTemplate(30);
  return {
    ...t,
    titleStripRatioOfTable30: t.titleStripRatioOfTable,
    qnumColFrac: t.qnumWidthRatio,
  };
})();

const FIDUCIAL_CORNER_PT = ANSWER_SHEET_LAYOUT.cornerSizePt;
const WARP_PX_PER_IN = CALIFACIL_WARP_PAGE.widthPx / CALIFACIL_WARP_PAGE.widthIn;

function fiducialCenterNorm(corner: 'tl' | 'tr' | 'bl' | 'br'): { x: number; y: number } {
  const insetPx = (FIDUCIAL_CORNER_PT / 2 / 72) * WARP_PX_PER_IN;
  const w = CALIFACIL_WARP_PAGE.widthPx;
  const h = CALIFACIL_WARP_PAGE.heightPx;
  const positions = {
    tl: { x: insetPx / w, y: insetPx / h },
    tr: { x: 1 - insetPx / w, y: insetPx / h },
    bl: { x: insetPx / w, y: 1 - insetPx / h },
    br: { x: 1 - insetPx / w, y: 1 - insetPx / h },
  };
  return positions[corner];
}

/** Centros normalizados de los cuadros negros de esquina en canvas 850×1100. */
export const CALIFACIL_FIDUCIAL_CENTERS_NORM = {
  tl: fiducialCenterNorm('tl'),
  tr: fiducialCenterNorm('tr'),
  bl: fiducialCenterNorm('bl'),
  br: fiducialCenterNorm('br'),
} as const;

/** Franjas negras verticales de alineación (coords. 0–1 en canvas 850×1100). */
function answerSheetAlignStripNorm(side: 'left' | 'right'): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const pageW = CALIFACIL_WARP_PAGE.widthPx;
  const pageH = CALIFACIL_WARP_PAGE.heightPx;
  const stripW = ptToWarpPx(ANSWER_SHEET_LAYOUT.alignStripWidthPt) / pageW;
  const top =
    ptToWarpPx(ANSWER_SHEET_LAYOUT.cornerSizePt + ANSWER_SHEET_LAYOUT.cornerGapPt) / pageH;
  const height =
    (pageH -
      2 * ptToWarpPx(ANSWER_SHEET_LAYOUT.cornerSizePt + ANSWER_SHEET_LAYOUT.cornerGapPt)) /
    pageH;
  return {
    left: side === 'left' ? 0 : 1 - stripW,
    top,
    width: stripW,
    height,
  };
}

/** Franja negra izquierda de la hoja de respuestas. */
export const CALIFACIL_LEFT_ALIGN_STRIP_NORM = answerSheetAlignStripNorm('left');

/** Franja negra derecha de la hoja de respuestas. */
export const CALIFACIL_RIGHT_ALIGN_STRIP_NORM = answerSheetAlignStripNorm('right');

/** Par de franjas negras (izquierda y derecha) para guías de cámara. */
export const CALIFACIL_ALIGN_STRIPS_NORM = [
  CALIFACIL_LEFT_ALIGN_STRIP_NORM,
  CALIFACIL_RIGHT_ALIGN_STRIP_NORM,
] as const;

/**
 * Marco de alineación móvil: ancho de hoja carta × alto de las franjas negras laterales.
 * Las franjas definen el largo útil de la hoja de respuestas.
 */
export const CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM = {
  x: 0,
  y: CALIFACIL_RIGHT_ALIGN_STRIP_NORM.top,
  w: 1,
  h: CALIFACIL_RIGHT_ALIGN_STRIP_NORM.height,
} as const;

/** Marco naranja de revisión: ancho carta × alto entre franjas negras laterales. */
export function califacilAnswerSheetOrangeFrameNorm(): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const f = CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM;
  return { x: f.x, y: f.y, w: f.w, h: f.h };
}

/** Relación ancho÷alto del marco de alineación (franjas negras = alto de referencia). */
export function califacilAnswerSheetAlignFrameAspect(): number {
  const pageW = CALIFACIL_WARP_PAGE.widthPx;
  const pageH = CALIFACIL_WARP_PAGE.heightPx;
  const frameH = CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM.h * pageH;
  return pageW / Math.max(1, frameH);
}

export type CalifacilMarkerAnchoredTemplate = CalifacilAnswerSheetOmrTemplate & {
  /** Rectángulo interior definido por los centros de los 4 fiduciales (coords. 0–1 de página). */
  markerQuad: { left: number; top: number; width: number; height: number };
};

/** Convierte ratios de página absolutos a fracciones dentro del cuadrilátero fiducial. */
export function buildMarkerAnchoredAnswerSheetTemplate(
  rowCount: number
): CalifacilMarkerAnchoredTemplate {
  const page = buildCalifacilAnswerSheetOmrTemplate(rowCount);
  const tl = CALIFACIL_FIDUCIAL_CENTERS_NORM.tl;
  const br = CALIFACIL_FIDUCIAL_CENTERS_NORM.br;
  const markerQuad = {
    left: tl.x,
    top: tl.y,
    width: br.x - tl.x,
    height: br.y - tl.y,
  };
  return {
    markerQuad,
    tableLeftRatio: (page.tableLeftRatio - markerQuad.left) / markerQuad.width,
    tableTopRatio: (page.tableTopRatio - markerQuad.top) / markerQuad.height,
    tableWidthRatio: page.tableWidthRatio / markerQuad.width,
    tableHeightRatio: page.tableHeightRatio / markerQuad.height,
    titleStripRatioOfTable: page.titleStripRatioOfTable,
    qnumWidthRatio: page.qnumWidthRatio,
  };
}

/** Reconstruye ratios de página a partir de plantilla anclada a fiduciales. */
export function markerAnchoredTemplateToPageRatios(
  anchored: CalifacilMarkerAnchoredTemplate
): CalifacilAnswerSheetOmrTemplate {
  const mq = anchored.markerQuad;
  return {
    tableLeftRatio: mq.left + anchored.tableLeftRatio * mq.width,
    tableTopRatio: mq.top + anchored.tableTopRatio * mq.height,
    tableWidthRatio: anchored.tableWidthRatio * mq.width,
    tableHeightRatio: anchored.tableHeightRatio * mq.height,
    titleStripRatioOfTable: anchored.titleStripRatioOfTable,
    qnumWidthRatio: anchored.qnumWidthRatio,
  };
}

export type CalifacilControlNumberBlockRatios = {
  left: number;
  top: number;
  width: number;
  height: number;
  titleFrac: number;
  headerFrac: number;
  cornerColFrac: number;
};

/** Rectángulo del bloque de número de control en coords. normalizadas 0–1 (canvas carta 850×1100). */
export function getControlNumberBlockPageRatios(
  rowCount = CALIFACIL_PRINT_MAX_QUESTIONS
): CalifacilControlNumberBlockRatios {
  const denseOmr = rowCount > 15;
  const pageW = CALIFACIL_WARP_PAGE.widthPx;
  const pageH = CALIFACIL_WARP_PAGE.heightPx;
  const { cornerSizePt, cornerGapPt, alignStripWidthPt } = ANSWER_SHEET_LAYOUT;
  const bodyInsetPx = ptToWarpPx(cornerSizePt + cornerGapPt);
  const stripPx = ptToWarpPx(alignStripWidthPt);
  const sideMarginPx = bodyInsetPx + stripPx + ptToWarpPx(cornerGapPt);
  const padH = ptToWarpPx(CALIFACIL_CONTROL_NUMBER_LAYOUT.blockPadHorizPt);
  const padTop = ptToWarpPx(denseOmr ? 1 : CALIFACIL_CONTROL_NUMBER_LAYOUT.blockPadTopPt);
  const padBot = ptToWarpPx(denseOmr ? 2 : CALIFACIL_CONTROL_NUMBER_LAYOUT.blockPadBottomPt);
  const chromeTopPx = ptToWarpPx(answerSheetChromeAboveControlPt());
  const blockOuterPx = ptToWarpPx(answerSheetControlBlockTotalPt(denseOmr));
  const marginBottomPx = ptToWarpPx(
    denseOmr ? 2 : CALIFACIL_CONTROL_NUMBER_LAYOUT.blockMarginBottomPt
  );

  const blockLeft = sideMarginPx + padH;
  const blockTop = bodyInsetPx + chromeTopPx;
  const blockW = pageW - 2 * sideMarginPx - 2 * padH;
  const blockContentH = blockOuterPx - marginBottomPx - padTop - padBot;
  const titleH = ptToWarpPx(
    denseOmr ? 6.4 : CALIFACIL_CONTROL_NUMBER_LAYOUT.titleHeightPt
  );
  const tableH = Math.max(1, blockContentH - titleH);
  const headerH = ptToWarpPx(CALIFACIL_CONTROL_NUMBER_LAYOUT.tableHeaderPt);

  return {
    left: blockLeft / pageW,
    top: (blockTop + padTop) / pageH,
    width: blockW / pageW,
    height: blockContentH / pageH,
    titleFrac: titleH / blockContentH,
    headerFrac: headerH / tableH,
    cornerColFrac: CALIFACIL_CONTROL_NUMBER_LAYOUT.cornerColFrac,
  };
}

/**
 * Recorte normalizado de la línea «Nombre del alumno» en hoja warp 850×1100.
 * Misma geometría que `.sheet-header--omr` + `.omr-sheet-meta-row` del HTML impreso.
 */
export function getAnswerSheetNameFieldPageRatios(): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const pageW = CALIFACIL_WARP_PAGE.widthPx;
  const pageH = CALIFACIL_WARP_PAGE.heightPx;
  const { cornerSizePt, cornerGapPt, alignStripWidthPt } = ANSWER_SHEET_LAYOUT;
  const bodyInsetPx = ptToWarpPx(cornerSizePt + cornerGapPt);
  const sideMarginPx = bodyInsetPx + ptToWarpPx(alignStripWidthPt) + ptToWarpPx(cornerGapPt);
  // Solo cabecera (sin meta): el nombre vive en la fila meta debajo del header.
  const headerPt = 8.5 * 1.1 + 7 + 1 + 2 + 2 + 0.75;
  const metaRowTopPx = bodyInsetPx + ptToWarpPx(headerPt);
  const contentW = pageW - 2 * sideMarginPx;
  const metaGapPx = ptToWarpPx(10);
  const shortFieldW = contentW * 0.22;
  const nameFieldOuterW = Math.max(1, contentW - 2 * shortFieldW - 2 * metaGapPx);
  const nameLabelPx = ptToWarpPx(52);
  const fieldGapPx = ptToWarpPx(3);
  // min-height 7pt + borde + margen extra para UI legible
  const lineHPx = ptToWarpPx(12);
  const lineW = Math.max(1, nameFieldOuterW - nameLabelPx - fieldGapPx);

  return {
    left: (sideMarginPx + nameLabelPx + fieldGapPx) / pageW,
    top: metaRowTopPx / pageH,
    width: lineW / pageW,
    height: lineHPx / pageH,
  };
}

export type CalifacilAnswerSheetOmrTemplate = {
  tableLeftRatio: number;
  tableTopRatio: number;
  tableWidthRatio: number;
  tableHeightRatio: number;
  titleStripRatioOfTable: number;
  qnumWidthRatio: number;
};

/**
 * Plantilla OMR normalizada (0–1) alineada con la hoja de respuestas impresa.
 * Debe usarse tras enderezar la captura con los 4 fiduciales de esquina.
 * Plantilla fija: siempre capacidad 30 (misma geometría para cualquier N ≤ 30).
 */
export function buildCalifacilAnswerSheetOmrTemplate(
  _rowCount?: number
): CalifacilAnswerSheetOmrTemplate {
  return computeAnswerSheetPageTemplate(CALIFACIL_PRINT_MAX_QUESTIONS);
}

/**
 * Regresión: plantilla única de 30 filas (N=10 y N=30 comparten la misma geometría).
 */
export function assertFixedAnswerSheetLayoutRatios(): {
  t10: CalifacilAnswerSheetOmrTemplate;
  t30: CalifacilAnswerSheetOmrTemplate;
} {
  const t10 = buildCalifacilAnswerSheetOmrTemplate(10);
  const t30 = buildCalifacilAnswerSheetOmrTemplate(30);
  if (Math.abs(t10.tableHeightRatio - t30.tableHeightRatio) > 1e-9) {
    throw new Error(
      `Fixed 30-row template broken: h10=${t10.tableHeightRatio} h30=${t30.tableHeightRatio}`
    );
  }
  if (t30.tableHeightRatio > 0.92) {
    throw new Error(
      `30-row table too tall for one letter page: ${t30.tableHeightRatio.toFixed(3)}`
    );
  }
  if (Math.abs(t10.tableLeftRatio - t30.tableLeftRatio) > 0.001) {
    throw new Error('tableLeftRatio must match for 10 and 30');
  }
  return { t10, t30 };
}

/** @deprecated Usar assertFixedAnswerSheetLayoutRatios (plantilla fija 30). */
export function assertCompactAnswerSheetLayoutRatios(): {
  t10: CalifacilAnswerSheetOmrTemplate;
  t30: CalifacilAnswerSheetOmrTemplate;
} {
  return assertFixedAnswerSheetLayoutRatios();
}

function omrSheetMetaRowHtml(): string {
  return `
      <div class="omr-sheet-meta-row">
        <div class="omr-meta-field"><label>Nombre del alumno</label><div class="meta-line"></div></div>
        <div class="omr-meta-field omr-meta-field--short"><label>Grupo</label><div class="meta-line"></div></div>
        <div class="omr-meta-field omr-meta-field--short"><label>Fecha</label><div class="meta-line"></div></div>
      </div>`;
}

function buildOmrAnswerSheetSection(
  questions: Question[],
  title: string,
  omrCols: number,
  questionOffset = 0
): string {
  const sheetQs = getCalifacilOmrSheetQuestions(questions).slice(
    0,
    CALIFACIL_PRINT_MAX_QUESTIONS
  );
  const activeCount = sheetQs.length;
  if (activeCount === 0 || omrCols <= 0) return '';

  const gridRows = CALIFACIL_PRINT_MAX_QUESTIONS;
  const omrHtml = answerSheetOmrTableHtml(sheetQs, omrCols, questionOffset);
  /** Siempre plantilla densa de 30 filas (misma geometría para N≤30). */
  const denseOmrClass = ' print-page--dense-omr';
  const startNum = questionOffset + 1;
  const endNum = questionOffset + activeCount;
  const sheetNote =
    activeCount < gridRows
      ? `Hoja de respuestas · Reactivos ${startNum}–${endNum} · plantilla ${gridRows}`
      : `Hoja de respuestas · Reactivos ${startNum}–${endNum}`;

  const rowPt = answerSheetCompactRowHeightPt(gridRows);
  const bubblePt = Math.round(Math.min(rowPt - 3, Math.max(5.5, rowPt * 0.5)) * 10) / 10;

  return `
  <section class="print-page print-page--omr-only print-page--omr-answer-sheet${denseOmrClass} print-page--omr-first print-page--break" style="--omr-row-count: ${gridRows}; --omr-row-pt: ${rowPt}pt; --omr-bubble-pt: ${bubblePt}pt;">
${answerSheetAlignMarkersHtml()}
    <div class="print-page-omr-sheet-body">
      <header class="sheet-header sheet-header--omr">
        <div class="sheet-header-text">
          <div class="header-exam-title">${title}</div>
          <div class="omr-sheet-label">${sheetNote}</div>
        </div>
      </header>
${omrSheetMetaRowHtml()}
${CALIFACIL_ANSWER_SHEET_INCLUDES_CONTROL_NUMBER ? answerSheetControlNumberHtml() : ''}
${omrHtml}
    </div>
  </section>`;
}

/**
 * HTML completo del examen (mismo documento que se usa para imprimir).
 */
export function buildPrintExamHtml(
  exam: ExamWithQuestions,
  options: { includeAnswerKey?: boolean; baseUrl: string }
): string {
  const includeAnswerKey = options.includeAnswerKey === true;
  const title = escapeHtml(exam.title);

  const omrCols = califacilOmrColumnCount(exam.questions);
  const questions = exam.questions;
  const omrQuestions = getCalifacilOmrSheetQuestions(questions);
  const omrChunks = chunkQuestions(omrQuestions, CALIFACIL_PRINT_MAX_QUESTIONS);

  const questionPagesHtml = buildQuestionPageSection(questions, title, includeAnswerKey);

  let omrPagesHtml = '';
  if (omrCols > 0 && omrQuestions.length > 0) {
    let offset = 0;
    for (const chunk of omrChunks) {
      if (!chunk.length) continue;
      omrPagesHtml += buildOmrAnswerSheetSection(chunk, title, omrCols, offset);
      offset += chunk.length;
    }
  }

  const pagesHtml = questionPagesHtml + omrPagesHtml;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Examen</title>
  <base href="${options.baseUrl}/" />
  <style>
${PRINT_STYLES}
  </style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

/**
 * Abre una pestaña en blanco en el mismo clic del usuario (antes de awaits).
 * Úsala cuando el HTML del examen se obtiene de forma asíncrona.
 */
export function openPrintPreviewWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  const win = window.open('', '_blank');
  if (!win) return null;
  win.document.open();
  win.document.write(
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Preparando…</title></head>' +
      '<body style="font-family:system-ui,sans-serif;padding:2rem;color:#444">Preparando examen para imprimir…</body></html>'
  );
  win.document.close();
  return win;
}

function runPrintDialog(win: Window, onDone: () => void): void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };

  const triggerPrint = () => {
    try {
      win.document.title = '\u00A0';
      win.focus();
      win.print();
    } catch {
      finish();
      return;
    }
    win.addEventListener('afterprint', finish, { once: true });
    window.setTimeout(finish, 120_000);
  };

  const schedulePrint = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(triggerPrint, 450);
      });
    });
  };

  if (win.document.readyState === 'complete') {
    schedulePrint();
  } else {
    win.addEventListener('load', schedulePrint, { once: true });
    window.setTimeout(schedulePrint, 2500);
  }
}

/**
 * Abre el diálogo de impresión con examen en formato carta (US Letter).
 * Usa iframe oculto (mismo gesto del usuario) o una ventana ya abierta.
 */
function printHtmlDocument(html: string, targetWindow?: Window | null): boolean {
  if (typeof document === 'undefined') return false;

  if (targetWindow && !targetWindow.closed) {
    try {
      targetWindow.document.open();
      targetWindow.document.write(html);
      targetWindow.document.close();
      runPrintDialog(targetWindow, () => {
        try {
          if (!targetWindow.closed) targetWindow.close();
        } catch {
          /* ignore */
        }
      });
      return true;
    } catch {
      /* fallback iframe */
    }
  }

  try {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;overflow:hidden;';
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument ?? win?.document;
    if (!win || !doc) {
      iframe.remove();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();
    runPrintDialog(win, () => {
      window.setTimeout(() => iframe.remove(), 1500);
    });
    return true;
  } catch {
    return false;
  }
}

export function printExamDocument(
  exam: ExamWithQuestions,
  options?: { includeAnswerKey?: boolean; targetWindow?: Window | null }
): boolean {
  if (typeof window === 'undefined') return false;
  const includeAnswerKey = options?.includeAnswerKey === true;
  const html = buildPrintExamHtml(exam, {
    includeAnswerKey,
    baseUrl: window.location.origin,
  });
  if (!html.includes('print-page')) {
    return false;
  }
  return printHtmlDocument(html, options?.targetWindow ?? null);
}
