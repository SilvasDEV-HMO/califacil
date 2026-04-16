/**
 * Política de cuándo llamar a `/api/calificar/vision-omr` (GPT-4o-mini).
 * Ajustar coste vs cobertura con variables de entorno públicas (solo flags, sin secretos).
 */

function envBool(name: string): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export const CALIFACIL_VISION_POLICY = {
  /** Filas marcadas como ambiguas por el OMR local. */
  onAmbiguousRows: true,
  /** ≥8 filas con la misma columna pero no todas (posible rejilla desplazada). */
  onManySameColumnAlign: true,
  /** Todas las filas leen la misma columna (sospecha de desalineación sistemática). */
  onAllSameColumn: true,
  /**
   * Tras importar/capturar imagen, segunda pasada sobre toda la hoja (más coste).
   * `NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL=true` en `.env.local`
   */
  onFinalizeEveryRow: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL'),
} as const;
