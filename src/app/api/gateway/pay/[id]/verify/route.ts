import { after, NextRequest, NextResponse } from 'next/server';
import { getGatewaySession, getSite, hmacHex, markSessionPaid, notifySiteWithRetries, resultUrl, sameText } from '@/lib/gateway';
import { migrate } from '@/lib/migrate';

// Called by the /pay page after Razorpay's popup reports success. Razorpay's signature is the proof.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (typeof paymentId !== 'string' || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Missing payment details' }, { status: 400 });
  }

  await migrate();
  const { id } = await params;
  const session = await getGatewaySession(id);
  const site = session && (await getSite(session.site_id));
  if (!session?.razorpay_order_id || !site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!sameText(hmacHex(process.env.RAZORPAY_KEY_SECRET!, `${session.razorpay_order_id}|${paymentId}`), signature)) {
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 });
  }

  if (await markSessionPaid(session.razorpay_order_id, paymentId)) after(() => notifySiteWithRetries(id));
  const paid = (await getGatewaySession(id)) ?? session;
  return NextResponse.json({ redirect: resultUrl(site, paid, 'success') });
}
