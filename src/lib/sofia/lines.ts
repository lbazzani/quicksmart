// Battute pre-scritte di Sofia: mostrate all'istante, eventualmente sostituite
// dalla versione AI quando arriva. {name} = nickname, {n} = numero.

import type { SofiaMood } from '../types';

export type SofiaLineKind =
  | 'welcome'
  | 'join'
  | 'twin'
  | 'lampo'
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
    'Ciao {name}! Pronta a vedere chi ha il cervello più scattante?',
  ],
  join: [
    'Ooh, ecco {name}! La sfida si fa interessante…',
    '{name} è in squadra! Occhio, ha la faccia di chi le sa tutte.',
    'Ciao {name}! Il pulsante rosso non morde, promesso.',
    '{name} si unisce! Più siamo, più è bello vincere. Da soli, ovvio.',
  ],
  twin: [
    'Questa mi sa che l’avete già vista… o forse no? 😏 Guardate BENE!',
    'Attenzione: sembra una vecchia conoscenza, ma io ho cambiato qualcosa…',
    'Déjà vu? Occhio, chi va a memoria stavolta ci casca! 👀',
    'Vi sembra familiare? Controllate ogni dettaglio, ve lo consiglio io.',
  ],
  lampo: [
    'ROUND LAMPO! ⚡ Metà tempo, punti DOPPI. Coraggio!',
    'Lampo! Chi esita è perduto: doppio punteggio in palio! ⚡',
    'Sveglia! Round lampo: tempo dimezzato, punti raddoppiati!',
  ],
  correct: [
    'Grande {name}! Risposta giusta, cervello acceso! 💡',
    '{name} la sapeva davvero! Punti in saccoccia.',
    'Esatto! {name} oggi ha mangiato pane e quiz.',
  ],
  correctFast: [
    'WOW {name}, più veloce della mia connessione! ⚡',
    'Fulmine {name}! Risposta data prima ancora di pensarci. E indovinata!',
    '{name} in modalità turbo! Giusta e velocissima!',
  ],
  correctStreak: [
    '{name} è ON FIRE! {n} di fila! 🔥',
    'Qualcuno fermi {name}: {n} risposte giuste di fila!',
    '{name} ha attivato la modalità campione: streak da paura!',
  ],
  wrong: [
    'Ahi ahi {name}… era così vicina! I punti però se ne vanno.',
    'No {name}! Il pulsante giusto era un altro. Capita ai migliori… più o meno.',
    'Risposta coraggiosa, {name}. Il coraggio, purtroppo, non dà punti.',
    'Ops! {name}, la fretta è cattiva consigliera… la domanda riapre!',
  ],
  mute: [
    '{name} prenota… e poi il vuoto. Che suspense sprecata!',
    'Ehm, {name}? Il microfono era tuo! Silenzio che costa caro.',
    '{name} fa la mossa del gambero: prenota e sparisce. Penalità!',
  ],
  nobody: [
    'Nessuno si prenota?! E io che l’avevo scelta così carina… −25 a tutti!',
    'Che silenzio… questa domanda vi ha fatto paura, eh? Punticini via a tutti.',
    'Tutti fermi come statue! La timidezza costa: −25.',
  ],
  timeout: [
    'Tempo scaduto! Decidersi, che qui i punti volano via… ⏰',
    'Troppo lenta! La prossima volta fidati del tuo primo pensiero.',
    'Il tempo è tiranno… e pure la penalità!',
  ],
  exhausted: [
    'Nessuno l’ha indovinata! Questa la riciclo per il prossimo quiz… 😏',
    'Tutti k.o. su questa! Vi svelo io il trucco, guardate qui.',
    'Domanda 1 — Squadra 0. Succede anche ai migliori!',
  ],
  podium: [
    'E il podio parla chiaro: {name} è ufficialmente il cervellone di casa! 🏆',
    'Applausi per {name}! Gli altri… c’è sempre la rivincita!',
    'Fine dei giochi: vince {name}! Io lo sapevo dal primo round, giuro.',
  ],
};

export function fillLine(template: string, name?: string, n?: number): string {
  return template.replaceAll('{name}', name ?? '').replaceAll('{n}', String(n ?? '')).trim();
}
