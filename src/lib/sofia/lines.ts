// Battute pre-scritte di Sofia: mostrate all'istante, eventualmente sostituite
// dalla versione AI quando arriva. {name} = nickname, {n} = numero,
// {tip} = consiglio sul tipo di domanda (solo per 'hint').
//
// Tono: ironica e un po' sfottona, mai cattiva — si gioca in famiglia.
// ITALIANO NEUTRO: niente aggettivi o participi accordati con chi gioca.

import type { LocalizedText, QuestionType, SofiaMood } from '../types';
import { L } from '../localize';

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

/**
 * Le battute vere e proprie restano solo in italiano (SofAI scherza in
 * italiano per scelta): `L(it)` senza secondo argomento ripiega 'en' su 'it'.
 * Fa eccezione `hint`, che introduce un consiglio VERO sul tipo di domanda
 * (vedi HINTS più sotto): quello va tradotto, o la frase risulterebbe a metà
 * in una partita in inglese.
 */
export const LINES: Record<SofiaLineKind, LocalizedText[]> = {
  welcome: [
    L('Ciao {name}! Io sono SofAI, occhio che le domande le ho scelte io… 😏'),
    L('Benvenuta squadra! Regola n.1: niente panico. Regola n.2: siate veloci!'),
    L('Ciao {name}! Vediamo chi ha il cervello più scattante, eh? 🧠'),
  ],
  join: [
    L('Ooh, ecco {name}! La sfida si fa interessante…'),
    L('{name} è in squadra! Occhio, ha la faccia di chi le sa tutte.'),
    L('Ciao {name}! Il pulsante rosso non morde, promesso.'),
    L('{name} si unisce! Più siamo, più è bello vincere. Il podio però ha un posto solo.'),
  ],
  twin: [
    L('Questa mi sa che l’avete già vista… o forse no? 😏 Guardate BENE!'),
    L('Attenzione: sembra una vecchia conoscenza, ma io ho cambiato qualcosa…'),
    L('Déjà vu? Occhio, chi va a memoria stavolta ci casca! 👀'),
    L('Vi sembra familiare? Controllate ogni dettaglio, ve lo consiglio io.'),
  ],
  lampo: [
    L('ROUND LAMPO! ⚡ Metà tempo, punti DOPPI. Coraggio!'),
    L('Lampo! Chi esita saluta i punti: doppio punteggio in palio! ⚡'),
    L('Sveglia! Round lampo: tempo dimezzato, punti raddoppiati!'),
  ],
  sofaiRound: [
    L('ROUND SFIDA! 🤖 Questa la voglio anch’io: prenotatevi prima che me la prenda.'),
    L('Attenzione: stavolta gioco anch’io. Se nessuno si prenota, la domanda è MIA. 😼'),
    L('Sfida ufficiale: o suonate voi quel pulsante, o lo suono io. E io non sbaglio mai.'),
  ],
  stolen: [
    L('RUBATA! 😼 Ve l’avevo detto: chi non si prenota, perde. Io intanto la sapevo.'),
    L('Troppo lenti! Questa me la segno tra le mie vittorie. SofAI 1 — squadra 0.'),
    L('Grazie del regalo! La risposta la sapevo dal primo secondo, ovviamente.'),
  ],
  cocco: [
    L('Decisione presa: da adesso il mio tifo va tutto a {name}. 💛 Qualcuno doveva pur pensarci.'),
    L('Nuova regola mia: {name} è ufficialmente sotto la mia protezione. Tremate.'),
    L('Mi sono scelta {name} come portafortuna. Da qui in poi, occhio a voi due.'),
  ],
  hint: [
    L('Psst, {name}… consiglio da amica: {tip}', 'Psst, {name}… friendly advice: {tip}'),
    L('Questa è tosta. {name}, ascolta me: {tip}', 'This one’s tough. {name}, listen to me: {tip}'),
    L(
      'Suggerimento ufficiale per {name} (ma se origliate non mi offendo): {tip}',
      'Official tip for {name} (but I won’t mind if the rest of you listen in): {tip}'
    ),
  ],
  rematch: [
    L('RIVINCITA! {name} ha deciso: non è finita finché non lo dico… cioè, finché non lo dice {name}.'),
    L('Si replica! Stessa squadra, domande nuove di zecca. Le ho scelte più cattive. 😏'),
    L('Un’altra! {name} vuole il bis: azzerate i punti, si riparte da zero.'),
  ],
  correct: [
    L('Grande {name}! Risposta giusta, cervello acceso! 💡'),
    L('{name} la sapeva davvero! Punti in saccoccia.'),
    L('Esatto! {name} oggi ha mangiato pane e quiz.'),
    L('Giusta! {name}, se continui così mi tocca inventare domande più difficili. Non tentarmi.'),
  ],
  correctFast: [
    L('WOW {name}, più veloce della mia connessione! ⚡'),
    L('Fulmine {name}! Risposta data prima ancora di pensarci. E indovinata!'),
    L('{name} in modalità turbo! Risposta giusta e velocissima!'),
    L('Ehm, {name}… hai letto la domanda o vai a fortuna? Perché così mi spaventi. ⚡'),
  ],
  correctStreak: [
    L('{name} è ON FIRE! {n} di fila! 🔥'),
    L('Qualcuno fermi {name}: {n} risposte giuste di fila!'),
    L('{name} ha attivato la modalità fuoriclasse: streak da paura!'),
    L('{n} di fila per {name}. Comincio a sospettare che le mie domande siano troppo facili. 🤨'),
  ],
  wrong: [
    L('Ahi ahi {name}… c’eri quasi! I punti però se ne vanno.'),
    L('No {name}! Il pulsante giusto era un altro. Capita nelle migliori famiglie… 😏'),
    L('Risposta coraggiosa, {name}. Il coraggio, purtroppo, non dà punti.'),
    L('Ops! {name}, la fretta è cattiva consigliera… la domanda riapre!'),
    L('{name} ha risposto con grande sicurezza. Sicurezza mal riposta, ma grande. 😏'),
  ],
  mute: [
    L('{name} prenota… e poi il vuoto. Che suspense sprecata!'),
    L('Ehm, {name}? Il microfono era tuo! Silenzio che costa caro.'),
    L('{name} fa la mossa del gambero: prenota e sparisce. Penalità!'),
  ],
  nobody: [
    L('Nessuno si prenota?! E io che l’avevo scelta così carina… punticini via a tutti!'),
    L('Che silenzio… questa domanda vi ha fatto paura, eh? −10 a testa, offre la casa.'),
    L('Immobili come statue! La timidezza costa: −10.'),
    L('Capisco, la domanda era brutta. L’ho fatta io, potete dirlo. Intanto −10. 😏'),
  ],
  timeout: [
    L('Tempo scaduto! Decidersi, che qui i punti volano via… ⏰'),
    L('Che lentezza! La prossima volta fidati del tuo primo pensiero.'),
    L('Il tempo è tiranno… e pure la penalità!'),
  ],
  exhausted: [
    L('Nessuno l’ha indovinata! Questa la riciclo per il prossimo quiz… 😏'),
    L('Tutta la squadra k.o. su questa! Vi svelo io il trucco, guardate qui.'),
    L('Domanda 1 — Squadra 0. Ci rifacciamo al prossimo round!'),
  ],
  podium: [
    L('E il podio parla chiaro: {name} ha ufficialmente il cervello più veloce di casa! 🏆'),
    L('Applausi per {name}! Per il resto della squadra… c’è sempre la rivincita!'),
    L('Fine dei giochi: vince {name}! Io lo sapevo dal primo round, giuro.'),
    L('Vince {name}, che ora ha diritto di sfottere per una settimana. Regolamento mio, articolo 1. 🏆'),
  ],
};

/**
 * Consigli VERI per tipo di domanda: SofAI li regala al suo cocco sulle
 * domande difficili, ma li leggono tutti — è tifo, non trucco. Devono restare
 * veri: se un generatore cambia regole, va cambiato anche il consiglio (in
 * ENTRAMBE le lingue).
 */
export const HINTS: Record<QuestionType, LocalizedText> = {
  sequence: L(
    'guarda cosa cambia da una figura alla successiva — rotazione, numero o dimensione.',
    'look at what changes from one shape to the next — rotation, count, or size.'
  ),
  matrix: L(
    'leggi la griglia riga per riga: la regola si ripete uguale in ogni riga.',
    'read the grid row by row: the rule repeats the same way in every row.'
  ),
  oddone: L(
    'cerca la proprietà che accomuna tutte le figure tranne una.',
    'look for the property shared by every shape but one.'
  ),
  numseries: L(
    'prova le differenze fra numeri vicini: spesso il ritmo si nasconde lì.',
    'try the differences between neighboring numbers: the pattern often hides there.'
  ),
  rotation: L(
    'ruota la figura nella testa; se per farla combaciare devi specchiarla, è un inganno.',
    'rotate the shape in your head; if you need to mirror it to make it match, it’s a trap.'
  ),
  dice: L(
    'conta anche i cubi che non si vedono: se ce n’è uno sopra, sotto c’è una colonna intera.',
    'count the cubes you can’t see too: if there’s one on top, there’s a whole column underneath.'
  ),
  clock: L(
    'allo specchio le lancette girano al contrario: leggi l’ora "alla rovescia".',
    'in a mirror the hands turn backwards: read the time "flipped".'
  ),
  balance: L(
    'parti dalla bilancia in equilibrio: ti dice quanto vale ogni forma.',
    'start from the balanced scale: it tells you what each shape is worth.'
  ),
  analogy: L(
    'scopri cosa trasforma la prima figura nella seconda, poi rifai lo stesso alla terza.',
    'work out what turns the first shape into the second, then do the same to the third.'
  ),
  arithgrid: L(
    'ricava il valore di UNA forma da una riga e portalo nelle altre.',
    'work out the value of ONE shape from a row, then carry it into the others.'
  ),
  fold: L(
    'segui la piega al contrario: riapri il foglio un passo alla volta.',
    'follow the fold backwards: reopen the paper one step at a time.'
  ),
  paths: L(
    'segui il percorso col dito, una casella alla volta, senza saltare.',
    'trace the path with your finger, one square at a time, without skipping.'
  ),
  sets: L(
    'la risposta deve rispettare la regola di TUTTI i gruppi insieme, non di uno solo.',
    'the answer must fit the rule of ALL the groups at once, not just one.'
  ),
  mirror: L(
    'allo specchio destra e sinistra si scambiano: le versioni solo ruotate sono trappole.',
    'in a mirror left and right swap: versions that are only rotated are traps.'
  ),
  domino: L(
    'guarda come cambiano i numeri da una tessera alla successiva, metà per metà.',
    'watch how the numbers change from one tile to the next, half by half.'
  ),
  symmetry: L(
    'piega la figura lungo l’asse con gli occhi: le due metà devono combaciare.',
    'fold the shape along the axis with your eyes: the two halves must match.'
  ),
  weights: L(
    'trasforma tutto nella stessa "moneta", un cambio alla volta.',
    'convert everything into the same "currency", one swap at a time.'
  ),
  pattern: L(
    'conta con ordine, una riga alla volta: il colpo d’occhio inganna.',
    'count in order, one row at a time: eyeballing it is misleading.'
  ),
  majority: L(
    'niente colpo d’occhio: conta gruppo per gruppo, con calma.',
    'no eyeballing: count group by group, and take your time.'
  ),
  pairs: L(
    'accoppia le figure una alla volta e scarta le coppie fatte: alla fine resta lei.',
    'pair up the shapes one at a time and cross out matched pairs: the odd one out is what’s left.'
  ),
  flags: L(
    'guarda l’ordine esatto dei colori: alcune bandiere sono quasi identiche, cambia solo quello.',
    'look at the exact order of the colors: some flags are nearly identical — that’s the only difference.'
  ),
};

function fillLine(template: string, name?: string, n?: number, tip?: string): string {
  return template
    .replaceAll('{name}', name ?? '')
    .replaceAll('{n}', String(n ?? ''))
    .replaceAll('{tip}', tip ?? '')
    .trim();
}

/** Come fillLine, ma riempie ogni lingua del template con la propria versione del tip. */
export function fillLineL(template: LocalizedText, name?: string, n?: number, tip?: LocalizedText): LocalizedText {
  return {
    it: fillLine(template.it, name, n, tip?.it),
    en: fillLine(template.en, name, n, tip?.en),
  };
}
