// Tipi condivisi di QuickSmart: linguaggio visuale delle domande + stato di gioco.
// Il payload delle domande è dichiarativo: il client lo renderizza in SVG.

export type Difficulty = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Linguaggio visuale
// ---------------------------------------------------------------------------

export type ShapeName =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'pentagon'
  | 'hexagon'
  | 'arrow'
  | 'heart'
  | 'cross'
  | 'moon'
  | 'dot';

export interface ShapeSpec {
  shape: ShapeName;
  /** rotazione in gradi, senso orario */
  rot?: number;
  /** dimensione relativa 0.2..1 (default 0.8) */
  size?: number;
  /** indice nella palette colori 0..7 */
  color?: number;
  fillMode?: 'solid' | 'outline' | 'half';
  /** specchiato orizzontalmente */
  flip?: boolean;
}

/** Una cella contiene una piccola composizione di forme (o un "?") */
export interface CellSpec {
  shapes: ShapeSpec[];
  /** com'è disposto il contenuto della cella (default 'auto': 1 centrata, più forme in griglia) */
  layout?: 'auto' | 'row' | 'grid';
  /** cella incognita: renderizzata come "?" */
  unknown?: boolean;
  highlight?: boolean;
  /**
   * Linea di piega disegnata sopra la cella: 'V' verticale, 'H' orizzontale,
   * 'D' diagonale ↘, 'A' antidiagonale ↗. Serve al tipo "foglio piegato":
   * senza vedere dove passa la piega il quesito è indecifrabile.
   */
  crease?: 'V' | 'H' | 'D' | 'A';
  /** parte di foglio ripiegata via: disegnata in grigio smorzato */
  dim?: boolean;
  /** etichetta sopra la cella (es. "Gruppo 1") */
  label?: string;
}

/** Una tessera del domino: due metà con i pallini */
export interface DominoTile {
  a: number;
  b: number;
  unknown?: boolean;
  highlight?: boolean;
}

export interface ClockSpec {
  h: number; // 0..11
  m: number; // 0..59
  /** renderizzato specchiato orizzontalmente (orologio allo specchio) */
  mirrored?: boolean;
  unknown?: boolean;
  label?: string;
}

export interface CountedShapes {
  shape: ShapeName;
  color: number;
  count: number;
}

export type VisualPayload =
  /** griglie/righe di celle: sequence (1×n), matrix (3×3), analogy (A:B :: C:?), oddone (riga unica) */
  | {
      kind: 'cells';
      rows: CellSpec[][];
      /** frecce tra le celle (per le sequenze) */
      arrows?: boolean;
      /** modalità analogia: separatori "→" e "∶" tra le coppie */
      analogy?: boolean;
      /** le righe sono gruppi distinti, incorniciati e separati */
      groups?: boolean;
      /**
       * Le righe sono la continuazione di un'unica sequenza: il renderer
       * disegna una freccia di continuazione a fine riga, così la catena si
       * legge come tale anche quando va a capo.
       */
      wrapSequence?: boolean;
    }
  /** fila di tessere del domino, disegnate con i pallini */
  | { kind: 'dominoes'; tiles: DominoTile[] }
  /** serie numerica con incognita ('?') */
  | { kind: 'numbers'; seq: (number | string)[] }
  /** uno o più orologi analogici */
  | { kind: 'clock'; clocks: ClockSpec[] }
  /** pila di cubi isometrica: grid[riga][colonna] = altezza colonna (vista dal davanti-alto) */
  | { kind: 'dicestack'; grid: number[][] }
  /** sviluppo (croce) di un dado: 12 celle 4×3, null = vuoto, numero = pip della faccia */
  | { kind: 'dicenet'; net: (number | null)[][] }
  /** bilance a due piatti; tilt: -1 pende a sinistra, 0 equilibrio, 1 pende a destra */
  | {
      kind: 'balance';
      scales: { left: CountedShapes[]; right: CountedShapes[]; tilt: -1 | 0 | 1 }[];
    }
  /** sistema di equazioni con simboli: ogni riga è [forma, op, forma, ...] = risultato */
  | {
      kind: 'equation';
      rows: { items: (ShapeSpec | string)[]; result: number | string }[];
    };

export type ChoiceVisual =
  | { kind: 'cell'; cell: CellSpec }
  | { kind: 'text'; text: string }
  | { kind: 'clock'; clock: ClockSpec }
  | { kind: 'domino'; tile: DominoTile };

// ---------------------------------------------------------------------------
// Domande
// ---------------------------------------------------------------------------

export type QuestionType =
  | 'sequence'
  | 'matrix'
  | 'oddone'
  | 'numseries'
  | 'rotation'
  | 'dice'
  | 'clock'
  | 'balance'
  | 'analogy'
  | 'arithgrid'
  | 'fold'
  | 'paths'
  | 'sets'
  | 'mirror'
  | 'domino'
  | 'symmetry'
  | 'weights'
  | 'pattern';

export interface Question {
  id?: number;
  qtype: QuestionType;
  difficulty: Difficulty;
  /** testo della domanda (es. "Quale figura completa la sequenza?") */
  prompt: string;
  payload: VisualPayload;
  /** esattamente 3 opzioni, di cui 2 distrattori "vicini" */
  choices: ChoiceVisual[];
  correctIndex: 0 | 1 | 2;
  /** spiegazione mostrata al reveal */
  explanation: string;
  hash?: string;
}

/** Contratto di ogni generatore procedurale */
export type QuestionGenerator = (rng: () => number, difficulty: Difficulty) => Question;

// ---------------------------------------------------------------------------
// Partita
// ---------------------------------------------------------------------------

export type GameMode = 'team' | 'solo';

export interface GameSettings {
  mode: GameMode;
  /** null = partita aperta (termina l'host) */
  roundsTotal: number | null;
  /** finestra di prenotazione (team) o timer di decisione (solo) */
  buzzWindowMs: number;
  /** tempo per scegliere la risposta dopo il buzz */
  answerMs: number;
  /** durata della schermata di reveal */
  revealMs: number;
}

export type GameStatus = 'lobby' | 'playing' | 'ended';
export type Phase = 'idle' | 'countdown' | 'buzz' | 'answer' | 'reveal';

/** round speciali: 'twin' = gemella (trappola per chi va a memoria), 'lampo' = tempo dimezzato e punti doppi */
export type SpecialRound = 'none' | 'twin' | 'lampo';

export type RoundOutcome =
  | 'correct'   // qualcuno ha indovinato
  | 'exhausted' // tutti hanno sbagliato
  | 'nobody'    // nessuno si è prenotato
  | 'timeout';  // (solo) tempo di decisione scaduto

export interface PlayerStats {
  correct: number;
  wrong: number;
  buzzWins: number;
  noAnswer: number;
  bestStreak: number;
  answerTimeMsSum: number;
  answerCount: number;
}

export interface PlayerPublic {
  id: string;
  nickname: string;
  avatar: string;
  isHost: boolean;
  score: number;
  streak: number;
  connected: boolean;
  /** variazione punti nell'ultimo round (per l'animazione) */
  lastDelta: number;
  stats: PlayerStats;
  /** round in cui è entrato a partita in corso (-1 se era già in lobby) */
  joinedAtRound: number;
}

export type SofiaMood = 'happy' | 'wow' | 'teasing' | 'thinking' | 'sad';

export interface SofiaComment {
  text: string;
  mood: SofiaMood;
  roundIndex: number;
  /** true se generato dall'AI (altrimenti battuta pre-scritta) */
  ai: boolean;
  seq: number;
}

/** Snapshot sanitizzato inviato ai client via SSE */
export interface GameSnapshot {
  code: string;
  name: string;
  mode: GameMode;
  settings: GameSettings;
  status: GameStatus;
  phase: Phase;
  roundIndex: number;
  players: PlayerPublic[];
  serverNow: number;
  version: number;
  sofia: SofiaComment | null;
  joinUrl?: string;
  current: null | {
    qtype: QuestionType;
    difficulty: Difficulty;
    prompt: string;
    payload: VisualPayload;
    choices: ChoiceVisual[];
    /** valore attuale della domanda (dopo eventuali decay) */
    value: number;
    countdownEndsAt?: number;
    buzzDeadline?: number;
    answerDeadline?: number;
    buzzerId?: string;
    lockedOut: string[];
    /** risposte sbagliate finora in questo round (>0 = domanda riaperta) */
    errors: number;
    special: SpecialRound;
    /** presenti solo in fase reveal */
    revealUntil?: number;
    correctIndex?: number;
    explanation?: string;
    outcome?: RoundOutcome;
    /** indice scelto da chi ha risposto (per il reveal) */
    answeredIndex?: number;
  };
}
