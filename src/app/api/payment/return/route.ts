import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { migrate } from '@/lib/migrate';
import { isValidPlan, type PlanId } from '@/lib/sadhana';
import { grantSubscription, notifyPurchase } from '@/lib/subscriptions';

// Where Razorpay's hosted checkout (RAZORPAY_HOSTED_CHECKOUT=1, /checkout) sends the buyer back.
// POST = callback_url: razorpay_payment_id / razorpay_order_id / razorpay_signature when paid, error[…] when not.
// GET  = cancel_url: the buyer left Razorpay's page without paying.
// Razorpay's POST comes from another site, so the SameSite=Lax login cookie isn't sent with it: the order and
// Razorpay's signature say whose payment it is. The webhook grants the plan too if the buyer never comes back.

interface PaymentRow { id: number; user_id: number; status: string; plan: PlanId; amount: number }

function goTo(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function backToCheckout(plan: string | null, state: 'failed' | 'cancelled') {
  return goTo(isValidPlan(plan) ? `/checkout?${new URLSearchParams({ plan, state })}` : '/payment');
}

function thankYou(paymentId: string, plan: string, amountPaise: number) {
  // track=1: /thank-you sends the Purchase event the popup flow sends before leaving
  return goTo(`/thank-you?${new URLSearchParams({ txn: paymentId, plan, track: '1', value: String(amountPaise / 100) })}`);
}

export async function POST(req: NextRequest) {
  const plan = req.nextUrl.searchParams.get('plan');
  const form = await req.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === 'string' ? v : '';
  };

  let orderId = field('razorpay_order_id');
  const paymentId = field('razorpay_payment_id');
  const signature = field('razorpay_signature');
  if (!orderId) {
    // Failed payments name the order inside error[metadata]
    try {
      orderId = String(JSON.parse(field('error[metadata]') || '{}').order_id ?? '');
    } catch {}
  }
  if (!orderId) return backToCheckout(plan, 'failed');

  await migrate();
  const [payment] = await query<PaymentRow>(
    `SELECT id, user_id, status, plan, amount FROM payments WHERE razorpay_order_id=$1`,
    [orderId]
  );
  if (!payment) return backToCheckout(plan, 'failed');

  if (paymentId && signature) {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      await query(
        `UPDATE payments SET razorpay_payment_id=$1, razorpay_signature=$2, status='success' WHERE id=$3`,
        [paymentId, signature, payment.id]
      );
      // The webhook may have got here first. Whichever call really grants the plan sends the SMS.
      if (isValidPlan(payment.plan)) {
        if (await grantSubscription(payment.user_id, payment.plan, payment.id)) await notifyPurchase(payment.user_id);
      } else console.error('Payment for unknown plan', payment.plan, payment.id);
      return thankYou(paymentId, payment.plan, Number(payment.amount));
    }
    console.error('Hosted return: signature mismatch', payment.id);
  } else if (field('error[code]')) {
    console.log('Hosted return: payment failed', payment.id, field('error[code]'), field('error[reason]'));
  }

  // The webhook may already have recorded it
  const [now] = await query<{ status: string; razorpay_payment_id: string | null }>(
    `SELECT status, razorpay_payment_id FROM payments WHERE id=$1`,
    [payment.id]
  );
  if (now?.status === 'success') return thankYou(now.razorpay_payment_id ?? '', payment.plan, Number(payment.amount));
  return backToCheckout(plan ?? payment.plan, 'failed');
}

export async function GET(req: NextRequest) {
  return backToCheckout(req.nextUrl.searchParams.get('plan'), 'cancelled');
}
