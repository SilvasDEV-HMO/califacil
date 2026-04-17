/**
 * Política de cuándo llamar a `/api/calificar/vision-omr` (GPT-4o-mini).
 * Ajustar coste vs cobertura con variables de entorno públicas (solo flags, sin secretos).
 *
 * Requiere en el servidor: `OPENAI_API_KEY` (sin prefijo NEXT_PUBLIC).
 * Sin clave, la API devuelve 503 y solo se usa el lector OMR local.
 *
 * Variables públicas (build-time; reiniciar dev server tras cambiar):
 * - `NEXT_PUBLIC_CALIFACIL_VISION_ON_LIVE_COMMIT` — visión al confirmar desde cámara en vivo.
 *   Por defecto activo si la variable no existe; desactivar con `false`.
 * - `NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL` — segunda pasada IA al importar/capturar toda la hoja.
 *   Por defecto desactivado; activar con `true` (más coste por foto).
 *
 * Ver [.env.example](.env.example) en la raíz del proyecto.
 */

function envBool(name: string): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Por defecto activo si la variable no está definida; desactivar con false. */
function envDefaultTrue(name: string): boolean {
  if (typeof process === 'undefined' || !process.env) return true;
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return true;
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
   * Tras pulsar «Revisar y confirmar» con la cámara en vivo: verificar toda la hoja con visión.
   * Por defecto activo. Desactivar: `NEXT_PUBLIC_CALIFACIL_VISION_ON_LIVE_COMMIT=false`
   */
  onLiveCommitVision: envDefaultTrue('NEXT_PUBLIC_CALIFACIL_VISION_ON_LIVE_COMMIT'),
  /**
   * Tras importar/capturar imagen, segunda pasada sobre toda la hoja (más coste).
   * `NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL=true` en `.env.local`
   */
  onFinalizeEveryRow: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL'),
} as const;
