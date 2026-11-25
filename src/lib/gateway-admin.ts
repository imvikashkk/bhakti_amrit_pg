import crypto from 'crypto';
import { PAGE_SIZE, shown } from './admin-data';
import { query } from './db';
import { cleanDomain, GatewayError, getSite, siteSecret, siteUrl, type GatewaySite } from './gateway';

export interface SiteRow extends GatewaySite {
  sales: number;
  paise: string;
}

export interface GatewayPaymentRow {
  id: string;
  site: string;
  ref: string;
  amount: number;
  customer: string | null;
  status: string;
  razorpay_id: string | null;
  at: string;
  notify_status: string;
  notify_attempts: number;
  notify_error: string | null;
}

export function getSites() {
  return query<SiteRow>(
    `SELECT s.id, s.name, s.domain, s.webhook_url, s.active, s.secret_version,
            COUNT(g.id)::int AS sales, COALESCE(SUM(g.amount), 0)::text AS paise
     FROM gateway_sites s LEFT JOIN gateway_sessions g ON g.site_id = s.id AND g.status = 'success'
     GROUP BY s.id ORDER BY s.created_at`
  );
}

export async function getGatewayPayments(page: number) {
  const rows = await query<GatewayPaymentRow>(
    `SELECT g.id, s.name AS site, g.ref, g.amount, NULLIF(CONCAT_WS(' · ', g.customer_name, g.customer_phone), '') AS customer, g.status,
            COALESCE(g.razorpay_payment_id, g.razorpay_order_id) AS razorpay_id, ${shown('g.created_at')} AS at,
            g.notify_status, g.notify_attempts, g.notify_error
     FROM gateway_sessions g JOIN gateway_sites s ON s.id = g.site_id
     ORDER BY g.created_at DESC LIMIT ${PAGE_SIZE} OFFSET $1`,
    [(page - 1) * PAGE_SIZE]
  );
  const [{ total }] = await query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM gateway_sessions`);
  return { rows, total };
}

export async function addSite(nameInput: unknown, domainInput: unknown, webhookInput: unknown) {
  const name = typeof nameInput === 'string' ? nameInput.trim() : '';
  if (!name || name.length > 100) throw new GatewayError('नाम भरें (100 अक्षर तक)');
  const domain = cleanDomain(typeof domainInput === 'string' ? domainInput : '');
  const webhook = webhookInput ? siteUrl(webhookInput, domain, 'Webhook URL') : null;
  const rows = await query<{ id: string }>(
    `INSERT INTO gateway_sites (id, name, domain, webhook_url) VALUES ($1, $2, $3, $4) ON CONFLICT (domain) DO NOTHING RETURNING id`,
    [`site_${crypto.randomBytes(8).toString('hex')}`, name, domain, webhook]
  );
  if (!rows.length) throw new GatewayError('यह domain पहले से जुड़ा है', 409);
}

async function mustGetSite(id: unknown) {
  const site = typeof id === 'string' ? await getSite(id) : null;
  if (!site) throw new GatewayError('Site नहीं मिली', 404);
  return site;
}

export async function setWebhook(id: unknown, webhookInput: unknown) {
  const site = await mustGetSite(id);
  const webhook = webhookInput ? siteUrl(webhookInput, site.domain, 'Webhook URL') : null;
  await query(`UPDATE gateway_sites SET webhook_url=$1 WHERE id=$2`, [webhook, site.id]);
}

export async function setActive(id: unknown, active: unknown) {
  const site = await mustGetSite(id);
  await query(`UPDATE gateway_sites SET active=$1 WHERE id=$2`, [active === true, site.id]);
}

export async function rotateSecret(id: unknown) {
  const site = await mustGetSite(id);
  await query(`UPDATE gateway_sites SET secret_version=secret_version+1 WHERE id=$1`, [site.id]);
  return revealSecret(site.id);
}

export async function revealSecret(id: unknown) {
  return siteSecret(await mustGetSite(id));
}
