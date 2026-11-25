'use client';

import RazorpayCheckout from './RazorpayCheckout';

export default function GatewayPanel({
  sessionId,
  amountPaise,
  customer,
  cancelUrl,
}: {
  sessionId: string;
  amountPaise: number;
  customer: { name: string | null; phone: string | null; email: string | null };
  cancelUrl: string;
}) {
  const api = `/api/gateway/pay/${sessionId}`;
  const leave = (data: { redirect?: string }) => {
    if (data.redirect) window.location.replace(data.redirect);
  };
  return (
    <RazorpayCheckout
      amountPaise={amountPaise}
      prefill={{ name: customer.name, contact: customer.phone, email: customer.email }}
      orderUrl={`${api}/order`}
      verifyUrl={`${api}/verify`}
      backHref={cancelUrl}
      helpText={`नमस्ते, मेरे भुगतान की पुष्टि नहीं हो पाई। ID: ${sessionId}`}
      onAlreadyPaid={leave}
      onPaid={(_response, _order, data) => leave(data)}
    />
  );
}
