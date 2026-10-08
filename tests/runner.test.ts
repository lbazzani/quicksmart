// Il client del servizio claude-runner (src/lib/sofia/runner.ts), contro due
// finti runner locali: nessuna rete esterna, nessun token vero.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { _azzeraCache, runnerConfigurato, runnerPrompt } from '../src/lib/sofia/runner';

interface Finto {
  server: Server;
  url: string;
  health: { auth: { loggedIn: boolean }; running: number; rateLimit?: { status: string; resetsAt: number } };
  risposta: (body: Record<string, unknown>) => { status: number; json: Record<string, unknown>; ritardoMs?: number };
  ricevute: Record<string, unknown>[];
  chiuse: number;
}

async function finto(): Promise<Finto> {
  const f = {
    health: { auth: { loggedIn: true }, running: 0 },
    risposta: () => ({ status: 200, json: { ok: true, text: 'battuta di prova' } }),
    ricevute: [],
    chiuse: 0,
  } as unknown as Finto;
  f.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.authorization !== 'Bearer segreto') {
      res.writeHead(401).end();
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(f.health));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      f.ricevute.push(body);
      const r = f.risposta(body);
      const t = setTimeout(() => {
        res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.json));
      }, r.ritardoMs ?? 0);
      res.on('close', () => {
        if (!res.writableEnded) {
          f.chiuse++;
          clearTimeout(t);
        }
      });
    });
  });
  await new Promise<void>((ok) => f.server.listen(0, '127.0.0.1', ok));
  f.url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
  return f;
}

let a: Finto;
let b: Finto;

beforeAll(async () => {
  a = await finto();
  b = await finto();
});
afterAll(() => {
  a.server.close();
  b.server.close();
});
afterEach(() => {
  _azzeraCache();
  for (const f of [a, b]) {
    f.health = { auth: { loggedIn: true }, running: 0 };
    f.risposta = () => ({ status: 200, json: { ok: true, text: 'battuta di prova' } });
    f.ricevute = [];
    f.chiuse = 0;
  }
  delete process.env.SOFIA_MODEL;
});

function configura() {
  process.env.CLAUDE_RUNNER_URLS = `a=${a.url},b=${b.url}/`;
  process.env.CLAUDE_RUNNER_TOKEN = 'segreto';
}

describe('client claude-runner', () => {
  it('senza variabili resta spento: sofia.ts usa il CLI locale', () => {
    delete process.env.CLAUDE_RUNNER_URLS;
    delete process.env.CLAUDE_RUNNER_TOKEN;
    expect(runnerConfigurato()).toBe(false);
    process.env.CLAUDE_RUNNER_URLS = `a=${a.url}`;
    expect(runnerConfigurato()).toBe(false); // manca il token
  });

  it('manda prompt, modello, priorità e timeout all’istanza meno carica', async () => {
    configura();
    a.health.running = 2;
    const text = await runnerPrompt('ciao', { timeoutMs: 30_000, priority: 'batch' });
    expect(text).toBe('battuta di prova');
    expect(a.ricevute).toHaveLength(0);
    expect(b.ricevute).toEqual([{ prompt: 'ciao', model: 'sonnet', timeoutMs: 30_000, priority: 'batch' }]);
  });

  it('SOFIA_MODEL cambia il modello', async () => {
    configura();
    process.env.SOFIA_MODEL = 'haiku';
    await runnerPrompt('ciao', { timeoutMs: 30_000, priority: 'interactive' });
    expect([...a.ricevute, ...b.ricevute][0].model).toBe('haiku');
  });

  it('scarta le istanze senza login o in limite di utilizzo', async () => {
    configura();
    a.health = { auth: { loggedIn: false }, running: 0 };
    b.health = { auth: { loggedIn: true }, running: 0, rateLimit: { status: 'rejected', resetsAt: Date.now() + 3_600_000 } };
    await expect(runnerPrompt('ciao', { timeoutMs: 30_000, priority: 'interactive' })).rejects.toThrow(
      /nessuna istanza con il login attivo/
    );
  });

  it('su 503 passa all’istanza successiva', async () => {
    configura();
    b.health.running = 1; // a per prima
    a.risposta = () => ({ status: 503, json: { error: 'istanza occupata' } });
    expect(await runnerPrompt('ciao', { timeoutMs: 30_000, priority: 'interactive' })).toBe('battuta di prova');
    expect(a.ricevute).toHaveLength(1);
    expect(b.ricevute).toHaveLength(1);
  });

  it('se falliscono tutte, l’errore dice quale e perché', async () => {
    configura();
    a.risposta = () => ({ status: 502, json: { ok: false, error: 'uscita 1: boom' } });
    b.risposta = a.risposta;
    await expect(runnerPrompt('ciao', { timeoutMs: 30_000, priority: 'interactive' })).rejects.toThrow(
      /runner: [ab]: uscita 1: boom/
    );
  });

  it('l’interruzione chiude la richiesta: il runner ferma il CLI e libera il posto', async () => {
    configura();
    for (const f of [a, b]) f.risposta = () => ({ status: 200, json: { ok: true, text: 'tardi' }, ritardoMs: 5_000 });
    const ac = new AbortController();
    const p = runnerPrompt('ciao', { timeoutMs: 30_000, priority: 'interactive', signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toThrow(/interrotta/);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.chiuse + b.chiuse).toBe(1);
    // non ripiega sull'altra istanza: il podio ha già la precedenza
    expect(a.ricevute.length + b.ricevute.length).toBe(1);
  });
});
