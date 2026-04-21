'use client';

import { useId } from 'react';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

type Props = {
  geometry: CalifacilOmrScanGeometry;
  /** Índice de columna elegido por fila (0 = A), null si no hay lectura. */
  picks: (number | null)[];
  /** Índice de columna correcta esperada por fila (0 = A), null si no aplica. */
  expectedPicks?: (number | null)[];
  /** Opacidad visual del overlay esperado (0..1). */
  expectedOpacity?: number;
  /** Filas activas en esta hoja (≤ 10). */
  rowCount: number;
  /** Opcional: recorta el overlay a una región normalizada 0..1. */
  clipRect?: { x: number; y: number; w: number; h: number } | null;
};

/**
 * Superpone en la foto de revisión las celdas detectadas y resalta la opción leída por fila.
 */
export function CalifacilOmrReviewOverlay({
  geometry,
  picks,
  expectedPicks,
  expectedOpacity = 0.55,
  rowCount,
  clipRect = null,
}: Props) {
  const rows = Math.min(10, rowCount);
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

  const toPxCell = (row: number, col: number) => {
    const cell = geometry.cells[row]?.[col];
    if (!cell) return null;
    return {
      x: cell.x * W,
      y: cell.y * H,
      w: cell.w * W,
      h: cell.h * H,
    };
  };

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <defs>
        <filter id="expected-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.008" />
        </filter>
        {clipPx ? (
          <clipPath id={clipId}>
            <rect x={clipPx.x} y={clipPx.y} width={clipPx.w} height={clipPx.h} />
          </clipPath>
        ) : null}
      </defs>
      <g clipPath={clipPx ? `url(#${clipId})` : undefined}>
        {Array.from({ length: rows }, (_, row) => {
          const rowCells = geometry.cells[row];
          if (!rowCells) return null;
          const expectedPick = expectedPicks?.[row] ?? null;
          if (expectedPick === null || expectedPick < 0 || expectedPick >= rowCells.length) return null;
          const cell = toPxCell(row, expectedPick);
          if (!cell) return null;
          return (
            <rect
              key={`expected-${row}`}
              x={cell.x}
              y={cell.y}
              width={cell.w}
              height={cell.h}
              fill={`rgba(234,88,12,${Math.max(0, Math.min(1, expectedOpacity))})`}
              filter="url(#expected-blur)"
            />
          );
        })}
        {Array.from({ length: rows }, (_, row) => {
          const rowCells = geometry.cells[row];
          if (!rowCells) return null;
          const pick = picks[row];
          const expectedPick = expectedPicks?.[row];
          const hasExpected =
            typeof expectedPick === 'number' &&
            expectedPick >= 0 &&
            expectedPick < rowCells.length;

          return (
            <g key={row}>
              {rowCells.map((cell, col) => {
                const pxCell = toPxCell(row, col);
                if (!pxCell) return null;
                const isPicked = pick !== null && pick === col;
                let stroke = 'rgba(59,130,246,0.35)';
                let strokeW = Math.max(1, Math.round(W * 0.002));

                if (isPicked) {
                  if (hasExpected) {
                    stroke =
                      pick === expectedPick
                        ? 'rgba(22,163,74,0.95)'
                        : 'rgba(220,38,38,0.95)';
                    strokeW = Math.max(2, Math.round(W * 0.0055));
                  } else {
                    stroke = 'rgba(22,163,74,0.95)';
                    strokeW = Math.max(2, Math.round(W * 0.005));
                  }
                }

                return (
                  <rect
                    key={col}
                    x={pxCell.x}
                    y={pxCell.y}
                    width={pxCell.w}
                    height={pxCell.h}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeW}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
