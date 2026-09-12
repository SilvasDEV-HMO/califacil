/**
 * Golden: hoja Luis 30×4 (JPG escáner + PDF).
 * 30/30 picks y centros de overlay sobre la marca.
 * Run: npx tsx scripts/assert-omr-scan-overlay-golden.mts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { installNodeCanvasShim } from './install-node-canvas-shim.mts';

installNodeCanvasShim();

import { renderPdfPageToJpeg } from '../src/lib/renderPdfPage.server.ts';
import {
  classifyDesktopUploadCanvas,
  normalizeCalifacilGradeDocumentCanvas,
} from '../src/lib/omr/pipeline.ts';
import { scanDesktopGradeUnifiedOrLegacy } from '../src/lib/omr/unified-grade-scan.ts';
import {
  attachAnswerSheetReviewBubbleOverlay,
  getOmrCanvasImageData,
  scaleCanvasToMaxSide,
  scanWarpedWithBestTableFrame,
  syncCalifacilOmrGeometryImageSize,
  type CalifacilOmrScanGeometry,
} from '../src/lib/omrScan.ts';

const COLS = 4;
const ROWS = 30;
const LETTERS = ['A', 'B', 'C', 'D'] as const;
const GROUND_TRUTH: number[] = [
  0, 1, 1, 2, 0, 1, 1, 1, 1, 0, 0, 3, 2, 3, 1, 1, 2, 0, 1, 2, 0, 2, 0, 1, 0, 2, 1, 2, 3, 2,
];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function picksKey(picks: (number | null)[]): string {
  return picks
    .slice(0, ROWS)
    .map((p) => (p == null ? '?' : LETTERS[p] ?? '?'))
    .join('');
}

function sampleLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  nx: number,
  ny: number,
  radiusPx = 4
): number {
  const cx = Math.round(nx * width);
  const cy = Math.round(ny * height);
  let sum = 0;
  let n = 0;
  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > radiusPx * radiusPx) continue;
      const x = Math.max(0, Math.min(width - 1, cx + dx));
      const y = Math.max(0, Math.min(height - 1, cy + dy));
      const i = (y * width + x) * 4;
      sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
  }
  return n > 0 ? sum / n : 255;
}

function bubbleCenter(geometry: CalifacilOmrScanGeometry, row: number, col: number) {
  const bubble = geometry.bubbles?.[row]?.[col];
  if (bubble && Number.isFinite(bubble.cx) && Number.isFinite(bubble.cy)) {
    return { nx: bubble.cx, ny: bubble.cy };
  }
  const cell = geometry.cells[row]?.[col];
  if (!cell) return null;
  return { nx: cell.x + cell.w * 0.5, ny: cell.y + cell.h * 0.5 };
}

function pointInCell(
  geometry: CalifacilOmrScanGeometry,
  row: number,
  col: number,
  nx: number,
  ny: number
): boolean {
  const cell = geometry.cells[row]?.[col];
  if (!cell) return false;
  const padX = cell.w * 0.25;
  const padY = cell.h * 0.25;
  return (
    nx >= cell.x - padX &&
    nx <= cell.x + cell.w + padX &&
    ny >= cell.y - padY &&
    ny <= cell.y + cell.h + padY
  );
}

async function canvasFromJpegFile(filePath: string) {
  const img = await loadImage(filePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return canvas as unknown as HTMLCanvasElement;
}

async function canvasFromPdfFile(filePath: string) {
  const buf = await readFile(filePath);
  const raster = await renderPdfPageToJpeg(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    1
  );
  const img = await loadImage(raster.jpeg);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return canvas as unknown as HTMLCanvasElement;
}

function gradeCanvas(source: HTMLCanvasElement, label: string) {
  const canvas = scaleCanvasToMaxSide(source, 1600);
  console.log(`${label}: ${source.width}x${source.height} -> ${canvas.width}x${canvas.height}`);
  const { meta } = scanWarpedWithBestTableFrame(canvas, COLS, ROWS, { fast: true });
  const snapped = attachAnswerSheetReviewBubbleOverlay(canvas, meta, COLS, ROWS, {
    forceRebuild: true,
    maxShiftRatio: 0.3,
  });
  const overlay = syncCalifacilOmrGeometryImageSize(
    snapped.geometry ?? meta.geometry!,
    canvas.width,
    canvas.height
  );
  const picks = (snapped.picks.length ? snapped.picks : meta.picks).slice(0, ROWS);
  const expectedKey = GROUND_TRUTH.map((i) => LETTERS[i]).join('');
  const gotKey = picksKey(picks);
  const mismatches: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    if (picks[r] !== GROUND_TRUTH[r]) {
      mismatches.push(
        `q${r + 1} got ${picks[r] == null ? '?' : LETTERS[picks[r]!]} want ${LETTERS[GROUND_TRUTH[r]!]}`
      );
    }
  }
  assert(
    mismatches.length === 0,
    `${label}: picks ${gotKey} != ${expectedKey}\n${mismatches.join('\n')}`
  );

  const data = getOmrCanvasImageData(canvas);
  assert(!!data, `${label}: no image data`);
  const overlayMiss: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    const gt = GROUND_TRUTH[r]!;
    const ctr = bubbleCenter(overlay, r, gt);
    assert(!!ctr, `${label}: q${r + 1} sin centro`);
    if (!pointInCell(overlay, r, gt, ctr!.nx, ctr!.ny)) {
      overlayMiss.push(`q${r + 1}: overlay fuera de celda ${LETTERS[gt]}`);
    }
    const gtLuma = sampleLuma(data!, canvas.width, canvas.height, ctr!.nx, ctr!.ny);
    const other: number[] = [];
    for (let c = 0; c < COLS; c++) {
      if (c === gt) continue;
      const o = bubbleCenter(overlay, r, c);
      if (!o) continue;
      other.push(sampleLuma(data!, canvas.width, canvas.height, o.nx, o.ny));
    }
    const otherMin = other.length ? Math.min(...other) : 255;
    if (gtLuma > otherMin + 12) {
      overlayMiss.push(
        `q${r + 1}: overlay de ${LETTERS[gt]} luma=${gtLuma.toFixed(0)} no más oscuro que ${otherMin.toFixed(0)}`
      );
    }
  }
  assert(overlayMiss.length === 0, `${label} overlay:\n${overlayMiss.join('\n')}`);
  console.log(`ok: ${label} picks=${gotKey}`);
}

const fixtures = path.join(process.cwd(), 'fixtures', 'omr');
const pdfCanvas = await canvasFromPdfFile(path.join(fixtures, 'scan-luis-30.pdf'));
const pngPath = path.join(fixtures, 'scan-luis-30.png');
if (!existsSync(pngPath)) {
  const png = (pdfCanvas as unknown as { toBuffer: (t: string) => Buffer }).toBuffer('image/png');
  await writeFile(pngPath, png);
}
gradeCanvas(pdfCanvas, 'pdf');
{
  const t0 = Date.now();
  const pdfNorm = normalizeCalifacilGradeDocumentCanvas(pdfCanvas, COLS, {
    maxSide: 1600,
    flatDocument: true,
    uploadClass: 'pdf',
    rowCount: ROWS,
  });
  const ms = Date.now() - t0;
  assert(pdfNorm.sheetDetected && !!pdfNorm.canvas, 'pdf-normalize: sheetDetected false');
  assert(pdfNorm.canvas!.height > pdfNorm.canvas!.width * 1.05, 'pdf-normalize rotó a landscape');
  assert(ms < 8000, `pdf-normalize too slow: ${ms}ms`);
  gradeCanvas(pdfNorm.canvas!, 'pdf-normalize');
}
gradeCanvas(await canvasFromJpegFile(pngPath), 'png');
{
  const png = await canvasFromJpegFile(pngPath);
  const cls = classifyDesktopUploadCanvas(png, COLS);
  assert(cls === 'flatScan', `png class ${cls} != flatScan`);
  const t0 = Date.now();
  const norm = normalizeCalifacilGradeDocumentCanvas(png, COLS, {
    maxSide: 1600,
    uploadClass: cls,
    rowCount: ROWS,
  });
  const ms = Date.now() - t0;
  assert(norm.sheetDetected && !!norm.canvas, 'png-normalize: sheetDetected false');
  assert(ms < 4000, `png-normalize too slow (congela desktop): ${ms}ms`);
  const ui = scanDesktopGradeUnifiedOrLegacy(norm.canvas!, COLS, ROWS);
  const got = picksKey(ui.picks);
  const want = GROUND_TRUTH.map((i) => LETTERS[i]).join('');
  assert(got === want, `png-ui-scan picks ${got} != ${want}`);
  console.log(`ok: png-ui-scan picks=${got} normalize=${ms}ms`);
}
gradeCanvas(await canvasFromJpegFile(path.join(fixtures, 'scan-luis-30.jpg')), 'jpg');

const desktopUploadPath = path.join(fixtures, 'scan-luis-desktop-upload.jpg');
if (existsSync(desktopUploadPath)) {
  const raw = await canvasFromJpegFile(desktopUploadPath);
  const cls = classifyDesktopUploadCanvas(raw, COLS);
  assert(cls === 'flatScan', `desktop-upload class ${cls} != flatScan`);
  const t0 = Date.now();
  const norm = normalizeCalifacilGradeDocumentCanvas(raw, COLS, {
    maxSide: 1600,
    flatDocument: true,
    uploadClass: cls,
    rowCount: ROWS,
  });
  const ms = Date.now() - t0;
  assert(norm.sheetDetected && !!norm.canvas, 'desktop-upload: sheetDetected false');
  assert(ms < 8000, `desktop-upload normalize too slow: ${ms}ms`);
  gradeCanvas(norm.canvas!, 'desktop-upload');
}

console.log('ok: golden overlay PNG+JPG+PDF 30/30');
