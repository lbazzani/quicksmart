'use client';
// Registra il service worker (public/sw.js): icona a schermo home e asset in
// cache. Solo in produzione — in dev il caching maschererebbe le modifiche.

import { useEffect } from 'react';

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // niente service worker (http in LAN, browser vecchio): il gioco va uguale
    });
  }, []);
  return null;
}
