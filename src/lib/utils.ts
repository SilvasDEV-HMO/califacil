import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateExamUrl(examId: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/examen/${examId}`;
  }
  return `/examen/${examId}`;
}

export function calculatePercentage(score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  return Math.round((score / maxScore) * 100);
}

export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUPERSCRIPT_MINUS = '⁻';
const SUPERSCRIPT_PLUS = '⁺';

function integerToSuperscript(value: string): string {
  const normalized = value.replace(/\s/g, '');
  if (!/^[-+]?\d+$/.test(normalized)) return value;

  let out = '';
  if (normalized.startsWith('-')) out += SUPERSCRIPT_MINUS;
  else if (normalized.startsWith('+')) out += SUPERSCRIPT_PLUS;

  for (const ch of normalized.replace(/^[-+]/, '')) {
    const digit = Number(ch);
    if (Number.isNaN(digit)) return value;
    out += SUPERSCRIPT_DIGITS[digit];
  }
  return out;
}

/** Convierte "3.33x10 4" (texto PDF) a "3.33×10⁴" con exponente visible. */
export function normalizeScientificNotation(text: string): string {
  return text.replace(
    /(\d[\d.]*)\s*[x×]\s*10\s*([+-]?\s*\d+)/gi,
    (_match, mantissa: string, exponent: string) => `${mantissa}×10${integerToSuperscript(exponent)}`
  );
}

/** Convierte "kg/m 2" a "kg/m²" cuando el PDF separa el exponente. */
export function normalizeUnitExponents(text: string): string {
  return text.replace(
    /([a-z]+)\/([a-z]+)\s+(\d+)\b/gi,
    (_match, numerator: string, denominator: string, exponent: string) =>
      `${numerator}/${denominator}${integerToSuperscript(exponent)}`
  );
}

/** Conserva la primera aparición de cada enunciado (sin distinguir mayúsculas/espacios). */
export function dedupeExamQuestions<T extends { text: string }>(questions: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const q of questions) {
    const key = normalizeQuestionText(q.text);
    if (!key) {
      out.push(q);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

export function isQuestionIllustrationImage(value: string): boolean {
  const v = value.trim();
  return v.startsWith('data:image/') || /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(v);
}

export const EXAM_POINTS_CAP = 100;

export function questionPoints(question: { points?: number | null }): number {
  const p = question.points ?? 1;
  return p > 0 ? p : 1;
}

export function examMaxScore(questions: { points?: number | null }[]): number {
  return questions.reduce((s, q) => s + questionPoints(q), 0);
}

/** Reparte 100 puntos enteros entre N preguntas. */
export function distributeExamPoints(questionCount: number): number[] {
  if (questionCount <= 0) return [];
  const base = Math.floor(EXAM_POINTS_CAP / questionCount);
  const remainder = EXAM_POINTS_CAP % questionCount;
  return Array.from({ length: questionCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function normalizeAnswerText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveOptionIndexFromValue(
  options: string[] | null | undefined,
  value: string | null | undefined
): number | null {
  if (!options || options.length === 0) return null;
  const raw = (value ?? '').trim();
  if (!raw) return null;

  const exactIdx = options.findIndex((opt) => normalizeAnswerText(opt) === normalizeAnswerText(raw));
  if (exactIdx >= 0) return exactIdx;

  const letterMatch = raw.match(/^([A-Za-z])(?:[\)\].:\s-]|$)/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return idx;
  }

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  }

  return null;
}

export function isMultipleChoiceAnswerCorrect(
  options: string[] | null | undefined,
  studentAnswer: string | null | undefined,
  correctAnswer: string | null | undefined
): boolean {
  const studentRaw = (studentAnswer ?? '').trim();
  // Vacío / sin marca = incorrecto (nunca acierto por comparar "" === "").
  if (!studentRaw) return false;

  const studentIdx = resolveOptionIndexFromValue(options, studentAnswer);
  const correctIdx = resolveOptionIndexFromValue(options, correctAnswer);
  if (studentIdx !== null && correctIdx !== null) {
    return studentIdx === correctIdx;
  }
  const correctRaw = (correctAnswer ?? '').trim();
  if (!correctRaw) return false;
  return normalizeAnswerText(studentAnswer) === normalizeAnswerText(correctAnswer);
}

export function getGradeLabel(percentage: number): string {
  if (percentage >= 90) return 'Excelente';
  if (percentage >= 80) return 'Muy bien';
  if (percentage >= 70) return 'Bien';
  if (percentage >= 60) return 'Suficiente';
  return 'Necesita mejorar';
}

export function getGradeColor(percentage: number): string {
  if (percentage >= 90) return 'text-green-600';
  if (percentage >= 80) return 'text-orange-600';
  if (percentage >= 70) return 'text-yellow-600';
  if (percentage >= 60) return 'text-amber-700';
  return 'text-red-600';
}
