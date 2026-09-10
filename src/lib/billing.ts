export type PlanKey = 'basic' | 'pro';

export type BillingAccessRow = {
  is_active: boolean | null;
  subscription_status: string | null;
  plan_key?: string | null;
};

export type BillingPlan = {
  key: PlanKey;
  label: string;
  priceLabel: string;
  subtitle: string;
  features: string[];
  stripePriceEnv: 'STRIPE_PRICE_BASIC_MONTHLY' | 'STRIPE_PRICE_PRO_MONTHLY';
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: 'basic',
    label: 'Basica',
    priceLabel: '$49/mes',
    subtitle: 'Precio por Maestro',
    stripePriceEnv: 'STRIPE_PRICE_BASIC_MONTHLY',
    features: ['8 grupos', '300 alumnos', '10 examenes por mes', 'La nube se reinicia al mes'],
  },
  {
    key: 'pro',
    label: 'Pro +',
    priceLabel: '$149/mes',
    subtitle: 'Precio por Maestro',
    stripePriceEnv: 'STRIPE_PRICE_PRO_MONTHLY',
    features: ['Grupos ilimitados', 'Alumnos ilimitados', '30 examenes por mes', 'Nube ilimitada', 'Soporte 24/7'],
  },
];

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'incomplete',
]);

export const PLAN_MONTHLY_EXAM_LIMIT: Record<PlanKey, number> = {
  basic: 10,
  pro: 30,
};

/**
 * Cuentas con acceso completo sin suscripción Stripe ni límites de plan en la app.
 * (Login/dashboard, generación de preguntas con IA, etc.)
 */
const CALIFACIL_SUPERUSER_EMAILS = new Set([
  'admin@califacil.com',
  'profeivanith@gmail.com',
  'docente001@ith.com',
]);

export function isCalifacilSuperUserEmail(email: string | null | undefined) {
  if (!email) return false;
  return CALIFACIL_SUPERUSER_EMAILS.has(email.trim().toLowerCase());
}

export function resolvePlanKey(raw: string | null | undefined): PlanKey {
  return raw === 'pro' ? 'pro' : 'basic';
}

export function isSubscriptionActive(
  row: BillingAccessRow | null | undefined
) {
  if (!row) return false;
  if (row.is_active) return true;
  if (!row.subscription_status) return false;
  return ACTIVE_SUBSCRIPTION_STATUSES.has(row.subscription_status);
}
