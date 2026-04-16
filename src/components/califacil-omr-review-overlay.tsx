'use client';

import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

type Props = {
  geometry: CalifacilOmrScanGeometry;
  /** Índice de columna elegido por fila (0 = A), null si no hay lectura. */
  picks: (number | null)[];
  /** Filas activas en esta hoja (≤ 10). */
  rowCount: number;
};

/**
 * Superpone en la foto de revisión las celdas detectadas y resalta la opción leída por fila.
 */
export function CalifacilOmrReviewOverlay({ geometry, picks, rowCount }: Props) {
  const rows = Math.min(10, rowCount);
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {Array.from({ length: rows }, (_, row) => {
        const rowCells = geometry.cells[row];
        if (!rowCells) return null;
        const pick = picks[row];
        return (
          <g key={row}>
            {rowCells.map((cell, col) => {
              const isChosen = pick !== null && pick === col;
              return (
                <rect
                  key={col}
                  x={cell.x}
                  y={cell.y}
                  width={cell.w}
                  height={cell.h}
                  fill="none"
                  stroke={isChosen ? 'rgba(22,163,74,0.95)' : 'rgba(59,130,246,0.35)'}
                  strokeWidth={isChosen ? 0.008 : 0.004}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
