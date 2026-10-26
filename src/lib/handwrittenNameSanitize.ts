/** Etiquetas impresas de la hoja RAF (no son el nombre del alumno). */
const LABEL_WORDS =
  'nombres?|apellidos?|apellido|grupo(?:\\s*y\\s*turno)?|grupoyturno|turno|escuela';

const STANDALONE = new RegExp(`\\b(?:${LABEL_WORDS})\\b`, 'gi');
const GLUED_PREFIX = new RegExp(`(?:^|[\\s,;./-])(?:${LABEL_WORDS})(?=[A-ZÁÉÍÓÚÜÑa-záéíóúüñ])`, 'gi');
const GLUED_START = new RegExp(`^(?:${LABEL_WORDS})(?=[A-ZÁÉÍÓÚÜÑa-záéíóúüñ])`, 'i');

export function stripPrintedSheetLabels(raw: string): string {
  let text = (raw || '').replace(/\u00a0/g, ' ');
  text = text.replace(GLUED_START, '');
  text = text.replace(GLUED_PREFIX, ' ');
  text = text.replace(STANDALONE, ' ');
  return text.replace(/[^A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
