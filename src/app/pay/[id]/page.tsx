import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import GatewayPanel from '@/components/checkout/GatewayPanel';
import { getGatewaySession, getSite, resultUrl } from '@/lib/gateway';
import { migrate } from '@/lib/migrate';

// Where our other websites send their buyers to pay. No login: the session id can't be guessed.
export const metadata: Metadata = {
  title: 'BA',
  description: 'BA',
  keywords: null,
  openGraph: null,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

function Message({ text, backUrl }: { text: string; backUrl?: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center font-sans">
      <p className="text-lg font-semibold">{text}</p>
      {backUrl && (
        <a href={backUrl} className="mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          ← Back
        </a>
      )}
    </main>
  );
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  await migrate();
  const session = await getGatewaySession((await params).id);
  const site = session && (await getSite(session.site_id));
  if (!session || !site) return <Message text="यह payment link सही नहीं है" />;
  if (session.status === 'success') redirect(resultUrl(site, session, 'success'));

  const cancelUrl = resultUrl(site, session, 'cancelled');
  if (session.expired || !site.active) return <Message text="यह payment link अब मान्य नहीं है" backUrl={cancelUrl} />;

  return (
    <GatewayPanel
      sessionId={session.id}
      amountPaise={session.amount}
      customer={{ name: session.customer_name, phone: session.customer_phone, email: session.customer_email }}
      cancelUrl={cancelUrl}
      hosted={process.env.RAZORPAY_HOSTED_CHECKOUT === '1'}
      failed={(await searchParams).failed === '1'}
    />
  );
}
