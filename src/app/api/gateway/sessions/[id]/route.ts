import { NextRequest, NextResponse } from 'next/server';
import { authenticateSite, getGatewaySession, sessionView } from '@/lib/gateway';
import { migrate } from '@/lib/migrate';

// A site's server asking what became of one of its sessions.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await migrate();
  const site = await authenticateSite(req.headers.get('authorization'));
  if (!site) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await getGatewaySession((await params).id);
  if (!session || session.site_id !== site.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(sessionView(session));
}
