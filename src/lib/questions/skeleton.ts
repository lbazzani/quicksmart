// "Scheletro" di una domanda: la sua struttura visiva a meno dei parametri
// (colori, rotazioni, dimensioni, numeri). Due domande con lo stesso scheletro
// si somigliano a colpo d'occhio — è il livello a cui un giocatore dice
// "questa l'ho già vista". Serve per non riproporre strutture recenti e per
// misurare la varietà dei generatori.

import type { Question } from '../types';

const VARIABLE_KEYS = new Set(['color', 'rot', 'size']);

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = VARIABLE_KEYS.has(k) ? '*' : strip(val);
    }
    return out;
  }
  if (typeof v === 'number') return '#';
  return v;
}

export function skeletonOf(q: Question): string {
  return JSON.stringify([q.qtype, strip(q.payload)]);
}
