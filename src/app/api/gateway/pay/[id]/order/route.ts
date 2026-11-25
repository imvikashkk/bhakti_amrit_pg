import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getGatewaySession, getSite, resultUrl } from '@/lib/gateway';
import { migrate } from '@/lib/migrate';
import { getRazorpay } from '@/lib/razorpay';

// Called by the /pay page. The amount comes from the session, never from the browser.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await migrate();
  const session = await getGatewaySession((await params).id);
  const site = session && (await getSite(session.site_id));
  if (!session || !site) return NextResponse.json({ error: 'यह payment link सही नहीं है' }, { status: 404 });
  if (session.status === 'success') return NextResponse.json({ redirect: resultUrl(site, session, 'success') }, { status: 409 });
  if (session.expired || !site.active) return NextResponse.json({ error: 'यह payment link अब मान्य नहीं है' }, { status: 410 });

  try {
    // One Razorpay order per session, so it can only be paid once however often the page is opened.
    let orderId = session.razorpay_order_id;
    if (!orderId) {
      const order = await getRazorpay().orders.create({
        amount: session.amount,
        currency: 'INR',
        receipt: session.id,
        notes: { gatewaySite: site.domain, gatewayRef: session.ref, gatewaySession: session.id },
      });
      await query(`UPDATE gateway_sessions SET razorpay_order_id=$1 WHERE id=$2 AND razorpay_order_id IS NULL`, [order.id, session.id]);
      // If the page was open twice, whichever order was saved first is the one both use.
      orderId = (await getGatewaySession(session.id))?.razorpay_order_id ?? null;
    }
    return NextResponse.json({ orderId, amount: session.amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Gateway order failed', session.id, err);
    return NextResponse.json({ error: 'कुछ गड़बड़ हो गई, कृपया फिर कोशिश करें' }, { status: 500 });
  }
}
