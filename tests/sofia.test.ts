// Le battute che l'AI prepara per la partita finiscono a schermo così come
// sono: nessuno le rilegge prima. Il filtro è l'unica difesa, e queste sono
// le cose che deve fermare.

import { describe, expect, it } from 'vitest';
import { parseWarmup } from '../src/lib/sofia/sofia';

describe('battute preparate dall’AI', () => {
  it('tiene le righe ben formate e le associa al momento giusto', () => {
    const out = parseWarmup(
      ['correct: {name} centra il bersaglio! 🎯', 'nobody: Silenzio in sala… nessuno ci prova?'].join('\n')
    );
    expect(out.correct).toEqual(['{name} centra il bersaglio! 🎯']);
    expect(out.nobody).toEqual(['Silenzio in sala… nessuno ci prova?']);
  });

  it('scarta le battute che si rivolgono a un genere', () => {
    // il prompt lo vieta, ma l'AI non è deterministica: qui si controlla
    const out = parseWarmup(
      ['correct: {name} sei stato velocissimo!', 'wrong: {name} non è stata fortunata…', 'nobody: Nessuno ci prova?'].join('\n')
    );
    expect(out.correct).toBeUndefined();
    expect(out.wrong).toBeUndefined();
    expect(out.nobody).toHaveLength(1);
  });

  it('scarta «da solo», che l’AI usa spesso commentando l’allenamento in solitaria', () => {
    // visto davvero sul podio: «Marta, 2436 punti da solo: che colpo!»
    const out = parseWarmup(
      ['correct: {name} ha fatto tutto da solo!', 'nobody: Nessuno ci prova?'].join('\n')
    );
    expect(out.correct).toBeUndefined();
    expect(out.nobody).toHaveLength(1);
  });

  it('non scarta le parole che concordano con un nome, non con chi gioca', () => {
    // il filtro largo di prima buttava queste battute, perfette, in silenzio
    const out = parseWarmup(
      [
        'correct: {name} risponde prima ancora di pensarci!',
        'correctFast: Risposta velocissima, roba da cronometro ⚡',
        'wrong: Come al solito la trappola era proprio lì!',
      ].join('\n')
    );
    expect(out.correct).toHaveLength(1);
    expect(out.correctFast).toHaveLength(1);
    expect(out.wrong).toHaveLength(1);
  });

  it('scarta le risposte in cui il modello chiede informazioni', () => {
    expect(parseWarmup('correct: Mi servono più informazioni per scrivere la battuta!')).toEqual({});
  });

  it('vieta il segnaposto del nome dove non c’è nessuno da nominare', () => {
    const out = parseWarmup(
      ['correct: Che colpo, roba da applausi!', 'nobody: {name} non si prenota nessuno?'].join('\n')
    );
    // una battuta impersonale va benissimo: chi ha risposto si vede già a schermo
    expect(out.correct).toHaveLength(1);
    // in "nobody" invece non c'è nessuno: {name} lascerebbe un buco nella frase
    expect(out.nobody).toBeUndefined();
  });

  it('accetta {n} solo dove esiste un numero da mettere', () => {
    const out = parseWarmup(
      ['correctStreak: {name} macina {n} risposte di fila!', 'correct: {name} ne ha prese {n}!'].join('\n')
    );
    expect(out.correctStreak).toHaveLength(1);
    expect(out.correct).toBeUndefined();
  });

  it('ignora chiavi sconosciute e testo di contorno', () => {
    const out = parseWarmup(
      ['Ecco le battute:', 'inventata: qualcosa', '- lampo: Metà tempo, punti doppi: si vola! ⚡', ''].join('\n')
    );
    expect(Object.keys(out)).toEqual(['lampo']);
  });
});
