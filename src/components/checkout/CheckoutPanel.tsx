'use client';

import { useRouter } from 'next/navigation';
import { PRODUCT_PARAMS, track } from '@/lib/pixel';
import type { PlanId } from '@/lib/sadhana';
import HostedCheckout from './HostedCheckout';
import RazorpayCheckout, { type Order } from './RazorpayCheckout';

export default function CheckoutPanel({
  user,
  planId,
  pricePaise,
  hosted = false,
  notice,
}: {
  user: { name: string | null; phone: string };
  planId: PlanId;
  pricePaise: number;
  // RAZORPAY_HOSTED_CHECKOUT=1: Razorpay's own payment page instead of the popup.
  // The Purchase event then fires on /thank-you (PurchaseTracker), where the buyer lands.
  hosted?: boolean;
  // Back from a failed / cancelled hosted payment
  notice?: string;
}) {
  const router = useRouter();
  const onOrder = (order: Order) =>
    track('InitiateCheckout', { ...PRODUCT_PARAMS, value: order.amount / 100, currency: 'INR', placement: 'payment' });
  const prefill = { name: user.name, contact: user.phone };

  if (hosted) {
    return (
      <HostedCheckout
        amountPaise={pricePaise}
        prefill={prefill}
        orderUrl="/api/payment/create-order"
        orderBody={{ planId }}
        returnPath={`/api/payment/return?${new URLSearchParams({ plan: planId })}`}
        backHref="/payment"
        notice={notice}
        onOrder={onOrder}
        onAlreadyPaid={() => router.replace('/payment')}
      />
    );
  }

  return (
    <RazorpayCheckout
      amountPaise={pricePaise}
      prefill={prefill}
      orderUrl="/api/payment/create-order"
      orderBody={{ planId }}
      verifyUrl="/api/payment/verify"
      backHref="/payment"
      helpText={`नमस्ते, मेरे भुगतान की पुष्टि नहीं हो पाई। मोबाइल: ${user.phone}`}
      onOrder={onOrder}
      onAlreadyPaid={() => router.replace('/payment')}
      onPaid={(response, order) => {
        track('Purchase', { ...PRODUCT_PARAMS, value: order.amount / 100, currency: 'INR' });
        router.replace(`/thank-you?${new URLSearchParams({ txn: response.razorpay_payment_id, plan: planId })}`);
      }}
    />
  );
}
