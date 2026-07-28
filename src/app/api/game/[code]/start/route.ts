import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  let body: { playerId?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const res = await getEngine().start(code, body.playerId ?? '', body.token ?? '');
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 409 });
  return NextResponse.json({ ok: true });
}
