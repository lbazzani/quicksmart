// Client del servizio claude-runner della piattaforma SparkTech.
//
// Nel cluster il container di QuickSmart non ha il CLI di Claude né un login:
// le battute di SofAI passano da `POST /prompt` del servizio claude-runner
// (repository server-sparktech, docs/piattaforma/claude-runner.md), che lancia
// il CLI su un nodo con l'account dedicato. Senza CLAUDE_RUNNER_URLS si torna
// al CLI locale (sofia.ts), com'era su sparktech2 e com'è sul Mac in sviluppo.
//
// Dall'8/9 al 9/10/2026 questo file non c'era: SOFIA_AI=1 nel manifest, ma
// nell'immagine nessun CLI. Ogni lotto falliva con «claude CLI non trovato» e
// la mascotte ha usato solo le battute pre-scritte, senza che nulla a schermo
// lo facesse notare.
//
// Cosa arriva al runner: SOLO il prompt costruito in sofia.ts, in cui i
// nickname sono già diventati «Giocatore1». /prompt gira senza strumenti
// (`--tools ''`), senza MCP e senza il prompt di sistema di Claude Code: la
// stessa dieta che lo spawn locale otteneva con i suoi flag.

/** istanze come per sparktech-web e xpnews: `nome=http://host:porta,…` */
interface Istanza {
  name: string;
  url: string;
  running: number;
}

function istanzeConfigurate(): { name: string; url: string }[] {
  return (process.env.CLAUDE_RUNNER_URLS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf('=');
      const url = (i > 0 ? x.slice(i + 1) : x).replace(/\/$/, '');
      return { name: i > 0 ? x.slice(0, i) : url, url };
    });
}

export function runnerConfigurato(): boolean {
  return istanzeConfigurate().length > 0 && !!process.env.CLAUDE_RUNNER_TOKEN;
}

/**
 * Modello per le battute: `sonnet` (il runner lo traduce in Sonnet 5.5).
 * Provati il 9/10/2026 con i prompt veri (tools/sofai-runner.ts): Haiku
 * risponde in 2-5 s ma scrive battute piatte e sbaglia la persona («da adesso
 * tifi per…»); Sonnet in 3-7 s, ed è un'altra mascotte. Il volume è minimo
 * (al massimo MAX_LOTTI lotti e un podio a partita), la differenza si vede.
 * SOFIA_MODEL lo cambia senza ricostruire.
 */
export function modelloSofia(): string {
  return process.env.SOFIA_MODEL || 'sonnet';
}

// /health costa una richiesta per istanza: si ricontrolla al massimo ogni
// minuto, o subito dopo un 503 (istanza in limite o senza login).
let cache: { at: number; list: Istanza[] } = { at: 0, list: [] };
const CACHE_MS = 60_000;

async function getJson(url: string, init: RequestInit, ms: number, signal?: AbortSignal) {
  const segnali = [AbortSignal.timeout(ms), ...(signal ? [signal] : [])];
  const res = await fetch(url, { ...init, signal: AbortSignal.any(segnali) });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Istanze con il login attivo e non in limite, la meno carica per prima. */
async function istanzePronte(): Promise<Istanza[]> {
  if (Date.now() - cache.at < CACHE_MS && cache.list.length) return cache.list;
  const token = process.env.CLAUDE_RUNNER_TOKEN ?? '';
  const list: Istanza[] = [];
  await Promise.all(
    istanzeConfigurate().map(async (r) => {
      try {
        const { status, body } = await getJson(`${r.url}/health`, { headers: { authorization: `Bearer ${token}` } }, 5_000);
        const auth = body?.auth as { loggedIn?: boolean } | undefined;
        if (status !== 200 || !auth?.loggedIn) return;
        const limite = body?.rateLimit as { status?: string; resetsAt?: number } | undefined;
        if (limite?.status === 'rejected' && (limite.resetsAt ?? 0) > Date.now()) return;
        list.push({ ...r, running: Number(body?.running) || 0 });
      } catch {
        // istanza non raggiungibile: si prova con le altre
      }
    })
  );
  list.sort((a, b) => a.running - b.running);
  cache = { at: Date.now(), list };
  return list;
}

export interface RunnerOpts {
  timeoutMs: number;
  /**
   * `interactive`: una persona sta aspettando (il podio). `batch`: le battute
   * preparate in anticipo, che nessuno aspetta: in coda passano dopo, e non
   * prendono mai l'ultimo posto libero del runner (BATCH_RESERVE).
   */
  priority: 'interactive' | 'batch';
  /** interrompe la richiesta: il runner se ne accorge e ferma il CLI */
  signal?: AbortSignal;
}

/** Un turno secco: restituisce il testo, o lancia un errore leggibile nei log. */
export async function runnerPrompt(prompt: string, opts: RunnerOpts): Promise<string> {
  const list = await istanzePronte();
  if (!list.length) throw new Error('runner: nessuna istanza con il login attivo');
  const token = process.env.CLAUDE_RUNNER_TOKEN ?? '';
  let ultimo = '';
  for (const r of list) {
    if (opts.signal?.aborted) break;
    try {
      // il runner risponde entro timeoutMs (coda compresa); +15 s di margine
      // come gli altri client, così l'errore che si legge è il suo e non il nostro
      const { status, body } = await getJson(
        `${r.url}/prompt`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ prompt, model: modelloSofia(), timeoutMs: opts.timeoutMs, priority: opts.priority }),
        },
        opts.timeoutMs + 15_000,
        opts.signal
      );
      if (status === 429 || status === 503) {
        cache.at = 0;
        ultimo = `${r.name}: ${status} ${String(body?.error ?? '')}`.trim();
        continue;
      }
      if (status !== 200 || !body?.ok) {
        ultimo = `${r.name}: ${String(body?.error ?? `http ${status}`)}`;
        continue;
      }
      return String(body.text ?? '').trim();
    } catch (e) {
      if (opts.signal?.aborted) break;
      ultimo = `${r.name}: ${e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : e instanceof Error ? e.message : e}`;
    }
  }
  if (opts.signal?.aborted) throw new Error('interrotta: ha la precedenza il podio');
  throw new Error(`runner: ${ultimo}`);
}

/** solo per i test: dimentica le istanze già controllate */
export function _azzeraCache(): void {
  cache = { at: 0, list: [] };
}
