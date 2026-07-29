// La tavolozza di QuickSmart.
//
// Arancione come colore guida, con l'ambra a fargli eco e il verde acqua come
// contrappunto freddo: sono complementari, quindi si mettono in risalto a
// vicenda senza litigare. Niente viola.
//
// I nomi stanno qui e non nei singoli generatori: se una domanda dicesse
// "ambra" e un'altra "giallo" per lo stesso colore, in una partita in famiglia
// la discussione sarebbe immediata.
// L'ordine segue PALETTE in src/components/visuals.tsx.

export const COLOR_NAMES = [
  'arancione', // 0 #f97316 — il colore guida
  'giallo', // 1 #fbbf24
  'verde acqua', // 2 #14b8a6
  'rosa', // 3 #f472b6
  'verde', // 4 #4ade80
  'rosso', // 5 #ef4444
  'azzurro', // 6 #38bdf8
  'panna', // 7 #f5f0e8
] as const;

export function colorName(i: number): string {
  return COLOR_NAMES[((i % COLOR_NAMES.length) + COLOR_NAMES.length) % COLOR_NAMES.length];
}

/**
 * Le quattro flessioni di ogni colore: maschile e femminile, singolare e
 * plurale. Stanno qui perché una domanda deve poter dire "due stelle gialle" e
 * un'altra "un cerchio giallo" senza che i generatori si inventino accordi
 * diversi. Indicizzate come COLOR_NAMES.
 */
export const COLOR_FORMS: ReadonlyArray<{ ms: string; fs: string; mp: string; fp: string }> = [
  { ms: 'arancione', fs: 'arancione', mp: 'arancioni', fp: 'arancioni' },
  { ms: 'giallo', fs: 'gialla', mp: 'gialli', fp: 'gialle' },
  { ms: 'verde acqua', fs: 'verde acqua', mp: 'verde acqua', fp: 'verde acqua' },
  { ms: 'rosa', fs: 'rosa', mp: 'rosa', fp: 'rosa' },
  { ms: 'verde', fs: 'verde', mp: 'verdi', fp: 'verdi' },
  { ms: 'rosso', fs: 'rossa', mp: 'rossi', fp: 'rosse' },
  { ms: 'azzurro', fs: 'azzurra', mp: 'azzurri', fp: 'azzurre' },
  { ms: 'panna', fs: 'panna', mp: 'panna', fp: 'panna' },
];

/** nome del colore accordato con genere e numero */
export function colorWord(i: number, femminile: boolean, plurale = false): string {
  const f = COLOR_FORMS[((i % COLOR_FORMS.length) + COLOR_FORMS.length) % COLOR_FORMS.length];
  return plurale ? (femminile ? f.fp : f.mp) : femminile ? f.fs : f.ms;
}

/**
 * Colori che a dimensione ridotta si confondono tra loro: non vanno mai usati
 * come UNICO elemento che distingue la risposta dai distrattori.
 * arancione/giallo, arancione/rosso, giallo/panna, verde acqua/verde,
 * verde acqua/azzurro, rosa/rosso.
 */
export const CONFUSABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 5],
  [1, 7],
  [2, 4],
  [2, 6],
  [3, 5],
];

/** true se i due colori sono troppo simili per distinguerli in piccolo */
export function tooSimilar(a: number, b: number): boolean {
  return CONFUSABLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
