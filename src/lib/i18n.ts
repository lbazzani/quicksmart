// Dizionario stringhe UI. Per ora solo italiano; la struttura è pronta per
// aggiungere altre lingue (basta un nuovo oggetto con le stesse chiavi e
// impostare `locale`).

const it = {
  appName: 'QuickSmart',
  tagline: 'Chi è il più veloce a pensare?',
  home: {
    create: 'Crea una squadra',
    join: 'Entra con un codice',
    solo: 'Allenati da sola',
    subtitle: 'Quiz visivi stile test del QI: prenotati per primo e rispondi!',
  },
  new: {
    title: 'Nuova partita',
    gameName: 'Nome della squadra',
    gameNamePlaceholder: 'Es. I Fulmini',
    nickname: 'Il tuo nome',
    nicknamePlaceholder: 'Es. Sofia',
    avatar: 'Scegli il tuo avatar',
    rounds: 'Round',
    roundsOpen: 'Aperta',
    roundsOpenHint: 'decidi tu quando finire',
    answerTime: 'Secondi per rispondere',
    buzzTime: 'Secondi per prenotarsi',
    createBtn: 'Crea la partita',
    creating: 'Creo la partita…',
  },
  join: {
    title: 'Entra in squadra',
    code: 'Codice partita',
    codePlaceholder: 'ABCDE',
    joinBtn: 'Entra',
    joining: 'Entro…',
    notFound: 'Partita non trovata. Controlla il codice!',
    nicknameTaken: 'Nome già preso in questa squadra, scegline un altro.',
    gameStarted: 'La partita è già iniziata!',
  },
  solo: {
    title: 'Allenamento',
    subtitle: 'Da sola contro il tempo: se non ti prenoti entro il limite, perdi punti!',
    decisionTime: 'Secondi per decidere',
    startBtn: 'Inizia!',
  },
  lobby: {
    waiting: 'In attesa dei giocatori…',
    shareCode: 'Condividi il codice',
    scanQr: 'Oppure inquadra il QR',
    players: 'Giocatori',
    startBtn: 'Via alla partita!',
    needPlayers: 'Serve almeno un giocatore',
    youAreHost: 'Sei il capitano',
    copied: 'Copiato!',
  },
  game: {
    round: 'Round',
    of: 'di',
    buzz: 'PRENOTATI!',
    buzzHint: 'Premi se sai la risposta',
    tooLate: 'Troppo tardi!',
    answering: 'sta rispondendo…',
    youAnswer: 'Tocca a te! Scegli la risposta',
    lockedOut: 'Sei fuori per questo round',
    nobodyBuzzed: 'Nessuno si è prenotato! 😴',
    timeoutSolo: 'Tempo scaduto! ⏰',
    correct: 'Giusto!',
    wrong: 'Sbagliato!',
    mute: 'Non ha risposto!',
    exhausted: 'Nessuno l’ha indovinata!',
    theAnswerWas: 'La risposta era',
    value: 'punti in palio',
    reopened: 'La domanda riapre!',
    streak: 'streak',
    endGame: 'Termina partita',
    endGameConfirm: 'Vuoi terminare la partita e mostrare il podio?',
    leaderboard: 'Classifica',
    waitingNext: 'Prossimo round…',
  },
  podium: {
    title: 'Classifica finale',
    winner: 'Campione!',
    playAgain: 'Nuova partita',
    home: 'Home',
    stats: 'Statistiche',
    accuracy: 'Precisione',
    avgTime: 'Velocità media',
    bestStreak: 'Streak migliore',
    buzzWins: 'Buzz vinti',
    points: 'punti',
  },
  difficulty: { 1: 'Facile', 2: 'Media', 3: 'Difficile' } as Record<number, string>,
  qtypes: {
    sequence: 'Sequenza di figure',
    matrix: 'Matrice logica',
    oddone: 'Trova l’intruso',
    numseries: 'Serie numerica',
    rotation: 'Rotazione mentale',
    dice: 'Dadi e cubi',
    clock: 'Orologi',
    balance: 'Bilance logiche',
    analogy: 'Analogia visiva',
    arithgrid: 'Equazioni simboliche',
  } as Record<string, string>,
  errors: {
    generic: 'Ops, qualcosa è andato storto. Riprova!',
    reconnecting: 'Riconnessione…',
  },
};

export type Dict = typeof it;

const locales: Record<string, Dict> = { it };
const locale = 'it';

/** Dizionario della lingua attiva */
export const T: Dict = locales[locale];
