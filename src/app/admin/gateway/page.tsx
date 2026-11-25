import type { Metadata } from 'next';
import AdminShell, { PageTitle, Pager, Panel, rupees, StatusBadge } from '@/components/admin/AdminShell';
import { AddSiteForm, ResendButton, SiteCard } from '@/components/admin/GatewaySites';
import { requireAdmin } from '@/lib/admin-auth';
import { PAGE_SIZE } from '@/lib/admin-data';
import { getGatewayPayments, getSites, type GatewayPaymentRow } from '@/lib/gateway-admin';
import { migrate } from '@/lib/migrate';

export const metadata: Metadata = { title: 'Admin — Gateway', robots: { index: false, follow: false } };

function Notice({ p }: { p: GatewayPaymentRow }) {
  if (p.status !== 'success') return <>—</>;
  if (p.notify_status === 'none') return <>Webhook नहीं है</>;
  if (p.notify_status === 'sent') return <>भेजा गया</>;
  return (
    <>
      <span className="block text-xs text-red-700">नहीं पहुंचा ({p.notify_attempts}){p.notify_error ? `: ${p.notify_error}` : ''}</span>
      <ResendButton sessionId={p.id} />
    </>
  );
}

export default async function AdminGateway({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  await requireAdmin();
  await migrate();
  const page = Math.max(1, Math.floor(Number((await searchParams).page)) || 1);
  const sites = await getSites();
  const { rows, total } = await getGatewayPayments(page);

  return (
    <AdminShell active="gateway">
      <PageTitle title="Gateway" sub="दूसरी websites के payments, इसी Razorpay account से" />
      <Panel title="नई site जोड़ें"><AddSiteForm /></Panel>

      <Panel title="Sites" className="mt-4">
        {sites.length ? (
          <ul className="divide-y divide-[var(--maroon)]/10">
            {sites.map(({ id, name, domain, webhook_url, active, sales, paise }) => (
              <SiteCard key={id} site={{ id, name, domain, webhook_url, active, sales, earned: rupees(paise) }} />
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-[var(--maroon)]/70">अभी कोई site नहीं जुड़ी है</p>
        )}
      </Panel>

      <Panel title={`Payments (${total})`} className="mt-4">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--maroon)]/15 text-xs text-[var(--maroon)]/70">
                  <th className="py-2 pr-3 font-semibold">तारीख</th><th className="pr-3 font-semibold">Site / Ref</th><th className="pr-3 font-semibold">ग्राहक</th>
                  <th className="pr-3 text-right font-semibold">राशि</th><th className="pr-3 font-semibold">स्थिति</th><th className="pr-3 font-semibold">Webhook</th><th className="font-semibold">Razorpay ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--maroon)]/8 align-top last:border-0">
                    <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">{p.at}</td>
                    <td className="py-2.5 pr-3"><span className="font-semibold">{p.site}</span><div className="font-mono text-[11px] text-[var(--maroon)]/70">{p.ref}</div></td>
                    <td className="py-2.5 pr-3">{p.customer ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{rupees(p.amount)}</td>
                    <td className="py-2.5 pr-3"><StatusBadge status={p.status} /></td>
                    <td className="py-2.5 pr-3 text-xs"><Notice p={p} /></td>
                    <td className="py-2.5 font-mono text-[11px] text-[var(--maroon)]/65">{p.razorpay_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-[var(--maroon)]/70">कोई payment नहीं मिला</p>
        )}
      </Panel>
      <Pager page={page} total={total} size={PAGE_SIZE} href={(p) => `/admin/gateway?page=${p}`} />
    </AdminShell>
  );
}
