// Server-Sent Events: push dello snapshot a ogni cambio di versione.
import { NextRequest } from 'next/server';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const engine = getEngine();
  const room = engine.getRoom(code);
  if (!room) return new Response('not found', { status: 404 });
  const playerId = new URL(req.url).searchParams.get('playerId') ?? '';

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(engine.snapshot(room))}\n\n`));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`:hb\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        room.emitter.off('update', send);
        if (playerId) engine.connection(code, playerId, -1);
        try {
          controller.close();
        } catch {
          // già chiuso
        }
      };
      room.emitter.on('update', send);
      req.signal.addEventListener('abort', cleanup);
      send();
      if (playerId) engine.connection(code, playerId, 1);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
