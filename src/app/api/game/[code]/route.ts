// Snapshot puntuale (usato da test e da client senza SSE).
import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const engine = getEngine();
  const room = engine.getRoom(code);
  if (!room) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(engine.snapshot(room));
}
