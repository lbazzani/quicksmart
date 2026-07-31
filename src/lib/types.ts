// Tipi condivisi di QuickSmart: linguaggio visuale delle domande + stato di gioco.
// Il payload delle domande è dichiarativo: il client lo renderizza in SVG.

export type Difficulty = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Lingua
// ---------------------------------------------------------------------------

/** lingue supportate dall'interfaccia E dal contenuto delle domande */
export type LangCode = 'it' | 'en';

/**
 * Testo di una domanda (o di SofAI) in tutte le lingue supportate. Ogni
 * giocatore vede la propria: le domande sono generate UNA volta sola (stessa
 * struttura, stessi distrattori, stessa risposta per tutti in stanza) e
 * portano con sé entrambe le lingue: a scegliere quale mostrare è il client,
 * con la lingua già in uso per l'interfaccia (vedi src/lib/lang.tsx).
 */
export type LocalizedText = Record<LangCode, string>;

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
  label?: LocalizedText;
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
  label?: LocalizedText;
}

export interface CountedShapes {
  shape: ShapeName;
  color: number;
  count: number;
}

/** colori standard delle bandiere: una palette a parte da PALETTE (che è tarata per i puzzle, non per il vessillo) */
export type FlagColorName = 'red' | 'white' | 'blue' | 'lightblue' | 'green' | 'yellow' | 'black' | 'orange';

/**
 * Una bandiera nazionale semplificata: bande piatte, un disco centrato o una
 * croce nordica (spostata verso l'asta, mai al centro — altrimenti Norvegia e
 * Danimarca diventerebbero un'unica croce greca sbagliata). Tre schemi che il
 * renderer sa disegnare senza inventare emblemi che non ci sono (vedi
 * src/lib/questions/flagsdata.ts per il perché di questo limite).
 */
export type FlagSpec =
  | { kind: 'bands'; dir: 'h' | 'v'; colors: FlagColorName[] }
  | { kind: 'disc'; field: FlagColorName; disc: FlagColorName }
  | { kind: 'cross'; field: FlagColorName; cross: FlagColorName; fimbriation?: FlagColorName };

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
    }
  /** una bandiera nazionale (vedi FlagSpec) */
  | { kind: 'flag'; flag: FlagSpec };

export type ChoiceVisual =
  | { kind: 'cell'; cell: CellSpec }
  | { kind: 'text'; text: LocalizedText }
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
  | 'pattern'
  | 'majority'
  | 'pairs'
  | 'flags';

export interface Question {
  id?: number;
  qtype: QuestionType;
  difficulty: Difficulty;
  /** testo della domanda (es. "Quale figura completa la sequenza?"), in ogni lingua */
  prompt: LocalizedText;
  payload: VisualPayload;
  /** esattamente 3 opzioni, di cui 2 distrattori "vicini" */
  choices: ChoiceVisual[];
  correctIndex: 0 | 1 | 2;
  /** spiegazione mostrata al reveal, in ogni lingua */
  explanation: LocalizedText;
  hash?: string;
}

/** Contratto di ogni generatore procedurale */
export type QuestionGenerator = (rng: () => number, difficulty: Difficulty) => Question;

// ---------------------------------------------------------------------------
// Partita
// ---------------------------------------------------------------------------

export type GameMode = 'team' | 'solo';

/**
 * Da quale "mazzo" di domande pesca la partita: 'logic' sono i 19 tipi di
 * logica di sempre, 'flags' è il nuovo gioco delle bandiere. Alternativi, non
 * mescolati: chi sceglie 'flags' gioca SOLO a bandiere (vedi PACK_TYPES in
 * src/lib/questions/index.ts).
 */
export type GamePack = 'logic' | 'flags';

export interface GameSettings {
  mode: GameMode;
  pack: GamePack;
  /** null = partita aperta (termina l'host) */
  roundsTotal: number | null;
  /** finestra di prenotazione (team) o timer di decisione (solo) */
  buzzWindowMs: number;
  /** tempo per scegliere la risposta dopo il buzz */
  answerMs: number;
  /** durata base della schermata di reveal (si allunga con le spiegazioni lunghe) */
  revealMs: number;
  /**
   * Quando qualcuno sbaglia e la domanda riapre, gli altri vedono le tre
   * opzioni con quelle già bruciate sbarrate: aiuta e invoglia a riprovare.
   */
  showMistakes: boolean;
}

export type GameStatus = 'lobby' | 'playing' | 'ended';
export type Phase = 'idle' | 'countdown' | 'buzz' | 'answer' | 'reveal';

/**
 * round speciali: 'twin' = gemella (trappola per chi va a memoria),
 * 'lampo' = tempo dimezzato e punti doppi, 'sofai' = SofAI gioca anche lei e
 * ruba la domanda se nessuno si prenota in tempo.
 */
export type SpecialRound = 'none' | 'twin' | 'lampo' | 'sofai';

export type RoundOutcome =
  | 'correct'   // qualcuno ha indovinato
  | 'exhausted' // tutti hanno sbagliato
  | 'nobody'    // nessuno si è prenotato
  | 'stolen'    // (round sfida) SofAI se l'è presa lei
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
  /**
   * La battuta, in ogni lingua. Solo i consigli (hint) sono davvero tradotti:
   * per tutti gli altri momenti 'en' ripete 'it' — SofAI scherza solo in
   * italiano, per scelta (vedi src/lib/sofia/lines.ts).
   */
  text: LocalizedText;
  mood: SofiaMood;
  roundIndex: number;
  /** true se generato dall'AI (altrimenti battuta pre-scritta) */
  ai: boolean;
  seq: number;
}

/** messaggio nella chat di partita (la scrive chi se l'è guadagnata) */
export interface ChatMsg {
  nickname: string;
  avatar: string;
  text: string;
  seq: number;
}

/** proposta di SofAI per la rivincita, calcolata sui numeri della partita */
export interface RematchSuggestion {
  kind: 'easier' | 'harder';
  /** frase mostrata sul podio */
  text: string;
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
  /** ultimi messaggi della chat di partita (reveal e podio) */
  chat: ChatMsg[];
  /** chi può scrivere in chat ADESSO (vincitore del round o della partita) */
  chatOpenFor?: string;
  /** (podio) proposta di SofAI per la rivincita */
  suggestion?: RematchSuggestion;
  joinUrl?: string;
  current: null | {
    qtype: QuestionType;
    difficulty: Difficulty;
    prompt: LocalizedText;
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
    /**
     * Ultimo errore del round: chi era e (se showMistakes) che cosa aveva
     * scelto. choiceIndex null = si è prenotato e non ha risposto.
     */
    lastMiss?: { nickname: string; avatar: string; choiceIndex: number | null; mute: boolean };
    /** indici delle opzioni già scelte e sbagliate (solo con showMistakes) */
    wrongIndexes?: number[];
    /** presenti solo in fase reveal */
    revealUntil?: number;
    /** durata effettiva del reveal (allungata se la spiegazione è lunga) */
    revealMs?: number;
    correctIndex?: number;
    explanation?: LocalizedText;
    outcome?: RoundOutcome;
    /** indice scelto da chi ha risposto (per il reveal) */
    answeredIndex?: number;
  };
}
