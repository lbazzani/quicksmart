'use client';
// Lato client: identità giocatore (localStorage), chiamate API e hook SSE.

import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from './types';

export interface Identity {
  playerId: string;
  token: string;
  nickname: string;
  avatar: string;
}

export function saveIdentity(code: string, id: Identity) {
  localStorage.setItem(`qs:id:${code.toUpperCase()}`, JSON.stringify(id));
}

export function loadIdentity(code: string): Identity | null {
  try {
    const raw = localStorage.getItem(`qs:id:${code.toUpperCase()}`);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export async function api<T = { ok: boolean; error?: string }>(
  path: string,
  body: Record<string, unknown>
): Promise<T & { ok?: boolean; error?: string }> {
  // non lancia mai: chi chiama guarda `error` e non resta bloccato su un
  // flag "sto inviando" se il telefono perde la rete per un istante
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T & { ok?: boolean; error?: string };
  } catch {
    return { ok: false, error: 'network' } as T & { ok?: boolean; error?: string };
  }
}

/**
 * Quanto lo stream resta aperto dopo la fine della partita: il tempo perché
 * arrivi la battuta AI del podio, non di più (nessuno guarda la classifica per
 * sempre, e ogni stream aperto è una connessione al server).
 */
const ENDED_GRACE_MS = 45_000;

/** Connessione SSE con riconnessione automatica + offset orologio server. */
export function useGame(code: string, playerId: string | null) {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [offset, setOffset] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let endTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      const url = `/api/game/${code}/stream${playerId ? `?playerId=${playerId}` : ''}`;
      const es = new EventSource(url);
      esRef.current = es;
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => {
        try {
          const s = JSON.parse(ev.data) as GameSnapshot;
          setSnap(s);
          setOffset(s.serverNow - Date.now());
          // A partita finita il podio resta sullo schermo. Lo stream però non
          // si chiude subito: l'ultima battuta di SofAI la scrive l'AI e
          // arriva una decina di secondi dopo la fine (vedi sofia.ts).
          // Chiudendo all'istante non la si vedeva mai — sul server c'era, sul
          // telefono restava quella pre-scritta.
          if (s.status === 'ended' && !endTimer) {
            endTimer = setTimeout(() => {
              stopped = true;
              es.close();
            }, ENDED_GRACE_MS);
          }
        } catch {
          // frame malformato: ignora
        }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (stopped) return;
        retryTimer = setTimeout(async () => {
          // la partita può non esistere più (server riavviato o codice errato):
          // lo chiediamo alla route snapshot, non allo stream
          try {
            const probe = await fetch(`/api/game/${code}`, { cache: 'no-store' });
            if (probe.status === 404) {
              setNotFound(true);
              return;
            }
          } catch {
            // rete assente: continua a riprovare
          }
          connect();
        }, 1500);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (endTimer) clearTimeout(endTimer);
      esRef.current?.close();
    };
  }, [code, playerId]);

  return { snap, offset, notFound, connected };
}

export const AVATARS = ['🦊', '🐼', '🦄', '🐸', '🐯', '🐬', '🦉', '🐰', '🐙', '🦁', '🐨', '🚀', '⚡', '🌟', '🍕', '🎮'];
