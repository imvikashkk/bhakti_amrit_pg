// Hanuman 40-din saadhana ke plans. Dashboard, order aur payment page ke daam yahin se aate hain.
// Purane users isi database me hain, isliye plan ids mat badalna.

export const PRODUCT = 'hanuman-40';
export const PRODUCT_NAME = 'हनुमान स्तुति साधना';
export const SADHANA_DAYS = 40;
// A new day opens this long after the previous one was completed.
export const COOLDOWN_HOURS = 12;

export type PlanId = 'trial' | 'full' | 'months3' | 'months6' | 'yearly' | 'lifetime';

export interface Plan {
  id: PlanId;
  label: string;
  tagline: string;
  pricePaise: number;
  // Strike-through "asli keemat" shown next to the price, if any.
  mrpRupees?: number;
  // Days after purchase until access lapses. null = never expires.
  durationDays: number | null;
  dayLimit: number;
  // May start the 40 days over after finishing them, for as long as the plan is active.
  canRestart: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  // Retired — kept so existing trial users still rank correctly.
  trial: { id: 'trial', label: '3-दिन ट्रायल', tagline: 'पहले 3 दिन आज़माएं', pricePaise: 1100, durationDays: null, dayLimit: 3, canRestart: false },
  full: { id: 'full', label: '40-दिन साधना', tagline: 'पूरी 40 दिन की साधना, एक बार', pricePaise: 16900, durationDays: null, dayLimit: SADHANA_DAYS, canRestart: false },
  months3: { id: 'months3', label: '3 महीने एक्सेस', tagline: '3 महीने तक, जितनी बार चाहें दोहराएं', pricePaise: 19900, durationDays: 90, dayLimit: SADHANA_DAYS, canRestart: true },
  months6: { id: 'months6', label: '6 महीने एक्सेस', tagline: '6 महीने तक, जितनी बार चाहें दोहराएं', pricePaise: 29900, durationDays: 180, dayLimit: SADHANA_DAYS, canRestart: true },
  yearly: { id: 'yearly', label: '1 साल एक्सेस', tagline: '1 साल तक, जितनी बार चाहें दोहराएं', pricePaise: 39900, durationDays: 365, dayLimit: SADHANA_DAYS, canRestart: true },
  // No longer sold — kept so anyone who has it keeps it.
  lifetime: { id: 'lifetime', label: 'Lifetime', tagline: 'जीवनभर पहुंच + जितनी बार चाहें दोहराएं', pricePaise: 89900, durationDays: null, dayLimit: SADHANA_DAYS, canRestart: true },
};

// Purchasable plans, lowest to highest rank.
export const PLAN_ORDER: PlanId[] = ['full', 'months3', 'months6', 'yearly'];
// Lowest to highest, including plans no longer sold, so a retired plan is never replaced by a lower one.
const PLAN_RANK: PlanId[] = [...PLAN_ORDER, 'lifetime'];
export const DEFAULT_PLAN: PlanId = 'yearly';

export interface Subscription {
  plan: PlanId;
  expires_at: string | null;
}

export function isValidPlan(id: unknown): id is PlanId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PLANS, id);
}

export function planRank(id: PlanId | null | undefined): number {
  return id ? PLAN_RANK.indexOf(id) : -1;
}

export function isPlanExpired(expiresAt: string | Date | null | undefined): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

// Once a plan has expired any plan can be bought; until then only a higher-ranked one, as an upgrade.
// 'full' never expires, so a time-limited plan would trade permanent access for a few months: those
// open up once its 40 days are finished (`finished`).
export function canPurchase(target: PlanId, sub: Subscription | null, finished: boolean): boolean {
  if (!PLAN_ORDER.includes(target)) return false;
  // Nothing left to do on a plan that can't be repeated.
  if (finished && !PLANS[target].canRestart) return false;
  if (!sub || isPlanExpired(sub.expires_at)) return true;
  if (sub.plan === 'full' && PLANS[target].durationDays !== null && !finished) return false;
  return planRank(target) > planRank(sub.plan);
}

// Upgrade credit (the current plan's price) only applies while the current plan still has something
// left to give: not once it has expired, nor once the 40-day plan has been finished.
export function purchasePricePaise(target: PlanId, sub: Subscription | null, finished: boolean): number {
  const price = PLANS[target].pricePaise;
  if (!sub || isPlanExpired(sub.expires_at) || (sub.plan === 'full' && finished)) return price;
  // Razorpay's minimum is ₹1, and a credit must never push an order below it.
  return Math.max(price - (PLANS[sub.plan]?.pricePaise ?? 0), 100);
}

// `CASE column WHEN 'id' THEN rank ... END` — retired plans map to -1 instead of SQL NULL.
export function planRankSqlCase(column: string): string {
  const whens = (Object.keys(PLANS) as PlanId[]).map((id) => `WHEN '${id}' THEN ${planRank(id)}`).join(' ');
  return `(CASE ${column} ${whens} ELSE -1 END)`;
}

export function hasActiveAccess(sub: Subscription | null): boolean {
  return !!sub && !isPlanExpired(sub.expires_at);
}

export interface DayProgress {
  day_number: number;
  completed_at: string | Date;
}

// Where the sadhak stands today. `now` is passed in so callers stay pure. Testers get every
// day, with no plan limit and no waiting.
export function getDayStatus(progress: DayProgress[], sub: Subscription | null, tester: boolean, now: number) {
  const completedAt = new Map(progress.map((p) => [p.day_number, new Date(p.completed_at).getTime()]));
  const dayLimit = tester ? SADHANA_DAYS : Math.min(sub ? (PLANS[sub.plan]?.dayLimit ?? 0) : 0, SADHANA_DAYS);
  const totalCompleted = completedAt.size;
  const planComplete = totalCompleted >= dayLimit;
  const fullyComplete = totalCompleted >= SADHANA_DAYS;

  let nextDay: number | null = null;
  if (!planComplete) {
    for (let d = 1; d <= dayLimit && nextDay === null; d++) if (!completedAt.has(d)) nextDay = d;
  }
  const previous = nextDay && nextDay > 1 ? completedAt.get(nextDay - 1) : undefined;
  const unlockAt = !tester && previous ? previous + COOLDOWN_HOURS * 3600000 : 0;
  const nextLocked = unlockAt > now;

  return {
    completedDays: new Set(completedAt.keys()),
    dayLimit,
    totalCompleted,
    planComplete,
    fullyComplete,
    nextDay,
    unlockAt,
    nextLocked,
    canOpen(day: number) {
      if (!Number.isInteger(day) || day < 1 || day > SADHANA_DAYS) return false;
      if (tester || completedAt.has(day)) return true;
      return day === nextDay && !nextLocked;
    },
  };
}
