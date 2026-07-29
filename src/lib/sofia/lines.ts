// Battute pre-scritte di Sofia: mostrate all'istante, eventualmente sostituite
// dalla versione AI quando arriva. {name} = nickname, {n} = numero,
// {tip} = consiglio sul tipo di domanda (solo per 'hint').
//
// Tono: ironica e un po' sfottona, mai cattiva — si gioca in famiglia.
// ITALIANO NEUTRO: niente aggettivi o participi accordati con chi gioca.

import type { QuestionType, SofiaMood } from '../types';

export type SofiaLineKind =
  | 'welcome'
  | 'join'
  | 'twin'
  | 'lampo'
  | 'sofaiRound'
  | 'stolen'
  | 'cocco'
  | 'hint'
  | 'rematch'
  | 'correct'
  | 'correctFast'
  | 'correctStreak'
  | 'wrong'
  | 'mute'
  | 'nobody'
  | 'timeout'
  | 'exhausted'
  | 'podium';

export const MOODS: Record<SofiaLineKind, SofiaMood> = {
  welcome: 'happy',
  join: 'happy',
  twin: 'teasing',
  lampo: 'wow',
  sofaiRound: 'teasing',
  stolen: 'teasing',
  cocco: 'happy',
  hint: 'thinking',
  rematch: 'wow',
  correct: 'happy',
  correctFast: 'wow',
  correctStreak: 'wow',
  wrong: 'teasing',
  mute: 'teasing',
  nobody: 'sad',
  timeout: 'sad',
  exhausted: 'teasing',
  podium: 'wow',
};

export const LINES: Record<SofiaLineKind, string[]> = {
  welcome: [
    'Ciao {name}! Io sono SofAI, occhio che le domande le ho scelte io… 😏',
    'Benvenuta squadra! Regola n.1: niente panico. Regola n.2: siate veloci!',
    'Ciao {name}! Vediamo chi ha il cervello più scattante, eh? 🧠',
  ],
  join: [
    'Ooh, ecco {name}! La sfida si fa interessante…',
    '{name} è in squadra! Occhio, ha la faccia di chi le sa tutte.',
    'Ciao {name}! Il pulsante rosso non morde, promesso.',
    '{name} si unisce! Più siamo, più è bello vincere. Il podio però ha un posto solo.',
  ],
  twin: [
    'Questa mi sa che l’avete già vista… o forse no? 😏 Guardate BENE!',
    'Attenzione: sembra una vecchia conoscenza, ma io ho cambiato qualcosa…',
    'Déjà vu? Occhio, chi va a memoria stavolta ci casca! 👀',
    'Vi sembra familiare? Controllate ogni dettaglio, ve lo consiglio io.',
  ],
  lampo: [
    'ROUND LAMPO! ⚡ Metà tempo, punti DOPPI. Coraggio!',
    'Lampo! Chi esita saluta i punti: doppio punteggio in palio! ⚡',
    'Sveglia! Round lampo: tempo dimezzato, punti raddoppiati!',
  ],
  sofaiRound: [
    'ROUND SFIDA! 🤖 Questa la voglio anch’io: prenotatevi prima che me la prenda.',
    'Attenzione: stavolta gioco anch’io. Se nessuno si prenota, la domanda è MIA. 😼',
    'Sfida ufficiale: o suonate voi quel pulsante, o lo suono io. E io non sbaglio mai.',
  ],
  stolen: [
    'RUBATA! 😼 Ve l’avevo detto: chi non si prenota, perde. Io intanto la sapevo.',
    'Troppo lenti! Questa me la segno tra le mie vittorie. SofAI 1 — squadra 0.',
    'Grazie del regalo! La risposta la sapevo dal primo secondo, ovviamente.',
  ],
  cocco: [
    'Decisione presa: da adesso il mio tifo va tutto a {name}. 💛 Qualcuno doveva pur pensarci.',
    'Nuova regola mia: {name} è ufficialmente sotto la mia protezione. Tremate.',
    'Mi sono scelta {name} come portafortuna. Da qui in poi, occhio a voi due.',
  ],
  hint: [
    'Psst, {name}… consiglio da amica: {tip}',
    'Questa è tosta. {name}, ascolta me: {tip}',
    'Suggerimento ufficiale per {name} (ma se origliate non mi offendo): {tip}',
  ],
  rematch: [
    'RIVINCITA! {name} ha deciso: non è finita finché non lo dico… cioè, finché non lo dice {name}.',
    'Si replica! Stessa squadra, domande nuove di zecca. Le ho scelte più cattive. 😏',
    'Un’altra! {name} vuole il bis: azzerate i punti, si riparte da zero.',
  ],
  correct: [
    'Grande {name}! Risposta giusta, cervello acceso! 💡',
    '{name} la sapeva davvero! Punti in saccoccia.',
    'Esatto! {name} oggi ha mangiato pane e quiz.',
    'Giusta! {name}, se continui così mi tocca inventare domande più difficili. Non tentarmi.',
  ],
  correctFast: [
    'WOW {name}, più veloce della mia connessione! ⚡',
    'Fulmine {name}! Risposta data prima ancora di pensarci. E indovinata!',
    '{name} in modalità turbo! Risposta giusta e velocissima!',
    'Ehm, {name}… hai letto la domanda o vai a fortuna? Perché così mi spaventi. ⚡',
  ],
  correctStreak: [
    '{name} è ON FIRE! {n} di fila! 🔥',
    'Qualcuno fermi {name}: {n} risposte giuste di fila!',
    '{name} ha attivato la modalità fuoriclasse: streak da paura!',
    '{n} di fila per {name}. Comincio a sospettare che le mie domande siano troppo facili. 🤨',
  ],
  wrong: [
    'Ahi ahi {name}… c’eri quasi! I punti però se ne vanno.',
    'No {name}! Il pulsante giusto era un altro. Capita nelle migliori famiglie… 😏',
    'Risposta coraggiosa, {name}. Il coraggio, purtroppo, non dà punti.',
    'Ops! {name}, la fretta è cattiva consigliera… la domanda riapre!',
    '{name} ha risposto con grande sicurezza. Sicurezza mal riposta, ma grande. 😏',
  ],
  mute: [
    '{name} prenota… e poi il vuoto. Che suspense sprecata!',
    'Ehm, {name}? Il microfono era tuo! Silenzio che costa caro.',
    '{name} fa la mossa del gambero: prenota e sparisce. Penalità!',
  ],
  nobody: [
    'Nessuno si prenota?! E io che l’avevo scelta così carina… punticini via a tutti!',
    'Che silenzio… questa domanda vi ha fatto paura, eh? −10 a testa, offre la casa.',
    'Immobili come statue! La timidezza costa: −10.',
    'Capisco, la domanda era brutta. L’ho fatta io, potete dirlo. Intanto −10. 😏',
  ],
  timeout: [
    'Tempo scaduto! Decidersi, che qui i punti volano via… ⏰',
    'Che lentezza! La prossima volta fidati del tuo primo pensiero.',
    'Il tempo è tiranno… e pure la penalità!',
  ],
  exhausted: [
    'Nessuno l’ha indovinata! Questa la riciclo per il prossimo quiz… 😏',
    'Tutta la squadra k.o. su questa! Vi svelo io il trucco, guardate qui.',
    'Domanda 1 — Squadra 0. Ci rifacciamo al prossimo round!',
  ],
  podium: [
    'E il podio parla chiaro: {name} ha ufficialmente il cervello più veloce di casa! 🏆',
    'Applausi per {name}! Per il resto della squadra… c’è sempre la rivincita!',
    'Fine dei giochi: vince {name}! Io lo sapevo dal primo round, giuro.',
    'Vince {name}, che ora ha diritto di sfottere per una settimana. Regolamento mio, articolo 1. 🏆',
  ],
};

/**
 * Consigli VERI per tipo di domanda: SofAI li regala al suo cocco sulle
 * domande difficili, ma li leggono tutti — è tifo, non trucco. Devono restare
 * veri: se un generatore cambia regole, va cambiato anche il consiglio.
 */
export const HINTS: Record<QuestionType, string> = {
  sequence: 'guarda cosa cambia da una figura alla successiva — rotazione, numero o dimensione.',
  matrix: 'leggi la griglia riga per riga: la regola si ripete uguale in ogni riga.',
  oddone: 'cerca la proprietà che accomuna tutte le figure tranne una.',
  numseries: 'prova le differenze fra numeri vicini: spesso il ritmo si nasconde lì.',
  rotation: 'ruota la figura nella testa; se per farla combaciare devi specchiarla, è un inganno.',
  dice: 'conta anche i cubi che non si vedono: se ce n’è uno sopra, sotto c’è una colonna intera.',
  clock: 'allo specchio le lancette girano al contrario: leggi l’ora "alla rovescia".',
  balance: 'parti dalla bilancia in equilibrio: ti dice quanto vale ogni forma.',
  analogy: 'scopri cosa trasforma la prima figura nella seconda, poi rifai lo stesso alla terza.',
  arithgrid: 'ricava il valore di UNA forma da una riga e portalo nelle altre.',
  fold: 'segui la piega al contrario: riapri il foglio un passo alla volta.',
  paths: 'segui il percorso col dito, una casella alla volta, senza saltare.',
  sets: 'la risposta deve rispettare la regola di TUTTI i gruppi insieme, non di uno solo.',
  mirror: 'allo specchio destra e sinistra si scambiano: le versioni solo ruotate sono trappole.',
  domino: 'guarda come cambiano i numeri da una tessera alla successiva, metà per metà.',
  symmetry: 'piega la figura lungo l’asse con gli occhi: le due metà devono combaciare.',
  weights: 'trasforma tutto nella stessa "moneta", un cambio alla volta.',
  pattern: 'conta con ordine, una riga alla volta: il colpo d’occhio inganna.',
  majority: 'niente colpo d’occhio: conta gruppo per gruppo, con calma.',
  pairs: 'accoppia le figure una alla volta e scarta le coppie fatte: alla fine resta lei.',
};

export function fillLine(template: string, name?: string, n?: number, tip?: string): string {
  return template
    .replaceAll('{name}', name ?? '')
    .replaceAll('{n}', String(n ?? ''))
    .replaceAll('{tip}', tip ?? '')
    .trim();
}
