/**
 * Lee la hoja de 20 de admin y comprueba las marcas de e:/Hoja de Respuestas.pdf
 * Run: npx tsx scripts/assert-custom20-sheet.mts
 */
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { installNodeCanvasShim } from './install-node-canvas-shim.mts';

installNodeCanvasShim();

import { renderPdfPageToJpeg } from '../src/lib/renderPdfPage.server.ts';
import { readCustom20AnswerSheet } from '../src/lib/omr/custom-20/read-sheet.ts';

const pdfPath = process.argv[2] || 'e:/Hoja de Respuestas.pdf';
if (!fs.existsSync(pdfPath)) {
  console.error('No está el PDF de prueba:', pdfPath);
  process.exit(1);
}

const buf = fs.readFileSync(pdfPath);
const { jpeg } = await renderPdfPageToJpeg(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  1,
  1400
);
const image = await loadImage(jpeg);
const canvas = createCanvas(image.width, image.height);
const ctx = canvas.getContext('2d');
ctx.drawImage(image, 0, 0);

const read = readCustom20AnswerSheet(canvas as unknown as HTMLCanvasElement);
if (!read) {
  console.error('No se detectaron los cuadros');
  process.exit(1);
}

/** Marcas de Hoja de Respuestas.pdf. La 14 tiene A borrada y B más oscura. */
const expected = ['A', 'C', 'B', 'B', 'B', 'B', 'D', 'A', 'C', 'B', 'B', 'B', 'C', 'B', 'A', 'B', 'A', 'C', 'A', 'B'];
let bad = 0;
for (const row of read.rows) {
  const exp = expected[row.question - 1];
  const fills = row.bubbles.map((b) => `${b.letter}:${b.fill.toFixed(2)}`).join(' ');
  const ok = row.answer === exp;
  if (!ok) bad++;
  console.log(`${ok ? 'OK' : 'XX'} ${row.question} got=${row.answer ?? '-'} exp=${exp} ${fills}`);
}
if (bad) {
  console.error('fallos', bad);
  process.exit(1);
}
console.log('20/20');
