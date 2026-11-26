'use client';

import HostedCheckout from './HostedCheckout';
import RazorpayCheckout from './RazorpayCheckout';

export default function GatewayPanel({
  sessionId,
  amountPaise,
  customer,
  cancelUrl,
  hosted = false,
  failed = false,
}: {
  sessionId: string;
  amountPaise: number;
  customer: { name: string | null; phone: string | null; email: string | null };
  cancelUrl: string;
  // RAZORPAY_HOSTED_CHECKOUT=1: Razorpay's own payment page instead of the popup
  hosted?: boolean;
  // Back from a failed hosted payment
  failed?: boolean;
}) {
  const api = `/api/gateway/pay/${sessionId}`;
  const leave = (data: { redirect?: string }) => {
    if (data.redirect) window.location.replace(data.redirect);
  };
  const prefill = { name: customer.name, contact: customer.phone, email: customer.email };

  if (hosted) {
    return (
      <HostedCheckout
        amountPaise={amountPaise}
        prefill={prefill}
        orderUrl={`${api}/order`}
        returnPath={`${api}/return`}
        backHref={cancelUrl}
        notice={failed ? 'Payment नहीं हो पाया, कृपया फिर कोशिश करें' : undefined}
        onAlreadyPaid={leave}
      />
    );
  }

  return (
    <RazorpayCheckout
      amountPaise={amountPaise}
      prefill={prefill}
      orderUrl={`${api}/order`}
      verifyUrl={`${api}/verify`}
      backHref={cancelUrl}
      helpText={`नमस्ते, मेरे भुगतान की पुष्टि नहीं हो पाई। ID: ${sessionId}`}
      onAlreadyPaid={leave}
      onPaid={(_response, _order, data) => leave(data)}
    />
  );
}
