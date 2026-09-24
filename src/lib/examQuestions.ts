import type { Question } from '@/types';

type QuestionOrderFields = Pick<Question, 'sort_order' | 'created_at'> & { text?: string | null };

/** «Reactivo 12» → 12. Si el enunciado no trae número, no altera el orden. */
export function reactivoNumber(text: string | null | undefined): number | null {
  const match = String(text ?? '').match(/reactivo\s*(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** Si el enunciado es «Reactivo N», ese número manda. Si no, sort_order y luego created_at. */
export function sortExamQuestions<T extends QuestionOrderFields>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const an = reactivoNumber(a.text);
    const bn = reactivoNumber(b.text);
    if (an != null && bn != null && an !== bn) return an - bn;
    const ao = a.sort_order;
    const bo = b.sort_order;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  });
}

export function isMissingSortOrderColumnError(message: string | undefined): boolean {
  if (!message) return false;
  return /sort_order/i.test(message) && /column|schema cache|does not exist/i.test(message);
}
