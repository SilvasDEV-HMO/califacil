import type { ExamWithQuestions, Question } from '@/types';
import { resolveOptionIndexFromValue } from '@/lib/utils';

/** Relación ancho:alto aproximada del recuadro CaliFacil (incl. título + tabla con cabecera A–D). */
export const CALIFACIL_OMR_GUIDE_ASPECT_RATIO = 3.28;

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

function questionBlock(
  q: Question,
  index: number,
  includeAnswerKey: boolean
): string {
  const n = index + 1;
  const text = escapeHtml(q.text);
  let body = '';

  if (q.type === 'multiple_choice' && q.options?.length) {
    body = q.options
      .map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const isCorrect = includeAnswerKey && opt === q.correct_answer;
        const mark = isCorrect ? ' <strong>(correcta)</strong>' : '';
        return `<div class="opt"><span class="opt-letter">${letter}.</span><span class="opt-body">${escapeHtml(opt)}${mark}</span></div>`;
      })
      .join('');
  } else {
    body =
      '<div class="open-lines">' +
      Array.from({ length: 4 }, () => '<div class="write-line"></div>').join('') +
      '</div>';
  }

  return `
    <div class="question">
      <p class="q-num"><strong>${n}.</strong> ${text}</p>
      ${body}
    </div>`;
}

function questionPlaceholderBlock(index: number): string {
  const n = index + 1;
  return `
    <div class="question question--placeholder">
      <p class="q-num"><strong>${n}.</strong> ________________________________</p>
      <div class="open-lines">
        <div class="write-line"></div>
      </div>
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

/** Examen apto para impresión con banda CaliFacil (OMR) y para la página Calificar. */
export function examSupportsCalifacilOmr(questions: Question[]): boolean {
  if (!questions.length) return false;
  return questions.every(
    (q) =>
      q.type === 'multiple_choice' &&
      (q.options?.length ?? 0) >= 2 &&
      (q.options?.length ?? 0) <= 5
  );
}

export function califacilOmrColumnCount(questions: Question[]): number {
  if (!examSupportsCalifacilOmr(questions)) return 0;
  return Math.min(
    5,
    Math.max(...questions.map((q) => q.options?.length ?? 0))
  );
}

function califacilOmrTableHtml(
  chunkQs: Question[],
  startIdx: number,
  omrCols: number
): string {
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
  for (let i = 0; i < 10; i++) {
    const q = chunkQs[i];
    const qNum = startIdx + i + 1;
    if (!q || q.type !== 'multiple_choice') {
      rows.push(
        `<tr class="omr-tr omr-tr--inactive"><td class="omr-qnum">—</td><td class="omr-inactive" colspan="${omrCols}">—</td></tr>`
      );
      continue;
    }
    const nOpts = Math.min(omrCols, q.options?.length ?? omrCols);
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
      <p class="omr-title">CaliFacil — <strong>Una</strong> respuesta por fila: rellena <strong>toda la casilla</strong> (cuadrado) con bolígrafo <strong>azul o negro</strong> (tinta bien oscura). La <strong>fila</strong> es el número de pregunta; la <strong>columna</strong> es A, B, C… Incluye <strong>todo</strong> este recuadro al fotografiar.</p>
      <table class="omr-table" data-califacil-omr-cols="${omrCols}" data-califacil-omr-version="2">
        ${thead}
        <tbody>${rows.join('')}</tbody>
      </table>
    </aside>`;
}

const PRINT_STYLES = `    @page { size: letter; margin: 5.5mm 8mm; }
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
      min-height: calc(279.4mm - 11mm);
      display: flex;
      flex-direction: column;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    .print-page--break {
      page-break-after: always;
      break-after: page;
    }
    .sheet-header {
      display: flex;
      flex-direction: column;
      gap: 4pt;
      border-bottom: 1px solid #000;
      padding-bottom: 3pt;
      margin-bottom: 4pt;
    }
    .sheet-banner-wrap {
      width: 100%;
      background: #fff;
      line-height: 0;
      display: flex;
      justify-content: center;
    }
    .sheet-banner {
      width: 100%;
      height: auto;
      max-height: 0.95in;
      object-fit: contain;
      object-position: center;
      display: block;
    }
    .sheet-header-text {
      width: 100%;
      min-width: 0;
      text-align: right;
    }
    .header-exam-title {
      font-size: 10pt;
      font-weight: bold;
      margin: 0;
      line-height: 1.1;
    }
    .header-exam-range {
      font-size: 9pt;
      font-weight: bold;
      margin: 4pt 0 0;
      color: #333;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: minmax(0, 2.35fr) minmax(0, 0.55fr) minmax(0, 1.1fr);
      gap: 3pt 8pt;
      margin-top: 9pt;
      margin-bottom: 10pt;
      font-size: 8pt;
    }
    .meta-grid label { font-weight: bold; }
    .meta-line {
      border-bottom: 1px solid #000;
      min-height: 16pt;
      margin-top: 6pt;
    }
    .questions-block { margin-top: 0; flex: 1; }
    .question { margin-bottom: 2.5pt; page-break-inside: avoid; break-inside: avoid-page; }
    .question--placeholder .q-num { color: #777; }
    .q-num { margin: 0 0 1pt; text-align: justify; font-size: 8.5pt; line-height: 1.1; }
    .opt {
      display: flex;
      align-items: baseline;
      gap: 3pt;
      margin: 0 0 0 2pt;
      font-size: 8pt;
      line-height: 1.08;
    }
    .opt-body {
      flex: 1;
      min-width: 0;
      text-align: justify;
    }
    .opt-letter { font-weight: bold; margin-right: 3pt; }
    .open-lines { margin-top: 2pt; margin-left: 5pt; }
    .write-line {
      border-bottom: 1px solid #333;
      min-height: 9pt;
      margin-bottom: 3pt;
    }
    .footer-note {
      margin-top: 2pt;
      font-size: 6.5pt;
      text-align: center;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 1pt;
    }
    .empty-note { font-size: 9pt; color: #666; font-style: italic; }
    .califacil-omr {
      margin-top: auto;
      padding-top: 4pt;
      padding: 5pt 6pt 6pt;
      border: 2pt solid #000;
      page-break-inside: avoid;
      break-inside: avoid-page;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .omr-title {
      font-size: 6.75pt;
      font-weight: bold;
      text-align: center;
      margin: 0 0 5pt;
      line-height: 1.2;
    }
    .omr-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 7.25pt;
      border: 1.2pt solid #000;
    }
    .omr-tr--head .omr-th {
      font-weight: 800;
      text-align: center;
      vertical-align: middle;
      padding: 3pt 3pt;
      border: 0.9pt solid #000;
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
      font-size: 9pt;
      letter-spacing: 0.02em;
    }
    .omr-th-num {
      font-size: 7pt;
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
      padding: 3pt 5pt 3pt 3pt;
      vertical-align: middle;
      border: 0.9pt solid #000;
      background: #efefef;
      font-size: 8pt;
    }
    .omr-bubble-cell {
      text-align: center;
      vertical-align: middle;
      padding: 2.5pt 4pt;
      border: 0.9pt solid #000;
    }
    .omr-bubble-cell--muted {
      background: #ebebeb;
    }
    .omr-bubble-wrap {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      min-height: 15pt;
    }
    .omr-square {
      width: 14pt;
      height: 14pt;
      min-width: 14pt;
      min-height: 14pt;
      border: 1.35pt solid #000;
      border-radius: 1.5pt;
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
    @media print {
      body { max-width: none; }
      .no-print { display: none; }
    }`;

/**
 * HTML completo del examen (mismo documento que se usa para imprimir).
 */
export function buildPrintExamHtml(
  exam: ExamWithQuestions,
  options: { includeAnswerKey?: boolean; baseUrl: string }
): string {
  const includeAnswerKey = options.includeAnswerKey === true;
  const title = escapeHtml(exam.title);
  const headerBannerUrl = `${options.baseUrl.replace(/\/$/, '')}/print-header-banner.png`;

  const omrCols = califacilOmrColumnCount(exam.questions);

  const chunks = chunkQuestions(exam.questions, 10);
  const pagesHtml = chunks
    .map((chunkQs, pageIdx) => {
      const isFirst = pageIdx === 0;
      const isLast = pageIdx === chunks.length - 1;
      const startIdx = pageIdx * 10;
      const rangeStart = startIdx + 1;
      const rangeEnd = startIdx + 10;
      const questionsInPage = Array.from({ length: 10 }, (_, i) => {
        const q = chunkQs[i];
        return q
          ? questionBlock(q, startIdx + i, includeAnswerKey)
          : questionPlaceholderBlock(startIdx + i);
      })
        .join('');
      const breakClass = !isLast ? ' print-page--break' : '';

      const headerRight = isFirst
        ? `<div class="header-exam-title">${title}</div>`
        : `<div class="header-exam-title">${title}</div><div class="header-exam-range">Preguntas ${rangeStart} a ${rangeEnd}</div>`;

      const firstPageBlock = isFirst
        ? `
  <div class="meta-grid">
    <div><label>Nombre del alumno</label><div class="meta-line"></div></div>
    <div><label>Grupo</label><div class="meta-line"></div></div>
    <div><label>Fecha</label><div class="meta-line"></div></div>
  </div>`
        : '';

      return `
  <section class="print-page${breakClass}">
    <header class="sheet-header">
      <div class="sheet-banner-wrap">
        <img class="sheet-banner" src="${headerBannerUrl}" alt="" crossorigin="anonymous" />
      </div>
      <div class="sheet-header-text">
        ${headerRight}
      </div>
    </header>
    ${firstPageBlock}
    <div class="questions-block">
      ${questionsInPage || '<p class="empty-note">Sin preguntas en esta sección.</p>'}
    </div>
    <!-- Cada hoja: 10 preguntas + recuadro CaliFacil para esa hoja -->
    ${omrCols > 0 ? califacilOmrTableHtml(chunkQs, startIdx, omrCols) : ''}
    <p class="footer-note">
      ${includeAnswerKey ? 'Clave de respuestas (uso docente).' : 'Hoja para el estudiante.'} · Hoja ${pageIdx + 1} de ${chunks.length}
    </p>
  </section>`;
    })
    .join('');

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
 * Abre ventana de impresión con examen en formato carta (US Letter).
 */
export function printExamDocument(
  exam: ExamWithQuestions,
  options?: { includeAnswerKey?: boolean }
): boolean {
  if (typeof window === 'undefined') return false;
  const includeAnswerKey = options?.includeAnswerKey === true;
  const html = buildPrintExamHtml(exam, {
    includeAnswerKey,
    baseUrl: window.location.origin,
  });

  const win = window.open('', '_blank');
  if (!win) {
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = '\u00A0';
  win.focus();
  setTimeout(() => {
    win.document.title = '\u00A0';
    win.print();
    win.close();
  }, 250);
  return true;
}
