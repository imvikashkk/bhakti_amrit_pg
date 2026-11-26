'use client';

import { useEffect } from 'react';
import { PRODUCT_PARAMS, track } from '@/lib/pixel';

// After Razorpay's hosted checkout the buyer lands on /thank-you straight from the server, so the Purchase event
// the popup flow sends before leaving is sent here instead. Once per payment, even if the page is reloaded.
export default function PurchaseTracker({ txn, value }: { txn: string; value: number }) {
  useEffect(() => {
    const key = `purchase_tracked_${txn}`;
    if (!txn || !(value > 0) || localStorage.getItem(key)) return;
    // The pixel script may still be loading
    let tries = 0;
    const id = setInterval(() => {
      if (window.fbq || ++tries > 20) {
        clearInterval(id);
        if (!window.fbq) return;
        track('Purchase', { ...PRODUCT_PARAMS, value, currency: 'INR' });
        localStorage.setItem(key, '1');
      }
    }, 250);
    return () => clearInterval(id);
  }, [txn, value]);
  return null;
}
