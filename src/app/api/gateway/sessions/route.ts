import { after, NextRequest, NextResponse } from 'next/server';
import { authenticateSite, createSession, GatewayError, retryUnsentNotices, sessionView } from '@/lib/gateway';
import { migrate } from '@/lib/migrate';

function baseUrl(req: NextRequest): string {
  if (process.env.GATEWAY_BASE_URL) return process.env.GATEWAY_BASE_URL.replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0] ?? req.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

// Called by a site's server, never by a browser.
export async function POST(req: NextRequest) {
  await migrate();
  const site = await authenticateSite(req.headers.get('authorization'));
  if (!site) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  try {
    const session = await createSession(site, body as Record<string, unknown>);
    after(() => retryUnsentNotices());
    return NextResponse.json({ ...sessionView(session), url: `${baseUrl(req)}/pay/${session.id}` });
  } catch (err) {
    if (err instanceof GatewayError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Gateway session failed', site.id, err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
