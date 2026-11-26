import { after, NextRequest, NextResponse } from 'next/server';
import { getGatewaySession, getSite, hmacHex, markSessionPaid, notifySiteWithRetries, resultUrl, sameText } from '@/lib/gateway';
import { migrate } from '@/lib/migrate';

// Where Razorpay's hosted checkout (RAZORPAY_HOSTED_CHECKOUT=1, see HostedCheckout) sends the buyer back.
// POST = callback_url: razorpay_payment_id / razorpay_order_id / razorpay_signature when paid, error[…] fields when not.
// GET  = cancel_url: the buyer left Razorpay's page without paying.
// Razorpay's own webhook marks the session paid as well, so a buyer who never comes back is still covered.

function goTo(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

async function load(params: Promise<{ id: string }>) {
  await migrate();
  const id = (await params).id;
  const session = await getGatewaySession(id);
  const site = session && (await getSite(session.site_id));
  return { id, session, site };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id, session, site } = await load(params);
  if (!session || !site) return goTo(`/pay/${encodeURIComponent(id)}`);

  const form = await req.formData().catch(() => null);
  const paymentId = form?.get('razorpay_payment_id');
  const signature = form?.get('razorpay_signature');

  if (typeof paymentId === 'string' && typeof signature === 'string' && session.razorpay_order_id) {
    if (sameText(hmacHex(process.env.RAZORPAY_KEY_SECRET!, `${session.razorpay_order_id}|${paymentId}`), signature)) {
      if (await markSessionPaid(session.razorpay_order_id, paymentId)) after(() => notifySiteWithRetries(id));
      const paid = (await getGatewaySession(id)) ?? session;
      return goTo(resultUrl(site, paid, 'success'));
    }
    console.error('Gateway hosted return: signature mismatch', id);
  } else if (form?.get('error[code]')) {
    console.log('Gateway hosted return: payment failed', id, form.get('error[code]'), form.get('error[reason]'));
  }

  // The webhook may already have marked it paid
  const now = await getGatewaySession(id);
  if (now?.status === 'success') return goTo(resultUrl(site, now, 'success'));
  return goTo(`/pay/${encodeURIComponent(id)}?failed=1`);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id, session, site } = await load(params);
  if (!session || !site) return goTo(`/pay/${encodeURIComponent(id)}`);
  return goTo(resultUrl(site, session, session.status === 'success' ? 'success' : 'cancelled'));
}
