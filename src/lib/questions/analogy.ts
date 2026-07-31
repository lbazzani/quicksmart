// Generatore "analogy": analogia visiva "A sta a B come C sta a ?".
// La trasformazione che porta da A a B va riapplicata a C, che però ha forma
// e colore DIVERSI da A: l'analogia trasferisce la trasformazione, non gli
// attributi. Per garantire una risposta UNIVOCA, C parte con gli stessi
// attributi "di stato" di A (rotazione, conteggio, dimensione, riempimento):
// così ogni lettura della regola porta alla stessa risposta.
// Difficoltà 1: una trasformazione evidente. 2: due trasformazioni combinate.
// 3: trasformazione relativa sottile (conteggio+rotazione insieme, scambio di
// colori o di dimensioni tra le due forme della cella).
//
// Distrattori: sempre errori PLAUSIBILI, mai valori casuali. Tre famiglie —
// copiare B pari pari; trasformare bene ma tenere la forma o il colore della
// prima coppia (mezza copia di B); sbagliare una delle trasformazioni
// (dimenticata, invertita, esagerata) — e la COPPIA di distrattori si compone a
// rotazione fra ricette che mescolano le famiglie (vedi pickPair).
// Serviva: finché i distrattori erano sempre gli stessi due tipi (copia di B +
// trasformazione parziale), le due opzioni sbagliate finivano per somigliarsi
// fra loro più di quanto somigliassero alla risposta, e "scegli l'opzione
// diversa dalle altre due" vinceva il 52,8% delle volte a d2 senza guardare la
// regola (tools/shortcut-test.ts). Ora rende il 29%, cioè quanto il caso.

import type { CellSpec, Difficulty, LocalizedText, Question, ShapeName, ShapeSpec } from '../types';
import { pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { tooSimilar } from '../colors';
import { L } from '../localize';
import { normRot, placeChoices, retry } from './qutils';

const ROTATABLE: ShapeName[] = ['triangle', 'arrow', 'moon'];
const PLAIN: ShapeName[] = ['circle', 'square', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross'];
const COLORS = [0, 1, 2, 3, 4, 5, 6, 7];

const SIZE_S = 0.3;
const SIZE_M = 0.55;
const SIZE_L = 0.8;
const PAIR_S = 0.4;
const PAIR_L = 0.85;

type TransformId = 'rot90' | 'rot180' | 'double' | 'half' | 'add' | 'grow' | 'shrink' | 'fillToggle';

/** modello astratto di una cella "semplice": count copie della stessa forma */
interface Model {
  shape: ShapeName;
  color: number;
  count: number;
  rot: number;
  size?: number;
  fill: 'solid' | 'outline';
}

function render(m: Model): CellSpec {
  const spec: ShapeSpec = { shape: m.shape, color: m.color, fillMode: m.fill };
  const rot = normRot(m.rot);
  if (rot) spec.rot = rot;
  if (m.size !== undefined) spec.size = m.size;
  const shapes = Array.from({ length: m.count }, () => ({ ...spec }));
  const layout: CellSpec['layout'] = m.count === 1 ? 'auto' : m.count >= 4 ? 'grid' : 'row';
  return { shapes, layout };
}

function applyOne(m: Model, t: TransformId): Model {
  switch (t) {
    case 'rot90':
      return { ...m, rot: normRot(m.rot + 90) };
    case 'rot180':
      return { ...m, rot: normRot(m.rot + 180) };
    case 'double':
      return { ...m, count: m.count * 2 };
    case 'half':
      return { ...m, count: m.count / 2 };
    case 'add':
      return { ...m, count: m.count + 1 };
    case 'grow':
      return { ...m, size: SIZE_L };
    case 'shrink':
      return { ...m, size: SIZE_S };
    case 'fillToggle':
      return { ...m, fill: m.fill === 'solid' ? 'outline' : 'solid' };
  }
}

function applyAll(m: Model, ts: TransformId[]): Model {
  return ts.reduce(applyOne, m);
}

// ---------------------------------------------------------------------------
// Distrattori: errori plausibili, e MAI sempre gli stessi due tipi
// ---------------------------------------------------------------------------

/** un errore plausibile: il modello sbagliato e il perché (finisce nella spiegazione) */
interface Slip {
  m: Model;
  why: LocalizedText;
}

/**
 * Le tre famiglie di errore. Le prime due lasciano intatta la STRUTTURA della
 * risposta (quante figure, quanto grandi, girate come) e sbagliano l'IDENTITÀ
 * (forma e colore); la terza fa l'opposto. Somigliano quindi alla risposta —
 * e fra loro — in modi diversi: è questo che permette di comporre la coppia di
 * distrattori senza lasciare una regolarità da sfruttare a occhio.
 */
type FamilyId = 'copyB' | 'leak' | 'slip';
type Pools = Record<FamilyId, Slip[]>;

/** una cella con meno di 1 figura è vuota, con più di 6 non si conta a colpo d'occhio */
const MIN_COUNT = 1;
const MAX_COUNT = 6;

/**
 * Errori plausibili sulla trasformazione `t`, costruiti a partire dalla risposta
 * giusta `k`: la trasformazione dimenticata, applicata al contrario, o applicata
 * di troppo. Ogni voce sbaglia UNA cosa sola — è così che arriva alla risposta
 * sbagliata chi ha capito la regola a metà, e per questo sono i distrattori che
 * insegnano qualcosa.
 */
function slips(c: Model, k: Model, t: TransformId): Slip[] {
  switch (t) {
    case 'rot90':
      return [
        { m: { ...k, rot: normRot(c.rot - 90) }, why: L('ruota dalla parte sbagliata', 'rotates the wrong way') },
        {
          m: { ...k, rot: normRot(c.rot + 180) },
          why: L('fa mezzo giro invece di un quarto', 'does a half turn instead of a quarter'),
        },
        { m: { ...k, rot: c.rot }, why: L('si dimentica di ruotare', 'forgets to rotate') },
      ];
    case 'rot180':
      return [
        { m: { ...k, rot: normRot(c.rot + 90) }, why: L('fa solo un quarto di giro', 'only does a quarter turn') },
        {
          m: { ...k, rot: normRot(c.rot + 270) },
          why: L('gira di tre quarti invece che di mezzo giro', 'does three-quarters of a turn instead of half'),
        },
        { m: { ...k, rot: c.rot }, why: L('si dimentica di ruotare', 'forgets to rotate') },
      ];
    case 'double':
      return [
        { m: { ...k, count: c.count }, why: L('si dimentica di raddoppiare', 'forgets to double it') },
        {
          m: { ...k, count: c.count + 1 },
          why: L('aggiunge una figura invece di raddoppiare', 'adds one shape instead of doubling'),
        },
        { m: { ...k, count: c.count * 4 }, why: L('raddoppia due volte', 'doubles it twice') },
      ];
    case 'half':
      return [
        { m: { ...k, count: c.count }, why: L('si dimentica di dimezzare', 'forgets to halve it') },
        {
          m: { ...k, count: c.count - 1 },
          why: L('toglie una figura invece di dimezzare', 'removes one shape instead of halving'),
        },
        { m: { ...k, count: c.count / 4 }, why: L('dimezza due volte', 'halves it twice') },
      ];
    case 'add':
      return [
        { m: { ...k, count: c.count }, why: L('si dimentica di aggiungere la figura', 'forgets to add the shape') },
        { m: { ...k, count: c.count + 2 }, why: L('ne aggiunge due invece di una', 'adds two instead of one') },
        {
          m: { ...k, count: c.count - 1 },
          why: L('ne toglie una invece di aggiungerla', 'removes one instead of adding it'),
        },
      ];
    case 'grow':
      return [
        { m: { ...k, size: c.size }, why: L('si dimentica di ingrandire', 'forgets to enlarge it') },
        {
          m: { ...k, size: SIZE_S },
          why: L('rimpicciolisce invece di ingrandire', 'shrinks it instead of enlarging it'),
        },
      ];
    case 'shrink':
      return [
        { m: { ...k, size: c.size }, why: L('si dimentica di rimpicciolire', 'forgets to shrink it') },
        {
          m: { ...k, size: SIZE_L },
          why: L('ingrandisce invece di rimpicciolire', 'enlarges it instead of shrinking it'),
        },
      ];
    case 'fillToggle':
      return [
        {
          m: { ...k, fill: c.fill },
          why:
            c.fill === 'solid'
              ? L('lascia la figura piena com’era', 'leaves the shape full, just like before')
              : L('lascia la figura vuota com’era', 'leaves the shape empty, just like before'),
        },
      ];
  }
}

/**
 * Tutti i distrattori plausibili della domanda, di tre famiglie diverse fra loro:
 *  - la copia letterale di B (l'errore classico dell'analogia: si ripete quello
 *    che si vede, senza accorgersi che B ha ancora forma e colore di A);
 *  - la trasformazione giusta ma con un attributo che "sbava" da B alla
 *    risposta: il colore della prima coppia, oppure la sua forma (mezza copia
 *    di B, l'errore di chi trasferisce anche l'identità e non solo la regola);
 *  - una delle trasformazioni sbagliata: dimenticata, invertita, esagerata.
 * Scartati: i modelli che verrebbero disegnati come la risposta o come la cella
 * C già visibile (un'opzione uguale a una cella in vista non è un distrattore).
 */
function distractorPool(a: Model, b: Model, c: Model, k: Model, ts: TransformId[]): Pools {
  const groups: Array<[FamilyId, Slip[]]> = [
    [
      'copyB',
      [
        {
          m: b,
          why: L(
            'copia B pari pari, senza accorgersi che B ha ancora la forma e il colore di A',
            'copies B exactly, without noticing that B still has A’s shape and color'
          ),
        },
      ],
    ],
    [
      'leak',
      [
        {
          m: { ...k, color: a.color },
          why: L(
            'trasforma bene ma tiene il colore della prima coppia',
            'gets the transformation right but keeps the color of the first pair'
          ),
        },
        {
          m: { ...k, shape: a.shape },
          why: L(
            'trasforma bene ma tiene la forma della prima coppia',
            'gets the transformation right but keeps the shape of the first pair'
          ),
        },
      ],
    ],
    ['slip', ts.flatMap((t) => slips(c, k, t))],
  ];
  const seen = new Set<string>([JSON.stringify(render(k)), JSON.stringify(render(c))]);
  const out: Pools = { copyB: [], leak: [], slip: [] };
  for (const [family, list] of groups) {
    for (const s of list) {
      if (!Number.isInteger(s.m.count) || s.m.count < MIN_COUNT || s.m.count > MAX_COUNT) continue;
      const key = JSON.stringify(render(s.m));
      if (seen.has(key)) continue;
      seen.add(key);
      out[family].push(s);
    }
  }
  return out;
}

/**
 * Sceglie i due distrattori per FAMIGLIE, non pescandoli alla rinfusa.
 *
 * È il punto delicato. Finché i due distrattori erano sempre "copia di B" +
 * "trasformazione a metà", le due opzioni sbagliate finivano per somigliarsi
 * fra loro (stessa struttura sballata) più di quanto somigliassero alla
 * risposta, e "scegli l'opzione diversa dalle altre due" vinceva senza
 * ragionare. Ma il rimedio ovvio — un distrattore che somiglia sempre alla
 * risposta — ribalta solo il problema: allora è la risposta a stare sempre in
 * coppia, e conviene scartare quella che si stacca.
 *
 * Perciò la coppia si compone a rotazione fra RICETTE che si assomigliano in
 * modi opposti. Misurate una alla volta con tools/shortcut-test.ts, "scegli
 * l'opzione diversa dalle altre due" rende: 20% con copia di B + errore di
 * regola, 50% con copia di B + mezza copia, 8% con due errori di regola, 5% con
 * mezza copia + errore di regola. Nessuna da sola va bene; i pesi qui sotto
 * sono quelli che riportano la miscela al livello del caso.
 *
 * Le mezze copie di B si offrono quasi sempre INSIEME alla copia intera: messe
 * una accanto all'altra, la differenza fra le due dice esattamente quale
 * attributo di A è stato trasferito per sbaglio, ed è il punto della spiegazione.
 */
const RECIPES: Array<[FamilyId, FamilyId]> = (
  [
    [3, ['copyB', 'slip']], // la coppia classica: la copia di B e un errore di regola
    [3, ['copyB', 'leak']], // la copia di B e una sua mezza copia (stessa forma, o stesso colore)
    [3, ['slip', 'slip']], // due modi diversi di sbagliare la stessa regola
    [1, ['leak', 'slip']], // rara: lima l'ultimo residuo di regolarità
  ] as Array<[number, [FamilyId, FamilyId]]>
).flatMap(([n, r]) => Array.from({ length: n }, () => r));

function pickPair(rng: Rng, p: Pools): [Slip, Slip] | null {
  for (const [f, g] of shuffle(rng, [...RECIPES])) {
    if (f === g) {
      if (p[f].length < 2) continue;
      const [x, y] = pickN(rng, p[f], 2);
      return [x, y];
    }
    if (!p[f].length || !p[g].length) continue;
    return [pick(rng, p[f]), pick(rng, p[g])];
  }
  return null;
}

function describeT(t: TransformId, a: Model): string {
  switch (t) {
    case 'rot90':
      return 'ogni figura ruota di 90° in senso orario';
    case 'rot180':
      return 'ogni figura fa mezzo giro (180°)';
    case 'double':
      return `il numero di figure raddoppia (da ${a.count} a ${a.count * 2})`;
    case 'half':
      return `il numero di figure si dimezza (da ${a.count} a ${a.count / 2})`;
    case 'add':
      return `si aggiunge una figura (da ${a.count} a ${a.count + 1})`;
    case 'grow':
      return 'la figura diventa più grande';
    case 'shrink':
      return 'la figura diventa più piccola';
    case 'fillToggle':
      return a.fill === 'solid' ? 'la figura piena diventa vuota (solo contorno)' : 'la figura vuota diventa piena';
  }
}

/** come `describeT`, in inglese */
function describeTEn(t: TransformId, a: Model): string {
  switch (t) {
    case 'rot90':
      return 'every shape rotates 90° clockwise';
    case 'rot180':
      return 'every shape does a half turn (180°)';
    case 'double':
      return `the number of shapes doubles (from ${a.count} to ${a.count * 2})`;
    case 'half':
      return `the number of shapes is halved (from ${a.count} to ${a.count / 2})`;
    case 'add':
      return `one shape gets added (from ${a.count} to ${a.count + 1})`;
    case 'grow':
      return 'the shape gets bigger';
    case 'shrink':
      return 'the shape gets smaller';
    case 'fillToggle':
      return a.fill === 'solid' ? 'the full shape becomes empty (outline only)' : 'the empty shape becomes full';
  }
}

function explain(ts: TransformId[], a: Model, whys: [LocalizedText, LocalizedText]): string {
  const parts = ts.map((t) => describeT(t, a));
  return (
    `Da A a B ${parts.join(' e ')}. La stessa trasformazione va applicata a C, che però ha forma e ` +
    'colore suoi: cambia lo stato, non l’identità. Le altre due opzioni sono gli errori più facili: ' +
    `c'è chi ${whys[0].it} e chi ${whys[1].it}.`
  );
}

/** come `explain`, in inglese */
function explainEn(ts: TransformId[], a: Model, whys: [LocalizedText, LocalizedText]): string {
  const parts = ts.map((t) => describeTEn(t, a));
  return (
    `From A to B, ${parts.join(' and ')}. The same transformation applies to C, which has its own shape and ` +
    'color: it changes state, not identity. The other two options are the easiest mistakes: ' +
    `one ${whys[0].en}, the other ${whys[1].en}.`
  );
}

/**
 * Costruisce A e C: stessi attributi di partenza (conteggio, rotazione,
 * dimensione, riempimento) ma forma e colore diversi. Questo rende la
 * risposta univoca: qualunque lettura della regola A→B dà lo stesso esito su C.
 * I due colori non devono somigliarsi (CONFUSABLE in ../colors): fra le opzioni
 * c'è anche "trasformazione giusta ma con il colore della prima coppia", e una
 * risposta non si può mai giocare su una sfumatura.
 */
function makeBase(rng: Rng, ts: TransformId[]): { a: Model; c: Model } {
  const needRot = ts.includes('rot90') || ts.includes('rot180');
  const pool = needRot ? ROTATABLE : PLAIN;
  const [shapeA, shapeC] = pickN(rng, pool, 2);
  const [colA, colC] = pickN(rng, COLORS, 2);
  if (tooSimilar(colA, colC)) throw new Error('colori delle due coppie troppo simili');
  const count = ts.includes('double') ? 2 : ts.includes('half') ? 4 : ts.includes('add') ? randInt(rng, 1, 3) : 1;
  const rot = needRot ? pick(rng, [0, 90, 180, 270]) : 0;
  const size = ts.includes('grow') || ts.includes('shrink') ? SIZE_M : undefined;
  const fill = pick(rng, ['solid', 'outline'] as const);
  const a: Model = { shape: shapeA, color: colA, count, rot, fill };
  const c: Model = { shape: shapeC, color: colC, count, rot, fill };
  if (size !== undefined) {
    a.size = size;
    c.size = size;
  }
  return { a, c };
}

function assemble(
  rng: Rng,
  difficulty: Difficulty,
  cellA: CellSpec,
  cellB: CellSpec,
  cellC: CellSpec,
  correct: CellSpec,
  distractors: [CellSpec, CellSpec],
  explanation: LocalizedText
): Question {
  const { choices, correctIndex } = placeChoices(
    rng,
    { kind: 'cell', cell: correct },
    [
      { kind: 'cell', cell: distractors[0] },
      { kind: 'cell', cell: distractors[1] },
    ]
  );
  return {
    qtype: 'analogy' as const,
    difficulty,
    prompt: L('A sta a B come C sta a...?', 'A is to B as C is to...?'),
    payload: {
      kind: 'cells' as const,
      analogy: true,
      rows: [
        [cellA, cellB],
        [cellC, { shapes: [], unknown: true } as CellSpec],
      ],
    },
    choices,
    correctIndex,
    explanation,
  };
}

/** costruisce la domanda per una lista di trasformazioni, con due distrattori pescati dal pool */
function buildFromTransforms(rng: Rng, difficulty: Difficulty, ts: TransformId[]): Question {
  const { a, c } = makeBase(rng, ts);
  const b = applyAll(a, ts);
  const correct = applyAll(c, ts);
  const pair = pickPair(rng, distractorPool(a, b, c, correct, ts));
  if (!pair) throw new Error('errori plausibili insufficienti');
  const [w1, w2] = pair;
  return assemble(
    rng,
    difficulty,
    render(a),
    render(b),
    render(c),
    render(correct),
    [render(w1.m), render(w2.m)],
    L(explain(ts, a, [w1.why, w2.why]), explainEn(ts, a, [w1.why, w2.why]))
  );
}

// ---------------------------------------------------------------------------
// Difficoltà 1: una trasformazione evidente
// ---------------------------------------------------------------------------

const SINGLE_POOL: TransformId[] = ['rot90', 'rot180', 'double', 'half', 'add', 'grow', 'shrink', 'fillToggle'];

function genEasy(rng: Rng, difficulty: Difficulty): Question {
  const t = pick(rng, SINGLE_POOL);
  return buildFromTransforms(rng, difficulty, [t]);
}

// ---------------------------------------------------------------------------
// Difficoltà 2: due trasformazioni combinate
// ---------------------------------------------------------------------------

function genMedium(rng: Rng, difficulty: Difficulty): Question {
  const kind = randInt(rng, 0, 4);
  let ts: [TransformId, TransformId];
  if (kind === 0) ts = [pick(rng, ['rot90', 'rot180'] as const), 'fillToggle'];
  else if (kind === 1) ts = ['rot90', pick(rng, ['grow', 'shrink'] as const)];
  else if (kind === 2) ts = [pick(rng, ['double', 'add'] as const), 'fillToggle'];
  else if (kind === 3) ts = [pick(rng, ['grow', 'shrink'] as const), 'fillToggle'];
  else ts = ['add', pick(rng, ['grow', 'shrink'] as const)];
  return buildFromTransforms(rng, difficulty, ts);
}

// ---------------------------------------------------------------------------
// Difficoltà 3: trasformazione relativa sottile
// ---------------------------------------------------------------------------

function pairCell(s1: ShapeSpec, s2: ShapeSpec): CellSpec {
  return { shapes: [s1, s2], layout: 'row' };
}

/** il conteggio raddoppia (o si dimezza) E ogni figura ruota di 90° */
function genHardCombo(rng: Rng, difficulty: Difficulty): Question {
  const ts: [TransformId, TransformId] = [pick(rng, ['double', 'half'] as const), 'rot90'];
  return buildFromTransforms(rng, difficulty, ts);
}

/** le due figure della cella si scambiano i colori (restando al loro posto) */
function genSwapColor(rng: Rng, difficulty: Difficulty): Question {
  const [s1, s2, s3, s4] = pickN(rng, PLAIN, 4);
  const [c1, c2, c3, c4] = pickN(rng, COLORS, 4);
  // qui a scambiarsi sono proprio i colori: i due di una stessa coppia non
  // possono somigliarsi, o lo scambio non si vedrebbe (CONFUSABLE in ../colors)
  if (tooSimilar(c1, c2) || tooSimilar(c3, c4)) throw new Error('colori da scambiare troppo simili');
  const mk = (shape: ShapeName, color: number): ShapeSpec => ({ shape, color, fillMode: 'solid' });
  const A = pairCell(mk(s1, c1), mk(s2, c2));
  const B = pairCell(mk(s1, c2), mk(s2, c1));
  const C = pairCell(mk(s3, c3), mk(s4, c4));
  const correct = pairCell(mk(s3, c4), mk(s4, c3));
  const copyB = pairCell(mk(s1, c2), mk(s2, c1)); // errore classico: copiare B
  const posSwap = pairCell(mk(s4, c4), mk(s3, c3)); // scambia le posizioni invece dei colori
  return assemble(
    rng,
    difficulty,
    A,
    B,
    C,
    correct,
    [copyB, posSwap],
    L(
      'Da A a B le due figure si scambiano i colori restando ognuna al suo posto. ' +
        'Lo stesso scambio va applicato alla coppia C: stesse forme nello stesso ordine, ma colori invertiti. ' +
        'Il trucco: non copiare B e non scambiare le posizioni delle forme.',
      'From A to B, the two shapes swap colors while each one stays put. ' +
        'The same swap applies to pair C: same shapes in the same order, but with the colors flipped. ' +
        'The trick: don’t copy B, and don’t swap the shapes’ positions.'
    )
  );
}

/** le due figure della cella si scambiano le dimensioni (grande <-> piccola) */
function genSwapSize(rng: Rng, difficulty: Difficulty): Question {
  const [s1, s2, s3, s4] = pickN(rng, PLAIN, 4);
  const [c1, c2, c3, c4] = pickN(rng, COLORS, 4);
  const bigFirst = pick(rng, [true, false]);
  const [z1, z2] = bigFirst ? [PAIR_L, PAIR_S] : [PAIR_S, PAIR_L];
  const mk = (shape: ShapeName, color: number, size: number): ShapeSpec => ({ shape, color, size, fillMode: 'solid' });
  const A = pairCell(mk(s1, c1, z1), mk(s2, c2, z2));
  const B = pairCell(mk(s1, c1, z2), mk(s2, c2, z1));
  const C = pairCell(mk(s3, c3, z1), mk(s4, c4, z2));
  const correct = pairCell(mk(s3, c3, z2), mk(s4, c4, z1));
  const copyB = pairCell(mk(s1, c1, z2), mk(s2, c2, z1)); // errore classico: copiare B
  const partial = pairCell(mk(s3, c3, z2), mk(s4, c4, z2)); // solo la prima figura cambia dimensione
  return assemble(
    rng,
    difficulty,
    A,
    B,
    C,
    correct,
    [copyB, partial],
    L(
      'Da A a B le due figure si scambiano le dimensioni: la grande diventa piccola e la piccola diventa grande. ' +
        'Lo stesso vale per la coppia C. Il trucco: entrambe le figure cambiano dimensione, non una sola, ' +
        'e non bisogna copiare B.',
      'From A to B, the two shapes swap sizes: the big one becomes small and the small one becomes big. ' +
        'The same goes for pair C. The trick: both shapes change size, not just one — ' +
        'and don’t copy B.'
    )
  );
}

function genHard(rng: Rng, difficulty: Difficulty): Question {
  const kind = randInt(rng, 0, 2);
  if (kind === 0) return genHardCombo(rng, difficulty);
  if (kind === 1) return genSwapColor(rng, difficulty);
  return genSwapSize(rng, difficulty);
}

// ---------------------------------------------------------------------------

export function genAnalogy(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    if (difficulty === 1) return genEasy(rng, difficulty);
    if (difficulty === 2) return genMedium(rng, difficulty);
    return genHard(rng, difficulty);
  });
}
