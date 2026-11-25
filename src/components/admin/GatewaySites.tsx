'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

interface Site {
  id: string;
  name: string;
  domain: string;
  webhook_url: string | null;
  active: boolean;
  sales: number;
  earned: string;
}

const field = 'h-10 w-full rounded-lg border border-[var(--maroon)]/20 bg-white px-3 text-sm text-[var(--maroon)] outline-none focus:border-[var(--sindoor)]';
const small = 'min-h-10 rounded-lg border border-[var(--maroon)]/25 bg-white/70 px-3 text-sm font-semibold disabled:opacity-50';
const primary = 'h-10 rounded-lg bg-ember px-4 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-50';

async function call(body: Record<string, unknown>): Promise<{ error?: string; secret?: string }> {
  try {
    const res = await fetch('/api/admin/gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    return res.ok ? data : { error: data.error || 'कुछ गड़बड़ हो गई' };
  } catch {
    return { error: 'कुछ गड़बड़ हो गई' };
  }
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    const data = await call(body);
    setBusy(false);
    if (data.error) setError(data.error);
    else router.refresh();
    return data;
  }
  return { busy, error, run };
}

function ErrorLine({ text }: { text: string }) {
  return text ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{text}</p> : null;
}

export function AddSiteForm() {
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = await run({ action: 'add', ...Object.fromEntries(new FormData(form)) });
    if (!data.error) form.reset();
  }
  return (
    <form onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.5fr_auto]">
        <input name="name" required maxLength={100} placeholder="Site का नाम" aria-label="Site का नाम" className={field} />
        <input name="domain" required placeholder="example.com" aria-label="Domain" className={field} />
        <input name="webhook" type="url" placeholder="https://example.com/ba-webhook (optional)" aria-label="Webhook URL" className={field} />
        <button type="submit" disabled={busy} className={primary}>जोड़ें</button>
      </div>
      <ErrorLine text={error} />
      <p className="mt-2 text-xs text-[var(--maroon)]/70">सिर्फ वही site जोड़ें जो इस Razorpay account में approved है।</p>
    </form>
  );
}

export function SiteCard({ site }: { site: Site }) {
  const { busy, error, run } = useAction();
  const [secret, setSecret] = useState('');

  async function showSecret() {
    if (secret) return setSecret('');
    const data = await run({ action: 'secret', id: site.id });
    if (data.secret) setSecret(data.secret);
  }
  async function rotate() {
    if (!window.confirm(`${site.name} का पुराना secret तुरंत बंद हो जाएगा। नया बनाएं?`)) return;
    const data = await run({ action: 'rotate', id: site.id });
    if (data.secret) setSecret(data.secret);
  }
  function saveWebhook(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run({ action: 'webhook', id: site.id, webhook: new FormData(e.currentTarget).get('webhook') });
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {site.name} <span className="font-normal text-[var(--maroon)]/70">· {site.domain}</span>
            {!site.active && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">बंद</span>}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-[var(--maroon)]/75">Site ID: {site.id}</p>
          {secret && <p className="mt-1 break-all font-mono text-xs text-[var(--maroon)]">Secret: {secret}</p>}
        </div>
        <p className="shrink-0 text-right text-sm tabular-nums">
          <span className="font-display text-xl">{site.earned}</span>
          <br />
          {site.sales} payments
        </p>
      </div>
      <form onSubmit={saveWebhook} className="mt-3 flex gap-2">
        <input name="webhook" type="url" defaultValue={site.webhook_url ?? ''} placeholder="Webhook URL (optional)" aria-label={`${site.name} Webhook URL`} className={field} />
        <button type="submit" disabled={busy} className={small}>Save</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={showSecret} disabled={busy} className={small}>{secret ? 'Secret छिपाएं' : 'Secret दिखाएं'}</button>
        <button type="button" onClick={rotate} disabled={busy} className={small}>नया Secret</button>
        <button type="button" onClick={() => run({ action: 'active', id: site.id, active: !site.active })} disabled={busy} className={small}>
          {site.active ? 'Site बंद करें' : 'Site चालू करें'}
        </button>
      </div>
      <ErrorLine text={error} />
    </li>
  );
}

export function ResendButton({ sessionId }: { sessionId: string }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <button type="button" onClick={() => run({ action: 'resend', id: sessionId })} disabled={busy} className="text-xs font-semibold underline underline-offset-2 disabled:opacity-50">
        {busy ? 'भेज रहे हैं…' : 'दोबारा भेजें'}
      </button>
      {error && <span className="block text-xs text-red-700">{error}</span>}
    </>
  );
}
