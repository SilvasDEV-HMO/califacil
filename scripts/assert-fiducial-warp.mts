/**
 * Homografía: 4 cuadros negros en perspectiva → centros fijos en carta 1230×1600.
 * Run: npx tsx scripts/assert-fiducial-warp.mts
 */
import { createCanvas } from '@napi-rs/canvas';
import { installNodeCanvasShim } from './install-node-canvas-shim.mts';

installNodeCanvasShim();

import { CALIFACIL_FIDUCIAL_CENTERS_NORM } from '../src/lib/printExam.ts';
import { computeHomographySrcToDst } from '../src/lib/omr/homography.ts';
import { prepareCanonicalCalifacilLetterCanvas } from '../src/lib/omr/pipeline.ts';
import {
  califacilWarpLetterPixelSize,
  detectCalifacilQuadFromCornerMarkers,
  detectCalifacilPhotoFiducialQuad,
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

function assertHomographyMapsQuad(
  srcQuad: [Point, Point, Point, Point],
  label: string
): void {
  const letter = califacilWarpLetterPixelSize();
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
  assert(h != null, `${label}: no se pudo calcular homografía src→dst`);
  const ids = ['tl', 'tr', 'br', 'bl'] as const;
  for (let i = 0; i < 4; i++) {
    const mapped = applyH(h!, srcQuad[i]!.x, srcQuad[i]!.y);
    const err = Math.hypot(mapped.x - dst[i]!.x, mapped.y - dst[i]!.y);
    assert(err < 0.75, `${label} ${ids[i]} mapea a ${err.toFixed(2)}px de la plantilla`);
  }
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
assertHomographyMapsQuad(srcQuad, 'perspectiva');

const detectedOpen = detectCalifacilQuadFromCornerMarkers(
  photo as unknown as HTMLCanvasElement
);
assert(detectedOpen != null, 'no se detectaron los 4 cuadritos en fondo claro');

console.log(`ok fiducial warp: ${warped!.width}×${warped!.height} 4 esquinas → plantilla`);

/** Foto tipo monitor: bisel oscuro + teclado; los cuadritos están DENTRO de la pantalla. */
const insetW = 2000;
const insetH = 2600;
const inset = createCanvas(insetW, insetH);
const ictx = inset.getContext('2d');
ictx.fillStyle = '#1a1a1a';
ictx.fillRect(0, 0, insetW, insetH);
ictx.fillStyle = '#2a2a2a';
ictx.fillRect(0, insetH * 0.78, insetW, insetH * 0.22);
const sheet = { x: 380, y: 220, w: 1240, h: 1580 };
ictx.fillStyle = '#f3efe6';
ictx.fillRect(sheet.x, sheet.y, sheet.w, sheet.h);
const insetQuad: [Point, Point, Point, Point] = [
  { x: sheet.x + 48, y: sheet.y + 42 },
  { x: sheet.x + sheet.w - 48, y: sheet.y + 38 },
  { x: sheet.x + sheet.w - 40, y: sheet.y + sheet.h - 44 },
  { x: sheet.x + 44, y: sheet.y + sheet.h - 40 },
];
ictx.fillStyle = '#111111';
for (const p of insetQuad) {
  ictx.fillRect(Math.round(p.x - 16), Math.round(p.y - 16), 32, 32);
}

const detectedInset = detectCalifacilPhotoFiducialQuad(
  inset as unknown as HTMLCanvasElement
);
assert(detectedInset != null, 'no se detectaron cuadritos en la hoja inset (bisel+teclado)');
for (let i = 0; i < 4; i++) {
  const err = Math.hypot(
    detectedInset![i]!.x - insetQuad[i]!.x,
    detectedInset![i]!.y - insetQuad[i]!.y
  );
  assert(err < 28, `inset esquina ${i} a ${err.toFixed(1)}px (no debe ser el bisel)`);
}

const frameAsSheet: [Point, Point, Point, Point] = [
  { x: 2, y: 2 },
  { x: insetW - 3, y: 2 },
  { x: insetW - 3, y: insetH - 3 },
  { x: 2, y: insetH - 3 },
];
for (let i = 0; i < 4; i++) {
  const toFrame = Math.hypot(
    detectedInset![i]!.x - frameAsSheet[i]!.x,
    detectedInset![i]!.y - frameAsSheet[i]!.y
  );
  assert(toFrame > 80, `inset esquina ${i} coincidió con el marco de la foto`);
}

assertHomographyMapsQuad(detectedInset!, 'inset detectado');

const canonical = prepareCanonicalCalifacilLetterCanvas(
  inset as unknown as HTMLCanvasElement,
  { forceWarp: true, fast: false }
);
assert(canonical != null, 'forceWarp no produjo carta desde foto inset');
assert(canonical!.alignment.ok, 'alignment.ok debe ser true tras warp inset');
assert(
  canonical!.canvas.width === letter.width && canonical!.canvas.height === letter.height,
  'carta inset no es 1230×1600'
);

console.log('ok fiducial warp inset: 4 cuadritos dentro del monitor, no el bisel');
