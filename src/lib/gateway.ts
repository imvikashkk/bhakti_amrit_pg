import crypto from 'crypto';
import { query } from './db';

// Payment gateway for our other websites. A site's server opens a session (its own order number and
// the amount), sends the buyer to /pay/<session>, and gets them back on return_url with a signed
// result. A signed webhook tells its server too, in case the buyer never makes it back.
// Guide for the sites: docs/payment-gateway.md

export interface GatewaySite {
  id: string;
  name: string;
  domain: string;
  webhook_url: string | null;
  active: boolean;
  secret_version: number;
}

export interface GatewaySession {
  id: string;
  site_id: string;
  ref: string;
  amount: number;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  return_url: string;
  cancel_url: string;
  metadata: Record<string, unknown> | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  status: 'pending' | 'success';
  expired: boolean;
  paid_at_iso: string | null;
}

export class GatewayError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const MIN_PAISE = 100;
const MAX_PAISE = 50_000_00;
const SESSION_COLUMNS = `id, site_id, ref, amount, customer_name, customer_phone, customer_email, return_url, cancel_url,
  metadata, razorpay_order_id, razorpay_payment_id, status, expires_at < NOW() AS expired,
  to_char(paid_at AT TIME ZONE current_setting('TimeZone') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS paid_at_iso`;
const SITE_COLUMNS = 'id, name, domain, webhook_url, active, secret_version';

/* ───────────── secrets and signatures ───────────── */

// Worked out from JWT_SECRET instead of being stored, so a copy of the database gives nobody a
// secret. Changing JWT_SECRET changes every site's secret.
export function siteSecret(site: Pick<GatewaySite, 'id' | 'secret_version'>): string {
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error('JWT_SECRET is not set');
  return 'sk_' + crypto.createHmac('sha256', key).update(`gateway:${site.id}:${site.secret_version}`).digest('hex');
}

export function hmacHex(secret: string, text: string): string {
  return crypto.createHmac('sha256', secret).update(text).digest('hex');
}

export function sameText(a: string, b: string): boolean {
  const hash = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

/* ───────────── sites ───────────── */

// "https://www.Example.com/shop" → "www.example.com"
export function cleanDomain(input: string): string {
  const text = input.trim().toLowerCase();
  let host = '';
  try {
    host = new URL(text.includes('://') ? text : `https://${text}`).hostname;
  } catch {}
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) throw new GatewayError('Domain सही नहीं है');
  return host;
}

// Buyers and webhooks only ever go to the site's own registered domain, or a subdomain of it.
export function siteUrl(value: unknown, domain: string, field: string): string {
  let url: URL | null = null;
  if (typeof value === 'string' && value.length <= 1000) {
    try {
      url = new URL(value);
    } catch {}
  }
  const ok =
    url &&
    url.protocol === 'https:' &&
    !url.port &&
    !url.username &&
    !url.password &&
    (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (!url || !ok) throw new GatewayError(`${field} must be an https URL on ${domain}`);
  return url.href;
}

export async function getSite(id: string): Promise<GatewaySite | null> {
  const rows = await query<GatewaySite>(`SELECT ${SITE_COLUMNS} FROM gateway_sites WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

// Basic auth: the site id and its secret.
export async function authenticateSite(header: string | null): Promise<GatewaySite | null> {
  const encoded = header?.match(/^Basic\s+(\S+)$/i)?.[1];
  if (!encoded) return null;
  const text = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = text.indexOf(':');
  if (colon < 1) return null;
  const site = await getSite(text.slice(0, colon));
  if (!site?.active || !sameText(text.slice(colon + 1), siteSecret(site))) return null;
  return site;
}

/* ───────────── sessions ───────────── */

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new GatewayError(`${field} must be text of at most ${max} characters`);
  return value.trim() || null;
}

export async function createSession(site: GatewaySite, body: Record<string, unknown>): Promise<GatewaySession> {
  const { ref, amount, metadata } = body;
  if (typeof ref !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(ref)) {
    throw new GatewayError('ref must be 1-64 characters: letters, digits, dot, dash, underscore');
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < MIN_PAISE || amount > MAX_PAISE) {
    throw new GatewayError(`amount must be a whole number of paise from ${MIN_PAISE} to ${MAX_PAISE}`);
  }
  const returnUrl = siteUrl(body.return_url, site.domain, 'return_url');
  const cancelUrl = body.cancel_url ? siteUrl(body.cancel_url, site.domain, 'cancel_url') : returnUrl;
  if (metadata !== undefined && metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
    throw new GatewayError('metadata must be an object');
  }
  const meta = metadata ? JSON.stringify(metadata) : null;
  if (meta && meta.length > 2000) throw new GatewayError('metadata is too large (2000 characters)');
  const customer = (body.customer && typeof body.customer === 'object' ? body.customer : {}) as Record<string, unknown>;

  // A site may ask again for the same ref (a retry, a second click): it is the same payment, so it
  // gets the same session, and the buyer can never be charged twice for it.
  const rows = await query<GatewaySession>(
    `INSERT INTO gateway_sessions (id, site_id, ref, amount, customer_name, customer_phone, customer_email, return_url, cancel_url, metadata, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() + interval '24 hours')
     ON CONFLICT (site_id, ref) DO UPDATE
       SET customer_name=EXCLUDED.customer_name, customer_phone=EXCLUDED.customer_phone, customer_email=EXCLUDED.customer_email,
           return_url=EXCLUDED.return_url, cancel_url=EXCLUDED.cancel_url, metadata=EXCLUDED.metadata, expires_at=EXCLUDED.expires_at
     WHERE gateway_sessions.status='pending' AND gateway_sessions.amount=EXCLUDED.amount
     RETURNING ${SESSION_COLUMNS}`,
    [
      `gs_${crypto.randomBytes(16).toString('hex')}`,
      site.id,
      ref,
      amount,
      optionalText(customer.name, 'customer.name', 100),
      optionalText(customer.phone, 'customer.phone', 15),
      optionalText(customer.email, 'customer.email', 150),
      returnUrl,
      cancelUrl,
      meta,
    ]
  );
  if (rows[0]) return rows[0];

  const [existing] = await query<GatewaySession>(`SELECT ${SESSION_COLUMNS} FROM gateway_sessions WHERE site_id=$1 AND ref=$2`, [site.id, ref]);
  if (!existing || existing.amount !== amount) throw new GatewayError('this ref was already used with a different amount', 409);
  return existing;
}

export async function getGatewaySession(id: string): Promise<GatewaySession | null> {
  const rows = await query<GatewaySession>(`SELECT ${SESSION_COLUMNS} FROM gateway_sessions WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

// What a site's server is told about a session.
export function sessionView(s: GatewaySession) {
  return {
    session: s.id,
    ref: s.ref,
    status: s.status,
    amount: s.amount,
    currency: 'INR',
    payment_id: s.razorpay_payment_id,
    paid_at: s.paid_at_iso,
    metadata: s.metadata,
  };
}

// The site's URL with the signed result on it.
export function resultUrl(site: GatewaySite, s: GatewaySession, status: 'success' | 'cancelled'): string {
  const url = new URL(status === 'success' ? s.return_url : s.cancel_url);
  const ts = String(Math.floor(Date.now() / 1000));
  const paymentId = status === 'success' ? (s.razorpay_payment_id ?? '') : '';
  const signature = hmacHex(siteSecret(site), [s.id, s.ref, status, s.amount, paymentId, ts].join('|'));
  const params = { ba_session: s.id, ba_ref: s.ref, ba_status: status, ba_amount: String(s.amount), ba_payment_id: paymentId, ba_ts: ts, ba_signature: signature };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

// Returns the session only to the one call that really changes it, which is the one that then tells
// the site: the buyer's browser and Razorpay's webhook both report the same payment.
export async function markSessionPaid(orderId: string, paymentId: string): Promise<GatewaySession | null> {
  const rows = await query<GatewaySession>(
    `UPDATE gateway_sessions SET status='success', razorpay_payment_id=$2, paid_at=NOW(), notify_status='pending'
     WHERE razorpay_order_id=$1 AND status<>'success' RETURNING ${SESSION_COLUMNS}`,
    [orderId, paymentId]
  );
  return rows[0] ?? null;
}

/* ───────────── telling the site ───────────── */

const RETRY_DELAYS_MS = [0, 5_000, 30_000, 120_000];
const MAX_ATTEMPTS = 12;

// One attempt. A site may hear about the same payment more than once.
export async function notifySite(sessionId: string): Promise<boolean> {
  const session = await getGatewaySession(sessionId);
  const site = session && (await getSite(session.site_id));
  if (!session || !site || session.status !== 'success') return false;
  if (!site.webhook_url) {
    await query(`UPDATE gateway_sessions SET notify_status='none' WHERE id=$1`, [sessionId]);
    return true;
  }

  let error: string | null = null;
  try {
    const body = JSON.stringify({ event: 'payment.success', ...sessionView(session) });
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await fetch(site.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BA-Timestamp': ts, 'X-BA-Signature': hmacHex(siteSecret(site), `${ts}.${body}`) },
      body,
      redirect: 'manual', // a redirect could lead off the registered domain
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : 'failed';
  }
  await query(
    `UPDATE gateway_sessions SET notify_attempts=notify_attempts+1, notified_at=NOW(), notify_error=$2, notify_status=$3 WHERE id=$1`,
    [sessionId, error?.slice(0, 200) ?? null, error ? 'pending' : 'sent']
  );
  return !error;
}

// Runs after the response (see `after` in the routes), so the buyer never waits for it.
export async function notifySiteWithRetries(sessionId: string) {
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      if (await notifySite(sessionId)) return;
    } catch (err) {
      console.error('Gateway notify failed', sessionId, err);
    }
  }
}

// Picks up what a restart or a longer outage left unsent. Called as new sessions come in.
export async function retryUnsentNotices() {
  const rows = await query<{ id: string }>(
    `SELECT id FROM gateway_sessions
     WHERE status='success' AND notify_status='pending' AND notify_attempts < ${MAX_ATTEMPTS}
       AND COALESCE(notified_at, paid_at) < NOW() - interval '5 minutes'
     ORDER BY paid_at LIMIT 5`
  );
  for (const { id } of rows) await notifySite(id).catch((err) => console.error('Gateway notify failed', id, err));
}
