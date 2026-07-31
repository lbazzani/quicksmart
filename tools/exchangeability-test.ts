// Il test di scambiabilità.
//
// Perché non basta elencare le scorciatoie: se si corregge un generatore
// puntando a un elenco fisso di euristiche, si impara a battere il misuratore
// e la scorciatoia si sposta altrove invece di sparire. È successo davvero.
//
// Qui non si enumerano euristiche: si verifica la proprietà che le rende tutte
// inutili insieme. La risposta corretta deve essere INDISTINGUIBILE dai
// distrattori guardando solo le tre opzioni — se una qualunque caratteristica
// misurabile (il valore, quanto è grande, quante figure ha, quanto è lunga,
// quanto somiglia alle altre due) è sistematicamente diversa nella risposta,
// allora esiste un'euristica cieca che la sfrutta, anche una a cui non abbiamo
// pensato.
//
// Per ogni caratteristica si guarda il RANGO della risposta fra le tre opzioni:
// se le opzioni fossero scambiabili, la risposta sarebbe la più piccola, quella
// di mezzo o la più grande un terzo delle volte ciascuna.
//
// Uso: npx tsx tools/exchangeability-test.ts [campioni=1500] [tipo]

import { mulberry32 } from '../src/lib/rng';
import { ALL_QUESTION_TYPES, GENERATORS } from '../src/lib/questions';
import type { ChoiceVisual, Difficulty, Question, QuestionType } from '../src/lib/types';

const N = parseInt(process.argv[2] ?? '1500', 10);
const ONLY = process.argv[3] as QuestionType | undefined;

/** quanto una frequenza può scostarsi da 1/3 prima di essere sfruttabile */
const TOLERANCE = 0.12; // → allarme sopra il 45%, come shortcut-test

// ---------------------------------------------------------------------------
// Caratteristiche osservabili di un'opzione, senza sapere nulla del quesito
// ---------------------------------------------------------------------------

type Feature = { name: string; of: (c: ChoiceVisual, all: ChoiceVisual[]) => number | null };

const numberIn = (s: string): number | null => {
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};

/** somma di tutti i numeri contenuti in una stringa (orari, espressioni) */
const allNumbers = (s: string): number | null => {
  const m = s.match(/-?\d+/g);
  return m ? m.reduce((a, b) => a + parseInt(b, 10), 0) : null;
};

function shapesOf(c: ChoiceVisual) {
  return c.kind === 'cell' ? c.cell.shapes : null;
}

/**
 * Quanto due opzioni si somigliano A VEDERSI: si confrontano solo le proprietà
 * che un occhio coglie (forme presenti, colori, quantità, pieno/vuoto), non la
 * forma dei dati. Un bambino non vede il JSON, vede il disegno.
 */
function visualSimilarity(a: ChoiceVisual, b: ChoiceVisual): number {
  if (a.kind !== b.kind) return 0;
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text ? 1 : 0;
  const sa = shapesOf(a);
  const sb = shapesOf(b);
  if (!sa || !sb) return JSON.stringify(a) === JSON.stringify(b) ? 1 : 0;
  const traits = (s: NonNullable<ReturnType<typeof shapesOf>>) => [
    s.length,
    new Set(s.map((x) => x.shape)).size,
    new Set(s.map((x) => x.color ?? 0)).size,
    s.filter((x) => (x.fillMode ?? 'solid') === 'solid').length,
    s.filter((x) => (x.rot ?? 0) !== 0).length,
  ];
  const ta = traits(sa);
  const tb = traits(sb);
  const equal = ta.filter((v, i) => v === tb[i]).length;
  return equal / ta.length;
}

/**
 * Solo caratteristiche che si colgono guardando le tre opzioni per qualche
 * secondo. Deliberatamente NON si misurano proprietà invisibili come la
 * dimensione dei dati: ottimizzare contro quelle significherebbe inseguire
 * fantasmi e rischiare di peggiorare le domande per nulla.
 */
const FEATURES: Feature[] = [
  // il testo è bilingue (LocalizedText), ma queste feature sono numeriche: la
  // lingua italiana basta a misurarle, il numero non cambia fra le due
  { name: 'primo numero', of: (c) => (c.kind === 'text' ? numberIn(c.text.it) : null) },
  { name: 'somma dei numeri', of: (c) => (c.kind === 'text' ? allNumbers(c.text.it) : null) },
  { name: 'lunghezza del testo', of: (c) => (c.kind === 'text' ? c.text.it.length : null) },
  { name: 'quante figure', of: (c) => shapesOf(c)?.length ?? null },
  {
    name: 'quanti colori diversi',
    of: (c) => {
      const s = shapesOf(c);
      return s ? new Set(s.map((x) => x.color ?? 0)).size : null;
    },
  },
  {
    name: 'quanto è grande il disegno',
    of: (c) => {
      const s = shapesOf(c);
      return s?.length ? s.reduce((a, x) => a + (x.size ?? 0.8), 0) : null;
    },
  },
  {
    name: 'quante figure piene',
    of: (c) => {
      const s = shapesOf(c);
      return s ? s.filter((x) => (x.fillMode ?? 'solid') === 'solid').length : null;
    },
  },
  {
    name: 'somiglianza visiva con le altre due',
    of: (c, all) => {
      const others = all.filter((o) => o !== c);
      if (others.length !== 2) return null;
      return (visualSimilarity(c, others[0]) + visualSimilarity(c, others[1])) / 2;
    },
  },
];

// ---------------------------------------------------------------------------

interface Tally {
  /** quante volte la risposta ha rango 0 (minimo), 1 (mezzo), 2 (massimo) */
  ranks: [number, number, number];
  total: number;
}

/** rango della risposta fra le tre, con i pari merito distribuiti equamente */
function rankOf(values: number[], correctIndex: number): number | null {
  const v = values[correctIndex];
  const lower = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length;
  if (equal === 3) return null; // tutte uguali: nessuna informazione
  // con un pari merito il rango è ambiguo: si assegna al centro
  if (equal === 2) return lower === 0 ? 0 : 2;
  return lower;
}

const results: { qtype: string; d: Difficulty; feature: string; bias: string; pct: number; n: number }[] = [];
const types = ONLY ? [ONLY] : ALL_QUESTION_TYPES;

for (const qtype of types) {
  for (const d of [1, 2, 3] as Difficulty[]) {
    const rng = mulberry32(770077 + d * 13);
    const tallies = new Map<string, Tally>();
    for (let i = 0; i < N; i++) {
      let q: Question;
      try {
        q = GENERATORS[qtype](rng, d);
      } catch {
        continue;
      }
      for (const f of FEATURES) {
        const vals = q.choices.map((c) => f.of(c, q.choices));
        if (vals.some((v) => v === null)) continue;
        const r = rankOf(vals as number[], q.correctIndex);
        if (r === null) continue;
        const t = tallies.get(f.name) ?? { ranks: [0, 0, 0] as [number, number, number], total: 0 };
        t.ranks[r]++;
        t.total++;
        tallies.set(f.name, t);
      }
    }
    for (const [feature, t] of tallies) {
      if (t.total < 80) continue;
      const labels = ['la più piccola', 'quella di mezzo', 'la più grande'];
      for (let r = 0; r < 3; r++) {
        const pct = t.ranks[r] / t.total;
        if (pct > 1 / 3 + TOLERANCE) {
          results.push({ qtype, d, feature, bias: labels[r], pct, n: t.total });
        }
      }
    }
  }
}

results.sort((a, b) => b.pct - a.pct);

console.log(`Campioni per tipo/difficoltà: ${N}`);
console.log(`Una caratteristica è sfruttabile se la risposta ne è l'estremo più del ${((1 / 3 + TOLERANCE) * 100).toFixed(0)}% delle volte (il caso è 33%)\n`);

if (results.length === 0) {
  console.log('✓ Le tre opzioni sono scambiabili: nessuna caratteristica superficiale tradisce la risposta.');
  process.exit(0);
}

console.log('CARATTERISTICHE CHE TRADISCONO LA RISPOSTA:');
console.log('tipo         d  caratteristica                 la risposta è…      quota   casi');
console.log('─'.repeat(88));
for (const r of results.slice(0, 40)) {
  console.log(
    `${r.qtype.padEnd(12)} ${r.d}  ${r.feature.padEnd(30)} ${r.bias.padEnd(18)} ${(r.pct * 100).toFixed(1).padStart(6)}%  ${String(r.n).padStart(5)}`
  );
}
if (results.length > 40) console.log(`… e altre ${results.length - 40}`);
console.error(`\n✗ ${results.length} caratteristiche sfruttabili.`);
process.exit(1);
