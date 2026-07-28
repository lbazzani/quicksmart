// Nomi dei colori della palette, condivisi da tutti i generatori.
// Devono essere UGUALI ovunque: in una partita in famiglia, se una domanda dice
// "ambra" e un'altra "giallo" per lo stesso colore, la confusione è immediata.
// L'ordine segue PALETTE in src/components/visuals.tsx.

export const COLOR_NAMES = [
  'ciano', // 0 #22d3ee
  'rosa', // 1 #f472b6
  'viola', // 2 #a78bfa
  'giallo', // 3 #fbbf24
  'verde', // 4 #34d399
  'rosso', // 5 #fb7185
  'azzurro', // 6 #60a5fa
  'arancione', // 7 #f97316
] as const;

export function colorName(i: number): string {
  return COLOR_NAMES[((i % COLOR_NAMES.length) + COLOR_NAMES.length) % COLOR_NAMES.length];
}

/**
 * Colori che a dimensione ridotta si confondono tra loro: non vanno mai usati
 * come UNICO elemento che distingue la risposta dai distrattori.
 * ciano/azzurro, viola/azzurro, rosa/rosso, giallo/arancione, ciano/verde.
 */
export const CONFUSABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 6],
  [2, 6],
  [1, 5],
  [3, 7],
  [0, 4],
];

/** true se i due colori sono troppo simili per distinguerli in piccolo */
export function tooSimilar(a: number, b: number): boolean {
  return CONFUSABLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
