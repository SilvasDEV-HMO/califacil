/**
 * Homografía: 4 cuadros negros en perspectiva → centros fijos en carta 1230×1600.
 * Run: npx tsx scripts/assert-fiducial-warp.mts
 */
import { createCanvas } from '@napi-rs/canvas';
import { installNodeCanvasShim } from './install-node-canvas-shim.mts';

installNodeCanvasShim();

import { CALIFACIL_FIDUCIAL_CENTERS_NORM } from '../src/lib/printExam.ts';
import { computeHomographySrcToDst } from '../src/lib/omr/homography.ts';
import {
  califacilWarpLetterPixelSize,
  warpCalifacilSheetFromQuad,
  type Point,
} from '../src/lib/omrScan.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function applyH(
  h: readonly number[],
  x: number,
  y: number
): { x: number; y: number } {
  const [a, b, c, d, e, f, g, hh] = h;
  const den = g! * x + hh! * y + 1;
  return { x: (a! * x + b! * y + c!) / den, y: (d! * x + e! * y + f!) / den };
}

const srcQuad: [Point, Point, Point, Point] = [
  { x: 240, y: 210 },
  { x: 1560, y: 150 },
  { x: 1680, y: 1980 },
  { x: 120, y: 1920 },
];

const photo = createCanvas(1800, 2200);
const pctx = photo.getContext('2d');
pctx.fillStyle = '#e8e4dc';
pctx.fillRect(0, 0, photo.width, photo.height);
pctx.fillStyle = '#111111';
for (const p of srcQuad) {
  pctx.fillRect(Math.round(p.x - 18), Math.round(p.y - 18), 36, 36);
}

const warped = warpCalifacilSheetFromQuad(
  photo as unknown as HTMLCanvasElement,
  srcQuad
);
assert(warped != null, 'warpCalifacilSheetFromQuad devolvió null');

const letter = califacilWarpLetterPixelSize();
assert(warped!.width === letter.width, `ancho ${warped!.width} != ${letter.width}`);
assert(warped!.height === letter.height, `alto ${warped!.height} != ${letter.height}`);

const dst: [Point, Point, Point, Point] = [
  {
    x: CALIFACIL_FIDUCIAL_CENTERS_NORM.tl.x * letter.width,
    y: CALIFACIL_FIDUCIAL_CENTERS_NORM.tl.y * letter.height,
  },
  {
    x: CALIFACIL_FIDUCIAL_CENTERS_NORM.tr.x * letter.width,
    y: CALIFACIL_FIDUCIAL_CENTERS_NORM.tr.y * letter.height,
  },
  {
    x: CALIFACIL_FIDUCIAL_CENTERS_NORM.br.x * letter.width,
    y: CALIFACIL_FIDUCIAL_CENTERS_NORM.br.y * letter.height,
  },
  {
    x: CALIFACIL_FIDUCIAL_CENTERS_NORM.bl.x * letter.width,
    y: CALIFACIL_FIDUCIAL_CENTERS_NORM.bl.y * letter.height,
  },
];
const h = computeHomographySrcToDst(srcQuad, dst);
assert(h != null, 'no se pudo calcular homografía src→dst');
const ids = ['tl', 'tr', 'br', 'bl'] as const;
for (let i = 0; i < 4; i++) {
  const mapped = applyH(h!, srcQuad[i]!.x, srcQuad[i]!.y);
  const err = Math.hypot(mapped.x - dst[i]!.x, mapped.y - dst[i]!.y);
  assert(err < 0.75, `${ids[i]} mapea a ${err.toFixed(2)}px de la plantilla`);
}

console.log(`ok fiducial warp: ${warped!.width}×${warped!.height} 4 esquinas → plantilla`);
