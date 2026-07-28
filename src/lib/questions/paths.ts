// Generatore "paths": percorsi logici su una griglia di frecce.
//
// LINGUAGGIO VISIVO (uniforme in tutte le varianti):
//  - ogni casella della griglia contiene UNA freccia: dice dove ti sposti se
//    ti trovi lì (0°=destra, 90°=giù, 180°=sinistra, 270°=su);
//  - la stella marca la casella di partenza (la casella è evidenziata e
//    contiene stella + freccia);
//  - le altre figure (cuore, luna, croce…) sono segnaposto: marcano una
//    casella ma NON fermano il cammino. È la domanda a dire dove ci si ferma
//    ("fai 4 passi", "arriva al cuore").
// Tutte le frecce puntano dentro la griglia, quindi da qualunque casella il
// cammino non esce mai; essendo la griglia finita, ogni cammino o raggiunge il
// bersaglio o entra in un girotondo (ciclo) — le difficoltà 2 e 3 ci giocano.
//
// DIFFICOLTÀ
//  1 (3×3, 2-4 passi): una sola regola, si risolve col dito.
//     a) dove ti fermi dopo N passi   b) quanti passi fino al cuore
//     c) quante volte cambi direzione d) direzione dell'ultimo passo
//  2 (4×4, 3-6 passi): percorso più lungo, distrattori sul percorso stesso,
//     oppure più partenze / un anello da riconoscere.
//     a) quanti passi (con segnaposto esca)  b) dove ti fermi dopo N passi
//     c) quale stella arriva al cuore (2 stelle finiscono in un anello)
//     d) dopo quanti passi torni sulla stella (anello chiuso)
//  3 (4×4 o 4×5): cicli e confronti fra percorsi, con conti da fare.
//     a) quale stella arriva prima (o pareggio)  b) dove ti fermi dopo K passi
//        con K grande (serve il resto della divisione)
//     c) quale stella gira in tondo per sempre   d) quante caselle ha l'anello
//
// Tutti i percorsi sono SIMULATI davvero (funzione `trace`) prima di comporre
// la domanda: se la simulazione non conferma la costruzione si rigenera.
// I distrattori non sono mai casuali: casella prima / casella dopo, su e giù
// scambiati, conteggio ±1, "mi sono dimenticato del pezzo prima del girotondo".

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

// TODO(coordinatore): quando 'paths' entrerà in QuestionType basta `qtype: 'paths'`.

// ---------------------------------------------------------------------------
// direzioni e posizioni
// ---------------------------------------------------------------------------

type Dir = 0 | 90 | 180 | 270;
const DIRS: Dir[] = [0, 90, 180, 270];
/** [dr, dc] per ogni direzione */
const STEP: Record<Dir, [number, number]> = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };
/** su ↔ giù (l'errore più tipico) */
const VFLIP: Record<Dir, Dir> = { 0: 0, 90: 270, 180: 180, 270: 90 };
/** destra ↔ sinistra */
const HFLIP: Record<Dir, Dir> = { 0: 180, 90: 90, 180: 0, 270: 270 };
const OPPOSITE: Record<Dir, Dir> = { 0: 180, 90: 270, 180: 0, 270: 90 };
/** parola usata nel racconto del percorso */
const DIR_WORD: Record<Dir, string> = { 0: 'destra', 90: 'giù', 180: 'sinistra', 270: 'su' };
/** testo delle opzioni di risposta */
const DIR_CHOICE: Record<Dir, string> = {
  0: 'verso destra',
  90: 'verso il basso',
  180: 'verso sinistra',
  270: "verso l'alto",
};

interface Pos {
  r: number;
  c: number;
}

const kOf = (p: Pos) => p.r * 16 + p.c;
const samePos = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;
const stepPos = (p: Pos, d: Dir): Pos => ({ r: p.r + STEP[d][0], c: p.c + STEP[d][1] });
const inside = (R: number, C: number, p: Pos) => p.r >= 0 && p.r < R && p.c >= 0 && p.c < C;
const adjacent = (a: Pos, b: Pos) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

function dirBetween(a: Pos, b: Pos): Dir {
  for (const d of DIRS) if (samePos(stepPos(a, d), b)) return d;
  throw new Error('caselle non adiacenti');
}

function allCells(R: number, C: number): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) out.push({ r, c });
  return out;
}

// ---------------------------------------------------------------------------
// figure e colori
// ---------------------------------------------------------------------------

interface FigInfo {
  shape: ShapeName;
  /** testo dell'opzione: "cuore" */
  name: string;
  /** con l'articolo: "il cuore" / "la luna" */
  il: string;
  /** "al cuore" / "alla luna" */
  al: string;
  /** "sul cuore" / "sulla luna" */
  sul: string;
}

const FIGS: FigInfo[] = [
  { shape: 'heart', name: 'cuore', il: 'il cuore', al: 'al cuore', sul: 'sul cuore' },
  { shape: 'moon', name: 'luna', il: 'la luna', al: 'alla luna', sul: 'sulla luna' },
  { shape: 'cross', name: 'croce', il: 'la croce', al: 'alla croce', sul: 'sulla croce' },
  { shape: 'diamond', name: 'rombo', il: 'il rombo', al: 'al rombo', sul: 'sul rombo' },
  { shape: 'hexagon', name: 'esagono', il: "l'esagono", al: "all'esagono", sul: "sull'esagono" },
  { shape: 'pentagon', name: 'pentagono', il: 'il pentagono', al: 'al pentagono', sul: 'sul pentagono' },
  { shape: 'circle', name: 'cerchio', il: 'il cerchio', al: 'al cerchio', sul: 'sul cerchio' },
  { shape: 'square', name: 'quadrato', il: 'il quadrato', al: 'al quadrato', sul: 'sul quadrato' },
];

/** "1 passo" / "3 passi" */
const passi = (n: number) => `${n} ${n === 1 ? 'passo' : 'passi'}`;
/** "1 casella" / "4 caselle" */
const caselle = (n: number) => `${n} ${n === 1 ? 'casella' : 'caselle'}`;

/** il cuore è il bersaglio "di casa": lo si preferisce quando il bersaglio è uno solo */
function pickTarget(rng: Rng): FigInfo {
  return chance(rng, 0.45) ? FIGS[0] : pick(rng, FIGS);
}

/** colori delle stelle: ben distinguibili tra loro e dal ciano delle frecce */
const STAR_COLORS = [1, 2, 3, 4]; // rosa, viola, gialla, verde
const STAR_NAME: Record<number, string> = { 1: 'rosa', 2: 'viola', 3: 'gialla', 4: 'verde' };
/** colori dei segnaposto (mai il ciano/azzurro delle frecce) */
const FIG_COLORS = [1, 2, 3, 4, 5, 7];
/** le frecce sono sempre dello stesso colore: non devono distinguersi tra loro */
const ARROW_COLORS = [0, 6];

const starLabel = (color: number) => `stella ${STAR_NAME[color]}`;

// ---------------------------------------------------------------------------
// tavola
// ---------------------------------------------------------------------------

interface Landmark {
  shape: ShapeName;
  color: number;
}

interface Board {
  R: number;
  C: number;
  dir: (Dir | null)[][];
  land: (Landmark | null)[][];
  star: (number | null)[][];
}

function newBoard(R: number, C: number): Board {
  return {
    R,
    C,
    dir: Array.from({ length: R }, () => Array<Dir | null>(C).fill(null)),
    land: Array.from({ length: R }, () => Array<Landmark | null>(C).fill(null)),
    star: Array.from({ length: R }, () => Array<number | null>(C).fill(null)),
  };
}

/** assegna le frecce lungo un cammino (l'ultima casella resta libera) */
function layPath(b: Board, path: Pos[]) {
  for (let i = 0; i < path.length - 1; i++) {
    b.dir[path[i].r][path[i].c] = dirBetween(path[i], path[i + 1]);
  }
}

/** assegna le frecce di un anello chiuso */
function layCycle(b: Board, cyc: Pos[]) {
  for (let i = 0; i < cyc.length; i++) {
    const p = cyc[i];
    b.dir[p.r][p.c] = dirBetween(p, cyc[(i + 1) % cyc.length]);
  }
}

/**
 * Riempie le caselle rimaste con frecce "esca": sempre rivolte dentro la
 * griglia, così nessun cammino può uscire dal bordo.
 */
function fillDecoys(rng: Rng, b: Board) {
  for (let r = 0; r < b.R; r++) {
    for (let c = 0; c < b.C; c++) {
      if (b.dir[r][c] !== null) continue;
      const ok = DIRS.filter((d) => inside(b.R, b.C, stepPos({ r, c }, d)));
      b.dir[r][c] = pick(rng, ok);
    }
  }
}

function setStar(b: Board, p: Pos, color: number) {
  b.star[p.r][p.c] = color;
}

function setLand(b: Board, p: Pos, fig: FigInfo, color: number) {
  if (b.star[p.r][p.c] !== null) throw new Error('segnaposto sulla partenza');
  b.land[p.r][p.c] = { shape: fig.shape, color };
}

/** SIMULAZIONE: caselle toccate partendo da `start`, un passo alla volta. */
function trace(b: Board, start: Pos, steps: number, flip: 'none' | 'v' | 'h' = 'none'): Pos[] {
  const out: Pos[] = [start];
  let cur = start;
  for (let i = 0; i < steps; i++) {
    const raw = b.dir[cur.r][cur.c];
    if (raw === null) throw new Error('casella senza freccia');
    const d = flip === 'v' ? VFLIP[raw] : flip === 'h' ? HFLIP[raw] : raw;
    const n = stepPos(cur, d);
    if (!inside(b.R, b.C, n)) return out; // può capitare solo ai cammini "sbagliati" specchiati
    out.push(n);
    cur = n;
  }
  return out;
}

/** dopo quanti passi si tocca `target` (−1 = mai: il cammino gira in tondo altrove) */
function reachStep(b: Board, start: Pos, target: Pos): number {
  const limit = b.R * b.C + 2; // oltre questo il cammino si è già ripetuto
  const tr = trace(b, start, limit);
  for (let i = 0; i < tr.length; i++) if (samePos(tr[i], target)) return i;
  return -1;
}

function countTurns(path: Pos[]): number {
  let turns = 0;
  for (let i = 1; i + 1 < path.length; i++) {
    if (dirBetween(path[i - 1], path[i]) !== dirBetween(path[i], path[i + 1])) turns++;
  }
  return turns;
}

/** "destra → giù → giù" */
function routeWords(path: Pos[]): string {
  const w: string[] = [];
  for (let i = 0; i + 1 < path.length; i++) w.push(DIR_WORD[dirBetween(path[i], path[i + 1])]);
  return w.join(' → ');
}

function toPayload(b: Board, arrowColor: number): { kind: 'cells'; rows: CellSpec[][] } {
  const rows: CellSpec[][] = [];
  for (let r = 0; r < b.R; r++) {
    const row: CellSpec[] = [];
    for (let c = 0; c < b.C; c++) {
      const d = b.dir[r][c];
      if (d === null) throw new Error('casella senza freccia');
      const arrow: ShapeSpec = { shape: 'arrow', rot: d, color: arrowColor, fillMode: 'solid' };
      const star = b.star[r][c];
      const land = b.land[r][c];
      if (star !== null) {
        row.push({
          shapes: [{ shape: 'star', color: star, fillMode: 'solid' }, arrow],
          layout: 'row',
          highlight: true,
        });
      } else if (land) {
        row.push({ shapes: [{ shape: land.shape, color: land.color, fillMode: 'solid' }, arrow], layout: 'row' });
      } else {
        row.push({ shapes: [arrow] });
      }
    }
    rows.push(row);
  }
  return { kind: 'cells', rows };
}

// ---------------------------------------------------------------------------
// costruzione dei percorsi
// ---------------------------------------------------------------------------

interface CarveOpts {
  start?: Pos;
  minTurns?: number;
  /** condizione sull'ultima casella (usata per chiudere gli anelli) */
  endOk?: (last: Pos, path: Pos[]) => boolean;
}

/**
 * Scava un cammino semplice di `steps` passi (steps+1 caselle distinte) che non
 * tocca le caselle già impegnate. Ricerca in profondità con direzioni mescolate:
 * il risultato dipende solo dall'rng.
 */
function carvePath(
  rng: Rng,
  R: number,
  C: number,
  blocked: Set<number>,
  steps: number,
  opts: CarveOpts = {}
): Pos[] | null {
  const minTurns = opts.minTurns ?? 0;
  const starts = opts.start
    ? [opts.start]
    : shuffle(rng, allCells(R, C).filter((p) => !blocked.has(kOf(p)))).slice(0, 10);
  for (const s of starts) {
    if (blocked.has(kOf(s))) continue;
    const path: Pos[] = [s];
    const used = new Set(blocked);
    used.add(kOf(s));
    let budget = 800;
    const dfs = (): boolean => {
      if (path.length === steps + 1) {
        const last = path[path.length - 1];
        return countTurns(path) >= minTurns && (!opts.endOk || opts.endOk(last, path));
      }
      if (budget-- <= 0) return false;
      for (const d of shuffle(rng, [...DIRS])) {
        const n = stepPos(path[path.length - 1], d);
        if (!inside(R, C, n) || used.has(kOf(n))) continue;
        path.push(n);
        used.add(kOf(n));
        if (dfs()) return true;
        path.pop();
        used.delete(kOf(n));
      }
      return false;
    };
    if (dfs()) return path;
  }
  return null;
}

/** anello chiuso di `len` caselle (len pari ≥ 4: nella griglia i cicli sono pari) */
function carveCycle(rng: Rng, R: number, C: number, blocked: Set<number>, len: number): Pos[] | null {
  return carvePath(rng, R, C, blocked, len - 1, { endOk: (last, path) => adjacent(last, path[0]) });
}

/**
 * Corridoio di `tailLen` caselle che sbocca in una casella dell'anello: prova
 * tutti i punti d'ingresso finché ce n'è uno con spazio libero attorno.
 */
function carveTail(
  rng: Rng,
  R: number,
  C: number,
  reserved: Set<number>,
  cyc: Pos[],
  tailLen: number
): { entry: number; tail: Pos[] } | null {
  for (const entry of shuffle(rng, cyc.map((_, i) => i))) {
    const qe = cyc[entry];
    const back = carvePath(rng, R, C, without(reserved, qe), tailLen, { start: qe });
    if (back) return { entry, tail: [...back].reverse().slice(0, tailLen) };
  }
  return null;
}

/**
 * Due cammini distinti che finiscono sulla stessa casella bersaglio (le due
 * stelle che gareggiano). Prova più bersagli prima di arrendersi.
 */
function carveTwoPaths(
  rng: Rng,
  R: number,
  C: number,
  reserved: Set<number>,
  lenA: number,
  lenB: number
): { target: Pos; pathA: Pos[]; pathB: Pos[] } | null {
  const targets = shuffle(rng, allCells(R, C).filter((p) => !reserved.has(kOf(p)))).slice(0, 8);
  for (const target of targets) {
    const backA = carvePath(rng, R, C, reserved, lenA, { start: target });
    if (!backA) continue;
    const res2 = new Set(reserved);
    reserve(res2, backA);
    res2.delete(kOf(target));
    const backB = carvePath(rng, R, C, res2, lenB, { start: target });
    if (!backB) continue;
    reserve(reserved, backA);
    reserve(reserved, backB);
    return { target, pathA: [...backA].reverse(), pathB: [...backB].reverse() };
  }
  return null;
}

function reserve(set: Set<number>, cells: Pos[]) {
  for (const p of cells) set.add(kOf(p));
}

function without(set: Set<number>, p: Pos): Set<number> {
  const out = new Set(set);
  out.delete(kOf(p));
  return out;
}

/**
 * Struttura "ρ": una coda che entra in un anello. È il cuore delle domande di
 * difficoltà 3: dopo `tail` passi si entra nell'anello e si gira per sempre.
 */
interface Rho {
  b: Board;
  cyc: Pos[];
  /** indice dell'anello in cui si entra */
  entry: number;
  /** caselle della coda, dalla stella alla casella che entra nell'anello */
  tail: Pos[];
  start: Pos;
  reserved: Set<number>;
}

function buildRho(rng: Rng, R: number, C: number, len: number, tailLen: number): Rho {
  const reserved = new Set<number>();
  const cyc = carveCycle(rng, R, C, reserved, len);
  if (!cyc) throw new Error('anello non trovato');
  const b = newBoard(R, C);
  layCycle(b, cyc);
  reserve(reserved, cyc);
  const t = carveTail(rng, R, C, reserved, cyc, tailLen);
  if (!t) throw new Error('coda non trovata');
  layPath(b, [...t.tail, cyc[t.entry]]);
  reserve(reserved, t.tail);
  return { b, cyc, entry: t.entry, tail: t.tail, start: t.tail[0], reserved };
}

// ---------------------------------------------------------------------------
// varianti
// ---------------------------------------------------------------------------

interface Cand {
  pos: Pos;
  /** come si spiega l'errore di chi la sceglie */
  why: string;
}

/** "dove ti fermi dopo N passi?" — i segnaposto marcano arrivo ed errori tipici */
function genLanding(rng: Rng, difficulty: Difficulty, R: number, C: number, len: number): Question {
  const blocked = new Set<number>();
  // un passo in più del necessario: serve la casella "una avanti" come esca
  const path = carvePath(rng, R, C, blocked, len + 1, { minTurns: difficulty === 1 ? 1 : 2 });
  if (!path) throw new Error('percorso non trovato');
  const b = newBoard(R, C);
  layPath(b, path);
  const start = path[0];
  const starColor = pick(rng, STAR_COLORS);
  setStar(b, start, starColor);
  fillDecoys(rng, b);

  const tr = trace(b, start, len + 1);
  if (tr.length !== len + 2) throw new Error('cammino uscito dalla griglia');
  const end = tr[len];
  if (!samePos(end, path[len])) throw new Error('simulazione incoerente');

  const cands: Cand[] = [
    { pos: tr[len + 1], why: `è una casella più avanti: ci si arriva con ${passi(len + 1)}` },
    { pos: tr[len - 1], why: `è una casella indietro: sono solo ${passi(len - 1)}` },
    { pos: trace(b, start, len, 'v').slice(-1)[0], why: 'è dove si finisce scambiando su e giù' },
    { pos: trace(b, start, len, 'h').slice(-1)[0], why: 'è dove si finisce scambiando destra e sinistra' },
  ];
  const chosen: Cand[] = [];
  for (const cand of shuffle(rng, cands)) {
    if (samePos(cand.pos, end) || samePos(cand.pos, start)) continue;
    if (chosen.some((x) => samePos(x.pos, cand.pos))) continue;
    chosen.push(cand);
    if (chosen.length === 2) break;
  }
  if (chosen.length < 2) throw new Error('distrattori non piazzabili');

  const figs = pickN(rng, FIGS, 3);
  const cols = pickN(rng, FIG_COLORS.filter((c) => c !== starColor), 3);
  setLand(b, end, figs[0], cols[0]);
  setLand(b, chosen[0].pos, figs[1], cols[1]);
  setLand(b, chosen[1].pos, figs[2], cols[2]);

  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: figs[0].name }, [
    { kind: 'text', text: figs[1].name },
    { kind: 'text', text: figs[2].name },
  ]);
  return {
    qtype: 'paths',
    difficulty,
    prompt: `Parti dalla stella e fai ${len} passi seguendo le frecce: su quale figura ti fermi?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `Le frecce dicono: ${routeWords(tr.slice(0, len + 1))}. Dopo ${passi(len)} ti fermi ${figs[0].sul}. ` +
      `Attenzione: ${figs[1].il} ${chosen[0].why}; ${figs[2].il} ${chosen[1].why}.`,
  };
}

/** "quanti passi per arrivare al cuore?" */
function genCount(rng: Rng, difficulty: Difficulty, R: number, C: number, len: number, decoys: number): Question {
  const blocked = new Set<number>();
  const path = carvePath(rng, R, C, blocked, len, { minTurns: difficulty === 1 ? 1 : 2 });
  if (!path) throw new Error('percorso non trovato');
  const b = newBoard(R, C);
  layPath(b, path);
  const start = path[0];
  const target = path[len];
  const starColor = pick(rng, STAR_COLORS);
  setStar(b, start, starColor);

  const figs = pickN(rng, FIGS, 1 + decoys);
  const cols = pickN(rng, FIG_COLORS.filter((c) => c !== starColor), 1 + decoys);
  setLand(b, target, figs[0], cols[0]);
  // segnaposto esca: caselle libere fuori dal percorso, per non regalare l'arrivo
  const free = shuffle(rng, allCells(R, C)).filter(
    (p) => !path.some((q) => samePos(q, p)) && !samePos(p, start)
  );
  for (let i = 0; i < decoys; i++) {
    if (!free[i]) throw new Error('niente spazio per le esche');
    setLand(b, free[i], figs[i + 1], cols[i + 1]);
  }
  fillDecoys(rng, b);

  const steps = reachStep(b, start, target);
  if (steps !== len) throw new Error('simulazione incoerente');

  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(len) }, [
    { kind: 'text', text: String(len + 1) }, // conta le caselle invece dei passi
    { kind: 'text', text: String(len - 1) }, // ne perde uno per strada
  ]);
  return {
    qtype: 'paths',
    difficulty,
    prompt: `Parti dalla stella e segui le frecce: quanti passi servono per arrivare ${figs[0].al}?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `Il percorso dalla stella ${figs[0].al} è: ${routeWords(path)}. Sono ${len} frecce, quindi ${passi(len)}. ` +
      `Le caselle toccate sono ${len + 1}: i passi sono sempre uno in meno delle caselle.`,
  };
}

/** "quante volte cambi direzione?" */
function genTurns(rng: Rng, difficulty: Difficulty, R: number, C: number, len: number): Question {
  const blocked = new Set<number>();
  const path = carvePath(rng, R, C, blocked, len, { minTurns: 1 });
  if (!path) throw new Error('percorso non trovato');
  const b = newBoard(R, C);
  layPath(b, path);
  const start = path[0];
  const target = path[len];
  const starColor = pick(rng, STAR_COLORS);
  setStar(b, start, starColor);
  const fig = pickTarget(rng);
  setLand(b, target, fig, pick(rng, FIG_COLORS.filter((c) => c !== starColor)));
  fillDecoys(rng, b);
  if (reachStep(b, start, target) !== len) throw new Error('simulazione incoerente');

  const turns = countTurns(path);
  const wrongs: number[] = [];
  for (const w of [turns + 1, len, turns - 1, len + 1]) {
    if (w === turns || w < 0 || wrongs.includes(w)) continue;
    wrongs.push(w);
    if (wrongs.length === 2) break;
  }
  if (wrongs.length < 2) throw new Error('distrattori non costruibili');

  // racconto dei cambi di direzione
  const changes: string[] = [];
  for (let i = 1; i + 1 < path.length; i++) {
    const a = dirBetween(path[i - 1], path[i]);
    const c2 = dirBetween(path[i], path[i + 1]);
    if (a !== c2) changes.push(`da ${DIR_WORD[a]} a ${DIR_WORD[c2]}`);
  }
  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(turns) }, [
    { kind: 'text', text: String(wrongs[0]) },
    { kind: 'text', text: String(wrongs[1]) },
  ]);
  return {
    qtype: 'paths',
    difficulty,
    prompt: `Vai dalla stella ${fig.al} seguendo le frecce: quante volte cambi direzione?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `Il percorso è: ${routeWords(path)} — ${passi(len)} in tutto. I cambi di direzione sono ${turns}: ${changes.join('; ')}. ` +
      `Attenzione a non confondere i passi (${len}) con le curve (${turns}): si gira solo quando la freccia nuova punta da un'altra parte.`,
  };
}

/** "in che direzione fai l'ultimo passo?" */
function genLastDir(rng: Rng, difficulty: Difficulty, R: number, C: number, len: number): Question {
  const blocked = new Set<number>();
  const path = carvePath(rng, R, C, blocked, len, { minTurns: 1 });
  if (!path) throw new Error('percorso non trovato');
  const b = newBoard(R, C);
  layPath(b, path);
  const start = path[0];
  const target = path[len];
  const starColor = pick(rng, STAR_COLORS);
  setStar(b, start, starColor);
  const fig = pickTarget(rng);
  setLand(b, target, fig, pick(rng, FIG_COLORS.filter((c) => c !== starColor)));
  fillDecoys(rng, b);
  if (reachStep(b, start, target) !== len) throw new Error('simulazione incoerente');

  const last = dirBetween(path[len - 1], path[len]);
  const first = dirBetween(path[0], path[1]);
  const wrongs: Dir[] = [];
  for (const d of [OPPOSITE[last], first, ...shuffle(rng, [...DIRS])]) {
    if (d === last || wrongs.includes(d)) continue;
    wrongs.push(d);
    if (wrongs.length === 2) break;
  }
  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: DIR_CHOICE[last] }, [
    { kind: 'text', text: DIR_CHOICE[wrongs[0]] },
    { kind: 'text', text: DIR_CHOICE[wrongs[1]] },
  ]);
  return {
    qtype: 'paths',
    difficulty,
    prompt: `Vai dalla stella ${fig.al} seguendo le frecce: in che direzione fai l'ultimo passo?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `Il percorso è: ${routeWords(path)}. L'ultimo passo, quello che ti porta ${fig.sul}, va ${DIR_CHOICE[last]}. ` +
      `Non basta guardare le frecce vicine alla figura: conta solo quella della casella da cui arrivi.`,
  };
}

/** "quale stella arriva al cuore?" — le altre due finiscono in un girotondo */
function genWhichStar(rng: Rng, difficulty: Difficulty, R: number, C: number, len: number): Question {
  const loopLen = pick(rng, [4, 6]);
  const reserved = new Set<number>();
  const cyc = carveCycle(rng, R, C, reserved, loopLen);
  if (!cyc) throw new Error('anello non trovato');
  const b = newBoard(R, C);
  layCycle(b, cyc);
  reserve(reserved, cyc);

  // due stelle che cadono nell'anello
  const lost: Pos[] = [];
  for (let i = 0; i < 2; i++) {
    const t = carveTail(rng, R, C, reserved, cyc, randInt(rng, 1, 2));
    if (!t) throw new Error('coda non trovata');
    layPath(b, [...t.tail, cyc[t.entry]]);
    reserve(reserved, t.tail);
    lost.push(t.tail[0]);
  }
  // la stella buona: percorso che arriva al bersaglio
  const good = carvePath(rng, R, C, reserved, len, { minTurns: 1 });
  if (!good) throw new Error('percorso non trovato');
  layPath(b, good);
  reserve(reserved, good);
  const target = good[len];
  const cols = pickN(rng, STAR_COLORS, 3);
  setStar(b, good[0], cols[0]);
  setStar(b, lost[0], cols[1]);
  setStar(b, lost[1], cols[2]);
  const fig = pickTarget(rng);
  setLand(b, target, fig, pick(rng, FIG_COLORS.filter((c) => !cols.includes(c))));
  fillDecoys(rng, b);

  // simulazione: solo la prima stella tocca il bersaglio
  if (reachStep(b, good[0], target) !== len) throw new Error('simulazione incoerente');
  if (reachStep(b, lost[0], target) !== -1 || reachStep(b, lost[1], target) !== -1) {
    throw new Error('anche le altre stelle arrivano');
  }

  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: starLabel(cols[0]) }, [
    { kind: 'text', text: starLabel(cols[1]) },
    { kind: 'text', text: starLabel(cols[2]) },
  ]);
  return {
    qtype: 'paths',
    difficulty,
    prompt: `Ogni stella segue le frecce dalla sua casella: quale stella arriva ${fig.al}?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `La ${starLabel(cols[0])} fa ${routeWords(good)} e in ${passi(len)} arriva ${fig.sul}. ` +
      `Le altre due finiscono nello stesso anello di ${caselle(loopLen)} e continuano a girare in tondo: ` +
      `da lì le frecce non portano più ${fig.al}.`,
  };
}

/** "dopo quanti passi torni sulla stella?" — la stella sta su un anello chiuso */
function genLoopBack(rng: Rng, difficulty: Difficulty, R: number, C: number): Question {
  const loopLen = pick(rng, [4, 6, 8]);
  const reserved = new Set<number>();
  const cyc = carveCycle(rng, R, C, reserved, loopLen);
  if (!cyc) throw new Error('anello non trovato');
  const b = newBoard(R, C);
  layCycle(b, cyc);
  reserve(reserved, cyc);
  const start = cyc[randInt(rng, 0, loopLen - 1)];
  const starColor = pick(rng, STAR_COLORS);
  setStar(b, start, starColor);
  // un segnaposto sull'anello: aiuta a "contare i giri" e rende la griglia parlante
  const figPos = cyc[(cyc.indexOf(start) + randInt(rng, 1, loopLen - 1)) % loopLen];
  const fig = pickTarget(rng);
  setLand(b, figPos, fig, pick(rng, FIG_COLORS.filter((c) => c !== starColor)));
  fillDecoys(rng, b);

  const tr = trace(b, start, loopLen);
  if (tr.length !== loopLen + 1 || !samePos(tr[loopLen], start)) throw new Error('anello non chiuso');
  for (let i = 1; i < loopLen; i++) if (samePos(tr[i], start)) throw new Error('anello più corto');

  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(loopLen) }, [
    { kind: 'text', text: String(loopLen - 1) }, // conta le caselle diverse dalla partenza
    { kind: 'text', text: String(loopLen + 1) }, // conta la partenza due volte
  ]);
  return {
    qtype: 'paths',
    difficulty,
    prompt: 'Parti dalla stella e segui le frecce: dopo quanti passi torni sulla casella della stella?',
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `Le frecce formano un anello chiuso: ${routeWords(tr)}. L'anello ha ${caselle(loopLen)}, ` +
      `quindi servono esattamente ${passi(loopLen)} per tornare al punto di partenza: l'ultimo passo rientra sulla stella. ` +
      `Le caselle da attraversare prima di rivedere la stella sono ${loopLen - 1}, ma i passi sono ${loopLen}.`,
  };
}

/** d3: "quale stella arriva prima?" — due percorsi verso lo stesso bersaglio */
function genRace(rng: Rng, R: number, C: number): Question {
  const lenA = randInt(rng, 3, 5);
  const tie = chance(rng, 0.3);
  const lenB = tie ? lenA : lenA + pick(rng, [1, 2]);
  const reserved = new Set<number>();
  const two = carveTwoPaths(rng, R, C, reserved, lenA, lenB);
  if (!two) throw new Error('percorsi non trovati');
  const { target, pathA, pathB } = two;
  const b = newBoard(R, C);
  layPath(b, pathA);
  layPath(b, pathB);
  const cols = pickN(rng, STAR_COLORS, 2);
  setStar(b, pathA[0], cols[0]);
  setStar(b, pathB[0], cols[1]);
  const fig = pickTarget(rng);
  setLand(b, target, fig, pick(rng, FIG_COLORS.filter((c) => !cols.includes(c))));
  fillDecoys(rng, b);

  const sA = reachStep(b, pathA[0], target);
  const sB = reachStep(b, pathB[0], target);
  if (sA !== lenA || sB !== lenB) throw new Error('simulazione incoerente');

  const correct: string = tie ? 'arrivano insieme' : starLabel(sA < sB ? cols[0] : cols[1]);
  const others = tie
    ? [starLabel(cols[0]), starLabel(cols[1])]
    : [starLabel(sA < sB ? cols[1] : cols[0]), 'arrivano insieme'];
  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: correct }, [
    { kind: 'text', text: others[0] },
    { kind: 'text', text: others[1] },
  ]);
  return {
    qtype: 'paths',
    difficulty: 3,
    prompt: `Le due stelle partono insieme e seguono le frecce: quale arriva prima ${fig.al}?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `La ${starLabel(cols[0])} fa ${routeWords(pathA)}: ${passi(sA)}. ` +
      `La ${starLabel(cols[1])} fa ${routeWords(pathB)}: ${passi(sB)}. ` +
      (tie
        ? `Stesso numero di passi: arrivano insieme. Non conta chi sembra più vicina in linea d'aria, ma quante frecce servono.`
        : `Vince chi fa meno passi: la ${starLabel(sA < sB ? cols[0] : cols[1])}.`),
  };
}

/** d3: "dove ti fermi dopo K passi?" con K grande — serve il resto della divisione */
function genCycleLanding(rng: Rng, R: number, C: number): Question {
  const loopLen = pick(rng, [4, 6, 8]);
  const tailLen = randInt(rng, 1, Math.min(3, loopLen - 1));
  const { b, cyc, entry, start } = buildRho(rng, R, C, loopLen, tailLen);
  const starColor = pick(rng, STAR_COLORS);
  setStar(b, start, starColor);
  fillDecoys(rng, b);

  const total = tailLen + loopLen + randInt(rng, 1, loopLen); // almeno un giro completo
  const tr = trace(b, start, total + 1);
  if (tr.length !== total + 2) throw new Error('cammino uscito dalla griglia');
  const end = tr[total];
  const rest = (total - tailLen) % loopLen;
  if (!samePos(end, cyc[(entry + rest) % loopLen])) throw new Error('simulazione incoerente');

  const cands: Cand[] = [
    {
      pos: cyc[(entry + (total % loopLen)) % loopLen],
      why: `è dove finisce chi dimentica ${tailLen === 1 ? 'il passo' : `i ${tailLen} passi`} del corridoio e divide subito ${total} per ${loopLen}`,
    },
    { pos: tr[total + 1], why: 'è una casella più avanti nel girotondo' },
    { pos: tr[total - 1], why: 'è una casella indietro nel girotondo' },
  ];
  const chosen: Cand[] = [];
  for (const cand of cands) {
    if (samePos(cand.pos, end) || samePos(cand.pos, start)) continue;
    if (chosen.some((x) => samePos(x.pos, cand.pos))) continue;
    chosen.push(cand);
    if (chosen.length === 2) break;
  }
  if (chosen.length < 2) throw new Error('distrattori non piazzabili');

  const figs = pickN(rng, FIGS, 3);
  const cols = pickN(rng, FIG_COLORS.filter((c) => c !== starColor), 3);
  setLand(b, end, figs[0], cols[0]);
  setLand(b, chosen[0].pos, figs[1], cols[1]);
  setLand(b, chosen[1].pos, figs[2], cols[2]);

  const laps = Math.floor((total - tailLen) / loopLen);
  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: figs[0].name }, [
    { kind: 'text', text: figs[1].name },
    { kind: 'text', text: figs[2].name },
  ]);
  return {
    qtype: 'paths',
    difficulty: 3,
    prompt: `Parti dalla stella e fai ${total} passi seguendo le frecce: su quale figura ti fermi?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `Non serve contare tutti i ${total} passi. ` +
      `${tailLen === 1 ? 'Il primo passo ti porta' : `I primi ${tailLen} passi ti portano`} dentro un girotondo di ${caselle(loopLen)}; ` +
      `restano ${total} − ${tailLen} = ${total - tailLen} passi da fare girando. ` +
      `${total - tailLen} : ${loopLen} fa ${laps} ${laps === 1 ? 'giro' : 'giri'} con resto ${rest}, ` +
      (rest === 0
        ? `quindi ti fermi proprio sulla casella da cui eri entrato nel girotondo: ${figs[0].sul}.`
        : `quindi ti fermi ${caselle(rest)} dopo l'ingresso: ${figs[0].sul}.`) +
      ` Invece ${figs[1].il} ${chosen[0].why}.`,
  };
}

/** d3: "quale stella gira in tondo per sempre?" — due arrivano, una no */
function genCycleStar(rng: Rng, R: number, C: number): Question {
  const loopLen = pick(rng, [4, 6]);
  const tailLen = randInt(rng, 1, 2);
  const { b, tail, start, reserved } = buildRho(rng, R, C, loopLen, tailLen);

  const lenA = randInt(rng, 2, 3);
  const lenB = randInt(rng, 2, 3);
  const two = carveTwoPaths(rng, R, C, reserved, lenA, lenB);
  if (!two) throw new Error('percorsi non trovati');
  const { target, pathA, pathB } = two;
  layPath(b, pathA);
  layPath(b, pathB);

  const cols = pickN(rng, STAR_COLORS, 3);
  setStar(b, start, cols[0]);
  setStar(b, pathA[0], cols[1]);
  setStar(b, pathB[0], cols[2]);
  const fig = pickTarget(rng);
  setLand(b, target, fig, pick(rng, FIG_COLORS.filter((c) => !cols.includes(c))));
  fillDecoys(rng, b);

  if (reachStep(b, start, target) !== -1) throw new Error('anche la stella persa arriva');
  if (reachStep(b, pathA[0], target) !== lenA || reachStep(b, pathB[0], target) !== lenB) {
    throw new Error('simulazione incoerente');
  }

  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: starLabel(cols[0]) }, [
    { kind: 'text', text: starLabel(cols[1]) },
    { kind: 'text', text: starLabel(cols[2]) },
  ]);
  return {
    qtype: 'paths',
    difficulty: 3,
    prompt: `Una stella gira in tondo per sempre: quale stella non arriverà mai ${fig.al}?`,
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `La ${starLabel(cols[0])} parte (${routeWords([...tail, trace(b, tail[tail.length - 1], 1)[1]])}) ed entra in un anello di ` +
      `${caselle(loopLen)}: da lì le frecce la fanno girare sempre sulle stesse caselle, non ne esce più. ` +
      `La ${starLabel(cols[1])} arriva ${fig.sul} in ${passi(lenA)} e la ${starLabel(cols[2])} in ${passi(lenB)}. ` +
      `Il trucco è accorgersi che un gruppo di frecce si richiude su sé stesso.`,
  };
}

/** d3: "da quante caselle è fatto il girotondo?" */
function genCycleLen(rng: Rng, R: number, C: number): Question {
  const loopLen = pick(rng, [4, 6, 8]);
  const tailLen = randInt(rng, 2, 3);
  const { b, cyc, tail, start } = buildRho(rng, R, C, loopLen, tailLen);
  const starColor = pick(rng, STAR_COLORS);
  setStar(b, start, starColor);
  const fig = pickTarget(rng);
  setLand(b, cyc[randInt(rng, 0, loopLen - 1)], fig, pick(rng, FIG_COLORS.filter((c) => c !== starColor)));
  fillDecoys(rng, b);

  // verifica per simulazione: dopo la coda si ripassa sulle stesse caselle
  const tr = trace(b, start, tailLen + 2 * loopLen);
  const inLoop = tr[tailLen];
  const back = tr.findIndex((p, i) => i > tailLen && samePos(p, inLoop));
  if (back - tailLen !== loopLen) throw new Error('anello incoerente');

  const wrongs: number[] = [];
  for (const w of [loopLen + 1, tailLen + loopLen, loopLen - 1, loopLen + 2]) {
    if (w === loopLen || w < 2 || wrongs.includes(w)) continue;
    wrongs.push(w);
    if (wrongs.length === 2) break;
  }
  const arrowColor = pick(rng, ARROW_COLORS);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(loopLen) }, [
    { kind: 'text', text: String(wrongs[0]) },
    { kind: 'text', text: String(wrongs[1]) },
  ]);
  return {
    qtype: 'paths',
    difficulty: 3,
    prompt: 'Parti dalla stella e segui le frecce: finisci in un girotondo. Da quante caselle è fatto?',
    payload: toPayload(b, arrowColor),
    choices,
    correctIndex,
    explanation:
      `I primi ${passi(tailLen)} (${routeWords([...tail, tr[tailLen]])}) sono solo il corridoio d'ingresso: ` +
      `su quelle caselle non ripassi più. Dalla casella d'ingresso le frecce ti riportano allo stesso punto ` +
      `dopo ${passi(loopLen)}, quindi il girotondo è fatto di ${caselle(loopLen)}. ` +
      `Le caselle toccate in tutto sono ${tailLen + loopLen}, ma il corridoio non fa parte del giro.`,
  };
}

// ---------------------------------------------------------------------------
// selezione della variante
// ---------------------------------------------------------------------------

export function genPaths(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    if (difficulty === 1) {
      switch (randInt(rng, 0, 3)) {
        case 0:
          return genLanding(rng, 1, 3, 3, randInt(rng, 2, 3));
        case 1:
          return genCount(rng, 1, 3, 3, randInt(rng, 2, 4), 0);
        case 2:
          return genTurns(rng, 1, 3, 3, randInt(rng, 3, 4));
        default:
          return genLastDir(rng, 1, 3, 3, randInt(rng, 2, 3));
      }
    }
    if (difficulty === 2) {
      switch (randInt(rng, 0, 3)) {
        case 0:
          return genCount(rng, 2, 4, 4, randInt(rng, 4, 6), 1);
        case 1:
          return genLanding(rng, 2, 4, 4, randInt(rng, 4, 5));
        case 2:
          return genWhichStar(rng, 2, 4, 4, randInt(rng, 3, 4));
        default:
          return genLoopBack(rng, 2, 4, 4);
      }
    }
    const [R, C] = pick(rng, [
      [4, 4],
      [4, 5],
    ] as const);
    switch (randInt(rng, 0, 3)) {
      case 0:
        return genRace(rng, R, C);
      case 1:
        return genCycleLanding(rng, R, C);
      case 2:
        return genCycleStar(rng, R, C);
      default:
        return genCycleLen(rng, R, C);
    }
  }, 60);
}
