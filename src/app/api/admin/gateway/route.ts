import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { GatewayError, notifySite } from '@/lib/gateway';
import { addSite, revealSecret, rotateSecret, setActive, setWebhook } from '@/lib/gateway-admin';
import { migrate } from '@/lib/migrate';

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  await migrate();
  try {
    switch (body.action) {
      case 'add':
        await addSite(body.name, body.domain, body.webhook);
        break;
      case 'webhook':
        await setWebhook(body.id, body.webhook);
        break;
      case 'active':
        await setActive(body.id, body.active);
        break;
      case 'secret':
        return NextResponse.json({ secret: await revealSecret(body.id) }, { headers: { 'Cache-Control': 'no-store' } });
      case 'rotate':
        return NextResponse.json({ secret: await rotateSecret(body.id) }, { headers: { 'Cache-Control': 'no-store' } });
      case 'resend':
        if (!(await notifySite(String(body.id)))) throw new GatewayError('Site ने webhook स्वीकार नहीं किया', 502);
        break;
      default:
        throw new GatewayError('Invalid action');
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof GatewayError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Gateway admin action failed', body.action, err);
    return NextResponse.json({ error: 'कुछ गड़बड़ हो गई' }, { status: 500 });
  }
}
