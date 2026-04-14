/**
 * Lectura aproximada de la banda CaliFacil del pie de hoja impresa.
 * Debe coincidir con el layout de `printExam.ts` (tabla 10 filas × N columnas de burbujas).
 */

export const CALIFACIL_OMR_SCAN = {
  /** Fracción inferior de la imagen donde cae el recuadro CaliFacil impreso */
  bottomBandRatio: 0.46,
  /** Parte superior de esa banda reservada al título (se ignora al muestrear) */
  titleStripRatioOfBand: 0.16,
  /** Ancho relativo reservado a la columna del número de pregunta */
  qnumWidthRatio: 0.09,
  /** Intensidad mínima de relleno real (centro más oscuro que el anillo impreso) */
  minMarkDarkness: 0.06,
  /** Ventaja mínima de la mejor burbuja contra la segunda */
  minBestVsSecondGap: 0.03,
} as const;

type ScanThresholds = {
  minMarkDarkness: number;
  minBestVsSecondGap: number;
};

type ScanDetailedResult = {
  picks: (number | null)[];
  resolvedCount: number;
  confidenceSum: number;
};

type Point = { x: number; y: number };

type LineXFromY = { m: number; b: number }; // x = m*y + b
type LineYFromX = { m: number; b: number }; // y = m*x + b

function sampleDiskDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): number {
  let sum = 0;
  let n = 0;
  const r2 = radiusPx * radiusPx;
  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function sampleAnnulusDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  innerRadiusPx: number,
  outerRadiusPx: number
): number {
  let sum = 0;
  let n = 0;
  const in2 = innerRadiusPx * innerRadiusPx;
  const out2 = outerRadiusPx * outerRadiusPx;
  for (let dy = -outerRadiusPx; dy <= outerRadiusPx; dy++) {
    for (let dx = -outerRadiusPx; dx <= outerRadiusPx; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > out2 || d2 < in2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function drawSourceToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxSide = 1100
): HTMLCanvasElement | null {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (srcW < 40 || srcH < 40) return null;

  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

function rotateCanvas(canvas: HTMLCanvasElement, angleDeg: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (angleDeg === 0) return canvas;
  const out = document.createElement('canvas');
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (angleDeg === 180) {
    out.width = srcW;
    out.height = srcH;
  } else {
    out.width = srcH;
    out.height = srcW;
  }
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  if (angleDeg === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (angleDeg === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function rotateCanvasByDegrees(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.max(1, Math.round(canvas.width * cos + canvas.height * sin));
  const outH = Math.max(1, Math.round(canvas.width * sin + canvas.height * cos));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;

  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function fitLineXFromY(points: Point[]): LineXFromY | null {
  if (points.length < 6) return null;
  let sumY = 0;
  let sumX = 0;
  let sumYY = 0;
  let sumYX = 0;
  for (const p of points) {
    sumY += p.y;
    sumX += p.x;
    sumYY += p.y * p.y;
    sumYX += p.y * p.x;
  }
  const n = points.length;
  const den = n * sumYY - sumY * sumY;
  if (Math.abs(den) < 1e-6) return null;
  const m = (n * sumYX - sumY * sumX) / den;
  const b = (sumX - m * sumY) / n;
  return { m, b };
}

function fitLineYFromX(points: Point[]): LineYFromX | null {
  if (points.length < 6) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }
  const n = points.length;
  const den = n * sumXX - sumX * sumX;
  if (Math.abs(den) < 1e-6) return null;
  const m = (n * sumXY - sumX * sumY) / den;
  const b = (sumY - m * sumX) / n;
  return { m, b };
}

function intersectLineXFromYAndYFromX(lineX: LineXFromY, lineY: LineYFromX): Point | null {
  const den = 1 - lineX.m * lineY.m;
  if (Math.abs(den) < 1e-6) return null;
  const x = (lineX.m * lineY.b + lineX.b) / den;
  const y = lineY.m * x + lineY.b;
  return { x, y };
}

function solveLinearSystem8(matrix: number[][], rhs: number[]): number[] | null {
  const n = 8;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-10) return null;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const div = a[col][col];
    for (let c = col; c <= n; c++) a[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row[n]);
}

function computeHomographyFromRectToQuad(
  dstWidth: number,
  dstHeight: number,
  quad: [Point, Point, Point, Point]
): number[] | null {
  const srcPts: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: dstWidth - 1, y: 0 },
    { x: dstWidth - 1, y: dstHeight - 1 },
    { x: 0, y: dstHeight - 1 },
  ];
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const u = srcPts[i].x;
    const v = srcPts[i].y;
    const x = quad[i].x;
    const y = quad[i].y;
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    rhs.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    rhs.push(y);
  }
  const sol = solveLinearSystem8(matrix, rhs);
  if (!sol) return null;
  return sol; // [a,b,c,d,e,f,g,h]
}

function sampleBilinear(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v00 = data[i00 + c];
    const v10 = data[i10 + c];
    const v01 = data[i01 + c];
    const v11 = data[i11 + c];
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;
    out[c] = v0 * (1 - ty) + v1 * ty;
  }
  return out;
}

function detectCalifacilQuad(canvas: HTMLCanvasElement): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 120 || height < 120) return null;

  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;
  const rowCounts = new Array<number>(height).fill(0);
  const colCounts = new Array<number>(width).fill(0);

  let darkSum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const darkness = 1 - lum;
      darkSum += darkness;
      n++;
    }
  }
  const avgDark = darkSum / Math.max(1, n);
  const darkThreshold = Math.min(0.5, Math.max(0.22, avgDark + 0.16));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const darkness = 1 - lum;
      if (darkness >= darkThreshold) {
        rowCounts[y]++;
        colCounts[x]++;
      }
    }
  }

  const rowMin = Math.max(8, Math.floor(width * 0.1));
  const colMin = Math.max(8, Math.floor(height * 0.1));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] >= rowMin) {
      top = y;
      break;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (rowCounts[y] >= rowMin) {
      bottom = y;
      break;
    }
  }
  for (let x = 0; x < width; x++) {
    if (colCounts[x] >= colMin) {
      left = x;
      break;
    }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (colCounts[x] >= colMin) {
      right = x;
      break;
    }
  }
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom - top < height * 0.22 || right - left < width * 0.22) return null;

  const y0 = Math.max(0, top - Math.floor(height * 0.03));
  const y1 = Math.min(height - 1, bottom + Math.floor(height * 0.03));
  const x0 = Math.max(0, left - Math.floor(width * 0.03));
  const x1 = Math.min(width - 1, right + Math.floor(width * 0.03));

  const leftPts: Point[] = [];
  const rightPts: Point[] = [];
  const topPts: Point[] = [];
  const bottomPts: Point[] = [];
  const midX = Math.floor((x0 + x1) / 2);
  const midY = Math.floor((y0 + y1) / 2);

  for (let y = y0; y <= y1; y += 2) {
    let lx = -1;
    for (let x = x0; x <= midX; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        lx = x;
        break;
      }
    }
    if (lx >= 0) leftPts.push({ x: lx, y });

    let rx = -1;
    for (let x = x1; x >= midX; x--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        rx = x;
        break;
      }
    }
    if (rx >= 0) rightPts.push({ x: rx, y });
  }

  for (let x = x0; x <= x1; x += 2) {
    let ty = -1;
    for (let y = y0; y <= midY; y++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        ty = y;
        break;
      }
    }
    if (ty >= 0) topPts.push({ x, y: ty });

    let by = -1;
    for (let y = y1; y >= midY; y--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        by = y;
        break;
      }
    }
    if (by >= 0) bottomPts.push({ x, y: by });
  }

  const l = fitLineXFromY(leftPts);
  const r = fitLineXFromY(rightPts);
  const t = fitLineYFromX(topPts);
  const b = fitLineYFromX(bottomPts);
  if (!l || !r || !t || !b) return null;

  const tl = intersectLineXFromYAndYFromX(l, t);
  const tr = intersectLineXFromYAndYFromX(r, t);
  const br = intersectLineXFromYAndYFromX(r, b);
  const bl = intersectLineXFromYAndYFromX(l, b);
  if (!tl || !tr || !br || !bl) return null;

  const quad: [Point, Point, Point, Point] = [tl, tr, br, bl];
  const inside = quad.every(
    (p) => p.x >= -width * 0.1 && p.x <= width * 1.1 && p.y >= -height * 0.1 && p.y <= height * 1.1
  );
  if (!inside) return null;
  const area =
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y)
    ) * 0.5;
  if (area < width * height * 0.08) return null;
  return quad;
}

function warpPerspectiveToRect(
  canvas: HTMLCanvasElement,
  quad: [Point, Point, Point, Point]
): HTMLCanvasElement | null {
  const topW = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const bottomW = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const leftH = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const rightH = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
  const outW = Math.max(120, Math.round((topW + bottomW) * 0.5));
  const outH = Math.max(120, Math.round((leftH + rightH) * 0.5));

  const h = computeHomographyFromRectToQuad(outW, outH, quad);
  if (!h) return null;
  const [a, b, c, d, e, f, g, hh] = h;

  const srcCtx = canvas.getContext('2d');
  if (!srcCtx) return null;
  const src = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const srcData = src.data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d');
  if (!outCtx) return null;
  const outId = outCtx.createImageData(outW, outH);
  const outData = outId.data;

  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const den = g * u + hh * v + 1;
      if (Math.abs(den) < 1e-9) continue;
      const x = (a * u + b * v + c) / den;
      const y = (d * u + e * v + f) / den;
      const outIdx = (v * outW + u) * 4;
      if (x < 0 || y < 0 || x >= canvas.width - 1 || y >= canvas.height - 1) {
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
        outData[outIdx + 3] = 255;
        continue;
      }
      const [r, gg, bb, aa] = sampleBilinear(srcData, canvas.width, canvas.height, x, y);
      outData[outIdx] = r;
      outData[outIdx + 1] = gg;
      outData[outIdx + 2] = bb;
      outData[outIdx + 3] = aa;
    }
  }
  outCtx.putImageData(outId, 0, 0);
  return out;
}

function applyPerspectiveCorrection(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const quad = detectCalifacilQuad(canvas);
  if (!quad) return canvas;
  return warpPerspectiveToRect(canvas, quad) ?? canvas;
}

function scanCalifacilOmrCanvasDetailed(
  canvas: HTMLCanvasElement,
  columns: number,
  thresholds: ScanThresholds
): ScanDetailedResult {
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const out: (number | null)[] = Array(10).fill(null);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { picks: out, resolvedCount: 0, confidenceSum: 0 };
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = id;

  const bandH = height * CALIFACIL_OMR_SCAN.bottomBandRatio;
  const bandTop = height - bandH;
  const dataTop = bandTop + bandH * CALIFACIL_OMR_SCAN.titleStripRatioOfBand;
  const dataHeight = bandH * (1 - CALIFACIL_OMR_SCAN.titleStripRatioOfBand);
  const rowH = dataHeight / 10;

  const qNumW = width * CALIFACIL_OMR_SCAN.qnumWidthRatio;
  const bubbleAreaLeft = qNumW;
  const bubbleAreaW = width - bubbleAreaLeft;
  const cellW = bubbleAreaW / cols;
  const radiusPx = Math.max(2, Math.min(cellW, rowH) * 0.22);

  let resolvedCount = 0;
  let confidenceSum = 0;
  for (let row = 0; row < 10; row++) {
    const cy = dataTop + (row + 0.5) * rowH;
    const scores: number[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = bubbleAreaLeft + (c + 0.5) * cellW;
      const fillDark = sampleDiskDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(2, Math.round(radiusPx * 0.5))
      );
      const ringDark = sampleAnnulusDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(1, Math.round(radiusPx * 0.62)),
        Math.max(2, Math.round(radiusPx))
      );
      // Burbuja vacía: anillo oscuro y centro claro => score bajo/negativo.
      // Burbuja rellena: centro oscuro y diferencia positiva => score alto.
      scores.push(fillDark - ringDark * 0.9);
    }
    const sorted = [...scores].sort((a, b) => b - a);
    const best = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    const gap = best - second;
    if (best < thresholds.minMarkDarkness) {
      out[row] = null;
      continue;
    }
    if (cols >= 2 && gap < thresholds.minBestVsSecondGap) {
      out[row] = null;
      continue;
    }
    let bestIdx = 0;
    for (let c = 1; c < cols; c++) {
      if (scores[c] > scores[bestIdx]) bestIdx = c;
    }
    out[row] = bestIdx;
    resolvedCount++;
    confidenceSum += best + gap;
  }
  return { picks: out, resolvedCount, confidenceSum };
}

function estimateBottomBandInk(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const w = canvas.width;
  const h = canvas.height;
  const y0 = Math.max(0, Math.floor(h * (1 - CALIFACIL_OMR_SCAN.bottomBandRatio)));
  const hh = Math.max(1, h - y0);
  const id = ctx.getImageData(0, y0, w, hh);
  const d = id.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    sum += 1 - lum;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * @param columns — Número de columnas de burbujas impresas (2–5)
 * @returns Siempre 10 entradas: índice de columna elegida (0 = A) o null si no hay lectura clara
 */
export function scanCalifacilOmrSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number
): (number | null)[] {
  if (typeof document === 'undefined') return Array(10).fill(null);
  const canvas = drawSourceToCanvas(source);
  if (!canvas) return Array(10).fill(null);
  return scanCalifacilOmrCanvasDetailed(canvas, columns, {
    minMarkDarkness: CALIFACIL_OMR_SCAN.minMarkDarkness,
    minBestVsSecondGap: CALIFACIL_OMR_SCAN.minBestVsSecondGap,
  }).picks;
}

/**
 * Auto-orienta la foto para que la banda CaliFacil quede en la posición esperada.
 * Prueba 0/90/180/270 y se queda con la orientación con mayor evidencia de marcas válidas.
 */
export function autoOrientCalifacilSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const base = drawSourceToCanvas(source, 1400);
  if (!base) return null;

  const candidates: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let bestCanvas: HTMLCanvasElement = base;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCardinal: 0 | 90 | 180 | 270 = 0;

  for (const angle of candidates) {
    const rotated = rotateCanvas(base, angle);
    const detail = scanCalifacilOmrCanvasDetailed(rotated, columns, {
      minMarkDarkness: 0.04,
      minBestVsSecondGap: 0.02,
    });
    const bandInk = estimateBottomBandInk(rotated);
    const score = bandInk * 2000 + detail.resolvedCount * 100 + detail.confidenceSum * 10;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = rotated;
      bestCardinal = angle;
    }
  }

  // Ajuste fino para fotos ligeramente inclinadas.
  // Se aplica sobre el ángulo cardinal elegido para mejorar "derechita".
  for (let delta = -12; delta <= 12; delta += 2) {
    if (delta === 0) continue;
    const tilted = rotateCanvasByDegrees(bestCanvas, delta);
    const detail = scanCalifacilOmrCanvasDetailed(tilted, columns, {
      minMarkDarkness: 0.04,
      minBestVsSecondGap: 0.02,
    });
    const bandInk = estimateBottomBandInk(tilted);
    const score = bandInk * 2000 + detail.resolvedCount * 100 + detail.confidenceSum * 10;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = tilted;
    }
  }

  // Evita variable no usada cuando el compilador endurece reglas.
  void bestCardinal;
  return applyPerspectiveCorrection(bestCanvas);
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}
