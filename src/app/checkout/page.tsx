import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import CheckoutPanel from '@/components/checkout/CheckoutPanel';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { migrate } from '@/lib/migrate';
import { canPurchase, isValidPlan, purchasePricePaise, SADHANA_DAYS } from '@/lib/sadhana';
import { getProgress } from '@/lib/sadhana-state';
import { getSubscription } from '@/lib/subscriptions';

// Where the plan chosen on /payment is paid for. Deliberately plain: only "BA" is named here and in
// the Razorpay popup. Kept out of /payment/ so that page's loading screen isn't shown on the way.
export const metadata: Metadata = {
  title: 'BA',
  description: 'BA',
  keywords: null,
  openGraph: null,
  robots: { index: false },
};

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const session = await getSession();
  if (!session) redirect('/signup');

  const { plan } = await searchParams;
  if (!isValidPlan(plan)) redirect('/payment');

  await migrate();
  const users = await query<{ name: string | null; phone: string }>(`SELECT name, phone FROM users WHERE id=$1`, [session.userId]);
  if (!users.length) redirect('/signup');
  const sub = await getSubscription(session.userId);
  const finished = (await getProgress(session.userId)).length >= SADHANA_DAYS;
  if (!canPurchase(plan, sub, finished)) redirect('/payment');

  return <CheckoutPanel user={users[0]} planId={plan} pricePaise={purchasePricePaise(plan, sub, finished)} />;
}
