'use client';

import { useRouter } from 'next/navigation';
import { PRODUCT_PARAMS, track } from '@/lib/pixel';
import type { PlanId } from '@/lib/sadhana';
import RazorpayCheckout from './RazorpayCheckout';

export default function CheckoutPanel({
  user,
  planId,
  pricePaise,
}: {
  user: { name: string | null; phone: string };
  planId: PlanId;
  pricePaise: number;
}) {
  const router = useRouter();
  return (
    <RazorpayCheckout
      amountPaise={pricePaise}
      prefill={{ name: user.name, contact: user.phone }}
      orderUrl="/api/payment/create-order"
      orderBody={{ planId }}
      verifyUrl="/api/payment/verify"
      backHref="/payment"
      helpText={`नमस्ते, मेरे भुगतान की पुष्टि नहीं हो पाई। मोबाइल: ${user.phone}`}
      onOrder={(order) =>
        track('InitiateCheckout', { ...PRODUCT_PARAMS, value: order.amount / 100, currency: 'INR', placement: 'payment' })
      }
      onAlreadyPaid={() => router.replace('/payment')}
      onPaid={(response, order) => {
        track('Purchase', { ...PRODUCT_PARAMS, value: order.amount / 100, currency: 'INR' });
        router.replace(`/thank-you?${new URLSearchParams({ txn: response.razorpay_payment_id, plan: planId })}`);
      }}
    />
  );
}
