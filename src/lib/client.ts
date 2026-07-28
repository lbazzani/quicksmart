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
): Promise<T & { error?: string }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T & { error?: string };
}

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
        } catch {
          // frame malformato: ignora
        }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        // se la partita non esiste (server riavviato / codice errato) il
        // reconnect fallirà sempre: dopo qualche tentativo segnala not found
        if (!stopped) {
          retryTimer = setTimeout(async () => {
            try {
              const head = await fetch(`/api/game/${code}/stream`, { method: 'HEAD' });
              if (head.status === 404) {
                setNotFound(true);
                return;
              }
            } catch {
              // rete assente: continua a riprovare
            }
            connect();
          }, 1500);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
    };
  }, [code, playerId]);

  return { snap, offset, notFound, connected };
}

export const AVATARS = ['🦊', '🐼', '🦄', '🐸', '🐯', '🐬', '🦉', '🐰', '🐙', '🦁', '🐨', '🚀', '⚡', '🌟', '🍕', '🎮'];
