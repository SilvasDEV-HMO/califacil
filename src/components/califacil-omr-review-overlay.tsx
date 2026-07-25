'use client';

import { useId } from 'react';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

type Props = {
  geometry: CalifacilOmrScanGeometry;
  /** Índice de columna elegido por fila (0 = A), null si no hay lectura. */
  picks: (number | null)[];
  /**
   * Índice de columna correcta esperada por fila (clave DEL EXAMEN ACTIVO).
   * Viene de correct_answer en BD — distinta por cada examen.
   */
  expectedPicks?: (number | null)[];
  /** Opacidad visual del overlay esperado (0..1). */
  expectedOpacity?: number;
  /** Filas activas en esta hoja. */
  rowCount: number;
  /** Opcional: recorta el overlay a una región normalizada 0..1. */
  clipRect?: { x: number; y: number; w: number; h: number } | null;
};

type BubbleCircle = { cx: number; cy: number; r: number };

const RADIUS_SCALE = 0.36;
const SANE_BUBBLE_R_MIN = 0.002;
const SANE_BUBBLE_R_MAX = 0.06;

function isSaneBubbleR(r: number): boolean {
  return Number.isFinite(r) && r > SANE_BUBBLE_R_MIN && r < SANE_BUBBLE_R_MAX;
}

function bubbleSampleToCircle(
  bubble: { cx: number; cy: number; r: number },
  imageW: number,
  imageH: number,
  maxRPx: number
): BubbleCircle {
  const minDim = Math.min(imageW, imageH);
  return {
    cx: bubble.cx * imageW,
    cy: bubble.cy * imageH,
    r: Math.min(maxRPx, Math.max(6, bubble.r * minDim)),
  };
}

function cellToBubbleCircle(
  cell: { x: number; y: number; w: number; h: number },
  imageW: number,
  imageH: number,
  radiusScale = RADIUS_SCALE
): BubbleCircle {
  const pxW = cell.w * imageW;
  const pxH = cell.h * imageH;
  return {
    cx: (cell.x + cell.w * 0.5) * imageW,
    cy: (cell.y + cell.h * 0.5) * imageH,
    r: Math.max(6, Math.min(pxW, pxH) * radiusScale),
  };
}

function resolveCircle(
  bubble: { cx: number; cy: number; r: number } | null | undefined,
  cell: { x: number; y: number; w: number; h: number } | null | undefined,
  imageW: number,
  imageH: number
): BubbleCircle | null {
  const fromCell = cell ? cellToBubbleCircle(cell, imageW, imageH) : null;
  const maxRPx = fromCell?.r ?? Math.min(imageW, imageH) * 0.04;
  // Preferir anillo del engine si r es sane (mismo canvas que el JPEG).
  if (bubble && isSaneBubbleR(bubble.r)) {
    const fromBubble = bubbleSampleToCircle(bubble, imageW, imageH, maxRPx);
    return fromCell
      ? { cx: fromBubble.cx, cy: fromBubble.cy, r: Math.min(fromBubble.r, fromCell.r) }
      : fromBubble;
  }
  return fromCell;
}

/**
 * Bolitas naranja (clave del examen) / verde (acierto) / rojo (error).
 * Coords 0–1 del mismo docCanvas que el preview → encima de las negras.
 */
export function CalifacilOmrReviewOverlay({
  geometry,
  picks,
  expectedPicks,
  expectedOpacity = 0.92,
  rowCount,
  clipRect = null,
}: Props) {
  const rows = Math.min(rowCount, geometry.cells.length);
  const clipId = useId();
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  const clipPx = clipRect
    ? {
        x: clipRect.x * W,
        y: clipRect.y * H,
        w: clipRect.w * W,
        h: clipRect.h * H,
      }
    : null;

  const whiteStroke = 2.5;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <defs>
        {clipPx ? (
          <clipPath id={clipId}>
            <rect x={clipPx.x} y={clipPx.y} width={clipPx.w} height={clipPx.h} />
          </clipPath>
        ) : null}
      </defs>
      <g clipPath={clipPx ? `url(#${clipId})` : undefined}>
        {Array.from({ length: rows }, (_, row) => {
          const rowCells = geometry.cells[row];
          if (!rowCells?.length) return null;

          const pick = picks[row] ?? null;
          const expectedPick = expectedPicks?.[row] ?? null;
          const hasExpected =
            typeof expectedPick === 'number' &&
            expectedPick >= 0 &&
            expectedPick < rowCells.length;

          const expectedCell = hasExpected ? rowCells[expectedPick] : null;
          const expectedBubble = hasExpected ? geometry.bubbles?.[row]?.[expectedPick!] : null;
          const expectedCircle = resolveCircle(expectedBubble, expectedCell, W, H);

          const pickCell =
            pick !== null && pick >= 0 && pick < rowCells.length ? rowCells[pick] : null;
          const pickBubble =
            pick !== null && pick >= 0 ? geometry.bubbles?.[row]?.[pick] : null;
          const pickCircle = resolveCircle(pickBubble, pickCell, W, H);

          const isCorrect = hasExpected && pick !== null && pick === expectedPick;
          const isWrong = hasExpected && pick !== null && pick !== expectedPick;
          const isUnread = hasExpected && pick === null;

          return (
            <g key={row}>
              {expectedCircle && !isCorrect ? (
                <circle
                  cx={expectedCircle.cx}
                  cy={expectedCircle.cy}
                  r={expectedCircle.r}
                  fill={`rgba(234,88,12,${Math.max(0, Math.min(1, expectedOpacity))})`}
                  stroke="rgba(255,255,255,0.98)"
                  strokeWidth={whiteStroke}
                  strokeDasharray={isUnread ? '6 4' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {isCorrect && (pickCircle || expectedCircle) ? (
                <circle
                  cx={(pickCircle ?? expectedCircle)!.cx}
                  cy={(pickCircle ?? expectedCircle)!.cy}
                  r={(pickCircle ?? expectedCircle)!.r}
                  fill="rgba(22,163,74,0.95)"
                  stroke="rgba(255,255,255,0.98)"
                  strokeWidth={whiteStroke}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {isWrong && pickCircle ? (
                <circle
                  cx={pickCircle.cx}
                  cy={pickCircle.cy}
                  r={pickCircle.r}
                  fill="rgba(220,38,38,0.95)"
                  stroke="rgba(255,255,255,0.98)"
                  strokeWidth={whiteStroke}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {!hasExpected && pickCircle ? (
                <circle
                  cx={pickCircle.cx}
                  cy={pickCircle.cy}
                  r={pickCircle.r}
                  fill="rgba(22,163,74,0.9)"
                  stroke="rgba(255,255,255,0.98)"
                  strokeWidth={whiteStroke}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
