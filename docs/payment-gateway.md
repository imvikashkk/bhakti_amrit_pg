# BA payment gateway: integration guide

Your server opens a payment session, you send the buyer to the returned link, and the buyer comes back to your site with a signed result.

```
your server ── POST /api/gateway/sessions ──▶ gateway      (amount is fixed here)
buyer       ── redirect to url ──▶ /pay/gs_… ── pays ──▶ return_url?ba_status=success&…
gateway     ── signed webhook ──▶ your server              (even if the buyer closes the tab)
```

You need three things from the gateway admin:

- **Base URL**: the gateway's address, written `https://GATEWAY` below
- **Site ID** (`site_…`) and **Secret** (`sk_…`)
- Your **domain** registered, plus a webhook URL if you want webhooks

Keep the secret on your server. Never put it in browser code, an app or a public repository.

## 1. Open a session

`POST /api/gateway/sessions`, with HTTP Basic auth (Site ID as user, Secret as password).

```bash
curl -u "site_xxx:sk_xxx" https://GATEWAY/api/gateway/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "ref": "ORDER-1001",
    "amount": 49900,
    "return_url": "https://example.com/payment/done",
    "cancel_url": "https://example.com/cart",
    "customer": { "name": "Asha", "phone": "9876543210", "email": "asha@example.com" },
    "metadata": { "plan": "yearly" }
  }'
```

| Field | Required | Notes |
| --- | --- | --- |
| `ref` | yes | Your order number, unique per payment. 1-64 letters, digits, `.`, `-`, `_` |
| `amount` | yes | **Paise**, whole number: ₹499 is `49900`. From 100 to 5000000 |
| `return_url` | yes | `https`, on your registered domain or a subdomain |
| `cancel_url` | no | Same rule. Defaults to `return_url` |
| `customer` | no | `name`, `phone`, `email`: fills in the payment form |
| `metadata` | no | Object, up to 2000 characters. Sent back to you in the webhook |

Response:

```json
{ "session": "gs_…", "ref": "ORDER-1001", "status": "pending", "amount": 49900, "currency": "INR",
  "payment_id": null, "paid_at": null, "metadata": { "plan": "yearly" }, "url": "https://GATEWAY/pay/gs_…" }
```

Redirect the buyer to `url`. A link works for 24 hours.

Sending the same `ref` and `amount` again returns the same session, so a retry never charges twice. If it is already paid, `status` is `success`. The same `ref` with a different amount returns `409`.

## 2. When the buyer comes back

These are added to `return_url` (paid) or `cancel_url` (cancelled):

`ba_session`, `ba_ref`, `ba_status` (`success` or `cancelled`), `ba_amount`, `ba_payment_id`, `ba_ts`, `ba_signature`

**Always check the signature before giving anything to the buyer**, and check that the amount and ref are the ones in your own order:

```
ba_signature = hex HMAC-SHA256(secret, "ba_session|ba_ref|ba_status|ba_amount|ba_payment_id|ba_ts")
```

Node.js:

```js
import crypto from 'node:crypto';

export function verifyReturn(q, secret) {
  const text = [q.ba_session, q.ba_ref, q.ba_status, q.ba_amount, q.ba_payment_id, q.ba_ts].join('|');
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(text).digest('hex'));
  const given = Buffer.from(String(q.ba_signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
```

PHP:

```php
function verify_return(array $q, string $secret): bool {
    $text = implode('|', [$q['ba_session'], $q['ba_ref'], $q['ba_status'], $q['ba_amount'], $q['ba_payment_id'], $q['ba_ts']]);
    return hash_equals(hash_hmac('sha256', $text, $secret), $q['ba_signature']);
}
```

`cancelled` means the buyer went back without paying. The same link can still be paid until it expires, so a later `success` for that ref is valid.

## 3. Webhook

On payment the gateway sends a `POST` to your webhook URL:

```json
{ "event": "payment.success", "session": "gs_…", "ref": "ORDER-1001", "status": "success", "amount": 49900,
  "currency": "INR", "payment_id": "pay_…", "paid_at": "2026-11-25T06:30:00Z", "metadata": { "plan": "yearly" } }
```

Headers: `X-BA-Timestamp` and `X-BA-Signature`, where

```
X-BA-Signature = hex HMAC-SHA256(secret, X-BA-Timestamp + "." + raw body)
```

Check it against the **raw** body, before parsing the JSON. Reject timestamps more than 5 minutes off. In Express:

```js
app.post('/ba-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-BA-Timestamp') ?? '';
  const expected = Buffer.from(crypto.createHmac('sha256', SECRET).update(`${ts}.${req.body}`).digest('hex'));
  const given = Buffer.from(req.get('X-BA-Signature') ?? '');
  const ok = expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!ok || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.sendStatus(400);

  const event = JSON.parse(req.body);
  // Find your order by event.ref, compare event.amount, and mark it paid only if it isn't already.
  res.sendStatus(200);
});
```

- Answer with any `2xx` within 10 seconds. Redirects count as failures.
- Anything else is retried, several times over the first minutes and again later as new payments come in.
- The same payment may arrive more than once, and the buyer may return before or after it. Handle an order only once.

## 4. Ask for the status

```bash
curl -u "site_xxx:sk_xxx" https://GATEWAY/api/gateway/sessions/gs_xxx
```

Same fields as the webhook. Use it when a buyer says they paid and you have heard nothing.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | A field is wrong; `error` says which |
| 401 | Wrong Site ID or Secret, or the site is turned off |
| 404 | No such session for your site |
| 409 | This `ref` was used with a different amount |

Refunds are made from the Razorpay dashboard, where each order's notes carry your domain and `ref`.
