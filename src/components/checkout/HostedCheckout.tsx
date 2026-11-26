'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Order } from './RazorpayCheckout';

// Razorpay's full-page hosted checkout, in place of the popup (RAZORPAY_HOSTED_CHECKOUT=1).
// Gets the Razorpay order, then posts a form to api.razorpay.com, which shows its own payment page and sends the
// buyer back to `returnPath` (POST when paid or failed, GET when cancelled). After a failed or cancelled payment
// (`notice`) it waits for the buyer instead of sending them straight back to Razorpay.
// Used for our other websites (/pay, GatewayPanel's twin) and for this site's own plans (/checkout).
const HOSTED_URL = 'https://api.razorpay.com/v1/checkout/embedded';

export default function HostedCheckout({
  amountPaise,
  prefill,
  orderUrl,
  orderBody,
  returnPath,
  backHref,
  notice,
  onOrder,
  onAlreadyPaid,
}: {
  amountPaise: number;
  prefill: { name?: string | null; contact?: string | null; email?: string | null };
  orderUrl: string;
  orderBody?: unknown;
  // Same-origin path Razorpay sends the buyer back to; made absolute here
  returnPath: string;
  backHref: string;
  // Shown instead of opening Razorpay straight away, e.g. after a failed payment
  notice?: string;
  onOrder?: (order: Order) => void;
  // The order was refused because there is nothing left to pay (409)
  onAlreadyPaid: (data: { redirect?: string }) => void;
}) {
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(!notice);
  const [error, setError] = useState(notice ?? '');
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(orderUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody ?? {}),
      });
      const data = await res.json();
      if (res.status === 409) {
        onAlreadyPaid(data);
        return;
      }
      if (!res.ok) throw new Error(data.error || '');
      const order = data as Order;
      onOrder?.(order);
      const back = `${window.location.origin}${returnPath}`;
      const next: Record<string, string> = {
        key_id: order.keyId,
        order_id: order.orderId,
        name: 'BA',
        callback_url: back,
        cancel_url: back,
      };
      if (prefill.name) next['prefill[name]'] = prefill.name;
      if (prefill.contact) next['prefill[contact]'] = prefill.contact;
      // Razorpay's hosted page asks for an email; buyers only give a mobile number, so make one from it
      const digits = (prefill.contact ?? '').replace(/\D/g, '').slice(-10);
      const email = prefill.email || (digits ? `${digits}@bhaktiamrit.org` : '');
      if (email) next['prefill[email]'] = email;
      // A moment for tracking pixels to go out before the page is left
      setTimeout(() => setFields(next), onOrder ? 300 : 0);
    } catch (err) {
      setError((err instanceof Error && err.message) || 'कुछ गड़बड़ हो गई, कृपया फिर कोशिश करें');
      setBusy(false);
    }
  }

  // Once the fields are on the form, send the browser to Razorpay
  useEffect(() => {
    if (fields) formRef.current?.submit();
  }, [fields]);

  useEffect(() => {
    if (notice || started.current) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from Razorpay can restore this page as it was left; what is true now is on the server
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  return (
    // No background or text colour of its own: the site's theme shows through
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center font-sans">
      <form ref={formRef} method="POST" action={HOSTED_URL} className="hidden">
        {fields && Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      </form>

      <div className="w-full max-w-xs">
        <p className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5 text-2xl font-bold tracking-wide">
          BA
        </p>
        <p className="mt-8 text-sm">Amount</p>
        <p className="mt-1 text-5xl font-semibold tracking-tight">₹{amountPaise / 100}</p>

        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          className="mt-8 h-14 w-full rounded-xl text-lg font-bold transition-transform active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundColor: '#ffffff', color: '#2b0b06' }}
        >
          {busy ? 'Please wait…' : 'Pay Now'}
        </button>

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-400">
            {error}
          </p>
        )}

        {!busy && (
          <Link href={backHref} className="mt-5 inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline">
            ← Back
          </Link>
        )}
      </div>
    </main>
  );
}
