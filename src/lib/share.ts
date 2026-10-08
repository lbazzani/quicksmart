// Condividere QuickSmart: inviti, risultati, sfida del giorno.
//
// Il gioco cresce solo per passaparola: non c'è un negozio di app, non c'è
// pubblicità. Ogni partita che finisce deve poter diventare un messaggio in
// una chat, con un link che porta dritto a giocare. I testi sono costruiti da
// funzioni pure (testate in tests/share.test.ts); il resto è browser.
//
// Niente dati personali nei link: il ?ref= dice solo DA QUALE TIPO di link si
// arriva (sfida, invito, podio), non chi l'ha mandato.

/** esito di un round per chi gioca da solo: giusta, sbagliata, tempo scaduto */
export type Esito = 'g' | 's' | 't';

const EMOJI: Record<Esito, string> = { g: '🟩', s: '🟥', t: '⬜' };

export function striscia(esiti: Esito[]): string {
  return esiti.map((e) => EMOJI[e]).join('');
}

export interface ParoleCondivisione {
  dailyLabel: string;
  training: string;
  points: string;
  challenge: string;
  teamChallenge: string;
}

/** «QuickSmart ⚡ Sfida #12 · 🟩🟩🟥… · 8/10 · 1840 punti · Mi batti?» */
export function testoRisultato(
  p: ParoleCondivisione,
  r: { numero?: number; esiti: Esito[]; giuste: number; totale: number; punti: number }
): string {
  const titolo = r.numero ? `QuickSmart ⚡ ${p.dailyLabel} #${r.numero}` : `QuickSmart ⚡ ${p.training}`;
  return [titolo, striscia(r.esiti), `${r.giuste}/${r.totale} · ${r.punti} ${p.points}`, p.challenge]
    .filter(Boolean)
    .join('\n');
}

/** il podio di squadra: i primi tre, con le medaglie */
export function testoPodio(p: ParoleCondivisione, nome: string, classifica: { nickname: string; score: number }[]): string {
  const medaglie = ['🥇', '🥈', '🥉'];
  const righe = classifica.slice(0, 3).map((g, i) => `${medaglie[i]} ${g.nickname} ${g.score}`);
  return [`🏆 QuickSmart · ${nome}`, ...righe, p.teamChallenge].join('\n');
}

/** aggiunge ?ref= a un indirizzo, senza perdere i parametri che ha già */
export function conRef(url: string, ref: string): string {
  const u = new URL(url);
  u.searchParams.set('ref', ref);
  return u.toString();
}

export type EsitoCondivisione = 'condiviso' | 'copiato' | 'annullato' | 'errore';

/**
 * Il foglio di condivisione del telefono (WhatsApp, Telegram, Messaggi…) se
 * c'è; altrimenti testo e link negli appunti, da incollare dove si vuole.
 */
export async function condividi(d: { title: string; text: string; url: string }): Promise<EsitoCondivisione> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(d);
      return 'condiviso';
    } catch (e) {
      // chiuso dalla persona: non è un errore, e non si copia di nascosto
      if (e instanceof Error && e.name === 'AbortError') return 'annullato';
    }
  }
  try {
    await navigator.clipboard.writeText(`${d.text}\n${d.url}`);
    return 'copiato';
  } catch {
    return 'errore';
  }
}

// ── memoria del browser ──────────────────────────────────────────────────────
// Tutto in try/catch: navigazione privata e blocchi dei cookie fanno lanciare
// localStorage, e una condivisione non vale una pagina rotta.

function leggi<T>(store: 'local' | 'session', key: string): T | null {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function scrivi(store: 'local' | 'session', key: string, v: unknown): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(v));
  } catch {
    // pazienza: si perde solo una comodità
  }
}

/** Esito del round di chi gioca, registrato al reveal (solo in solitaria). */
export function registraEsito(code: string, roundIndex: number, esito: Esito): void {
  const key = `qs:esiti:${code.toUpperCase()}`;
  const esiti = leggi<(Esito | null)[]>('session', key) ?? [];
  esiti[roundIndex] = esito;
  scrivi('session', key, esiti);
}

/** Gli esiti della partita, in ordine; i round persi di vista (ricarica) non ci sono. */
export function leggiEsiti(code: string): Esito[] {
  return (leggi<(Esito | null)[]>('session', `qs:esiti:${code.toUpperCase()}`) ?? []).filter(
    (e): e is Esito => e === 'g' || e === 's' || e === 't'
  );
}

export interface RisultatoSfida {
  numero: number;
  punti: number;
  giuste: number;
  totale: number;
  esiti: Esito[];
}

/** Conta il PRIMO risultato del giorno: rigiocare a domande note non vale. */
export function salvaRisultatoSfida(r: RisultatoSfida): RisultatoSfida {
  const gia = leggiRisultatoSfida(r.numero);
  if (gia) return gia;
  scrivi('local', `qs:sfida:${r.numero}`, r);
  return r;
}

export function leggiRisultatoSfida(numero: number): RisultatoSfida | null {
  return leggi<RisultatoSfida>('local', `qs:sfida:${numero}`);
}

/** nome e avatar dell'ultima partita: la sfida del giorno torna ogni giorno */
export function salvaUltimoGiocatore(nickname: string, avatar: string): void {
  scrivi('local', 'qs:io', { nickname, avatar });
}

export function leggiUltimoGiocatore(): { nickname: string; avatar: string } | null {
  return leggi<{ nickname: string; avatar: string }>('local', 'qs:io');
}

/**
 * Ricorda da quale link si è arrivati (?ref=, o utm_source delle campagne) per
 * la durata della visita: chi arriva da un invito e poi crea una partita sua
 * è proprio il passaparola che si vuole contare. Vince il primo.
 */
export function catturaRef(search: string): void {
  const q = new URLSearchParams(search);
  const ref = q.get('ref') ?? q.get('utm_source');
  if (!ref || !/^[a-z0-9_-]{1,24}$/i.test(ref)) return;
  if (leggi<string>('session', 'qs:ref')) return;
  scrivi('session', 'qs:ref', ref.toLowerCase());
}

export function refCorrente(): string | undefined {
  return leggi<string>('session', 'qs:ref') ?? undefined;
}
