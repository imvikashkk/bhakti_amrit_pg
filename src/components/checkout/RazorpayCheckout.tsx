'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { whatsappLink } from '@/data/site';
import Icon from '../Icon';

interface RazorpayPopup {
  open: () => void;
  close: () => void;
}

export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayPopup;
  }
}

export interface Order {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

// unconfirmed: money may have been taken but we couldn't confirm it, so paying again isn't offered.
type Phase = 'opening' | 'ready' | 'confirming' | 'unconfirmed';

// The plain pay screen: opens Razorpay's popup by itself, with a Pay Now button to open it again.
// Used for this site's own plans (CheckoutPanel) and for our other websites (GatewayPanel).
export default function RazorpayCheckout({
  amountPaise,
  prefill,
  orderUrl,
  orderBody,
  verifyUrl,
  backHref,
  helpText,
  onOrder,
  onAlreadyPaid,
  onPaid,
}: {
  amountPaise: number;
  prefill: { name?: string | null; contact?: string | null; email?: string | null };
  orderUrl: string;
  orderBody?: unknown;
  verifyUrl: string;
  backHref: string;
  helpText: string;
  onOrder?: (order: Order) => void;
  // The order was refused because there is nothing left to pay (409).
  onAlreadyPaid: (data: { redirect?: string }) => void;
  // The server has confirmed the payment. Leaving the page is up to the caller.
  onPaid: (response: RazorpayResponse, order: Order, data: { redirect?: string }) => void;
}) {
  const [phase, setPhase] = useState<Phase>('opening');
  const [error, setError] = useState('');
  const started = useRef(false);
  const mounted = useRef(false);
  // One order per visit: reopening the popup carries on with the same one.
  const order = useRef<Order | null>(null);
  const popup = useRef<RazorpayPopup | null>(null);

  // The popup is outside React, so leaving the page has to take it down.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      popup.current?.close();
      popup.current = null;
    };
  }, []);

  // Back from another site can restore this page as it was left. What is true now is on the server.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  function fail(message: string) {
    setError(message);
    setPhase('ready');
  }

  async function confirm(paid: Order, response: RazorpayResponse) {
    setPhase('confirming');
    let data: { redirect?: string };
    try {
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      });
      if (!res.ok) {
        setPhase('unconfirmed');
        return;
      }
      data = await res.json();
    } catch {
      setPhase('unconfirmed');
      return;
    }
    onPaid(response, paid, data);
  }

  async function openPopup() {
    setError('');
    setPhase('opening');
    try {
      if (!order.current) {
        const res = await fetch(orderUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderBody ?? {}),
        });
        const data = await res.json();
        // Already bought, e.g. in another tab.
        if (res.status === 409) {
          onAlreadyPaid(data);
          return;
        }
        if (!res.ok) {
          fail(data.error || 'कुछ गड़बड़ हो गई, कृपया फिर कोशिश करें');
          return;
        }
        order.current = data as Order;
        onOrder?.(order.current);
      }
      if (!mounted.current) return;
      if (!window.Razorpay) {
        fail('कुछ गड़बड़ हो गई, कृपया फिर कोशिश करें');
        return;
      }

      const current = order.current;
      popup.current = new window.Razorpay({
        key: current.keyId,
        amount: current.amount,
        currency: current.currency,
        order_id: current.orderId,
        name: 'BA',
        prefill: {
          name: prefill.name || undefined,
          contact: prefill.contact || undefined,
          email: prefill.email || undefined,
        },
        theme: { color: '#16161a', backdrop_color: '#0a0a0c' },
        handler: (response: RazorpayResponse) => {
          popup.current = null;
          void confirm(current, response);
        },
        modal: {
          ondismiss: () => {
            popup.current = null;
            setPhase('ready');
          },
        },
      });
      popup.current.open();
    } catch {
      fail('कुछ गड़बड़ हो गई, कृपया फिर कोशिश करें');
    }
  }

  function payNow() {
    // Razorpay's script never loaded (e.g. the network dropped): loading the page again retries it.
    if (!window.Razorpay) window.location.reload();
    else void openPopup();
  }

  const busy = phase === 'opening' || phase === 'confirming';

  return (
    // No background or text colour of its own: the site's theme shows through.
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center font-sans">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onReady={() => {
          if (started.current) return;
          started.current = true;
          void openPopup();
        }}
        onError={() => fail('पेज लोड नहीं हुआ, कृपया फिर कोशिश करें')}
      />

      <div className="w-full max-w-xs">
        <p className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5 text-2xl font-bold tracking-wide">
          BA
        </p>

        {phase === 'unconfirmed' ? (
          <div role="alert">
            <p className="mt-8 text-lg font-semibold">भुगतान की पुष्टि नहीं हो पाई</p>
            <p className="mt-2 text-sm leading-relaxed">
              अगर पैसे कट गए हैं तो चिंता न करें और दोबारा भुगतान न करें — हमें WhatsApp करें।
            </p>
            <a
              href={whatsappLink(helpText)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] text-base font-bold text-white"
            >
              <Icon name="whatsapp" /> WhatsApp करें
            </a>
          </div>
        ) : (
          <>
            <p className="mt-8 text-sm">Amount</p>
            <p className="mt-1 text-5xl font-semibold tracking-tight">₹{amountPaise / 100}</p>

            <button
              type="button"
              onClick={payNow}
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
          </>
        )}
      </div>
    </main>
  );
}
