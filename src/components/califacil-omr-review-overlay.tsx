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
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <filter id="expected-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.008" />
        </filter>
        {clipRect ? (
          <clipPath id={clipId}>
            <rect x={clipRect.x} y={clipRect.y} width={clipRect.w} height={clipRect.h} />
          </clipPath>
        ) : null}
      </defs>
      <g clipPath={clipRect ? `url(#${clipId})` : undefined}>
        {Array.from({ length: rows }, (_, row) => {
          const rowCells = geometry.cells[row];
          if (!rowCells) return null;
          const expectedPick = expectedPicks?.[row] ?? null;
          if (expectedPick === null || expectedPick < 0 || expectedPick >= rowCells.length) return null;
          const pick = picks[row] ?? null;
          // Mostrar la esperada solo cuando hay discrepancia (o sin lectura):
          // si ya coincide, el verde basta y el naranja añade ruido visual.
          const shouldPaintExpected = pick === null || pick !== expectedPick;
          if (!shouldPaintExpected) return null;
          const cell = rowCells[expectedPick];
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
                const isPicked = pick !== null && pick === col;
                let stroke = 'rgba(59,130,246,0.35)';
                let strokeW = 0.004;

                if (isPicked) {
                  if (hasExpected) {
                    stroke =
                      pick === expectedPick
                        ? 'rgba(22,163,74,0.95)'
                        : 'rgba(220,38,38,0.95)';
                    strokeW = 0.009;
                  } else {
                    stroke = 'rgba(22,163,74,0.95)';
                    strokeW = 0.008;
                  }
                }

                return (
                  <rect
                    key={col}
                    x={cell.x}
                    y={cell.y}
                    width={cell.w}
                    height={cell.h}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeW}
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
