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
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        room.emitter.off('update', send);
        room.emitter.off('closed', close);
        req.signal.removeEventListener('abort', close);
        if (playerId) engine.connection(code, playerId, -1);
        try {
          controller.close();
        } catch {
          // già chiuso dal client
        }
      };
      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(engine.snapshot(room))}\n\n`));
        } catch {
          close();
        }
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`:hb\n\n`));
        } catch {
          close();
        }
      }, 15_000);

      cleanup = close;
      room.emitter.on('update', send);
      room.emitter.on('closed', close);
      req.signal.addEventListener('abort', close);
      send();
      if (playerId) engine.connection(code, playerId, 1);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
