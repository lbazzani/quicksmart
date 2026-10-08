// I testi che finiscono nelle chat (src/lib/share.ts).

import { describe, expect, it } from 'vitest';
import { DICTS } from '../src/lib/i18n';
import { conRef, striscia, testoPodio, testoRisultato } from '../src/lib/share';

const IT = DICTS.it.share;

describe('testi da condividere', () => {
  it('la sfida del giorno: numero, striscia, punteggio, invito', () => {
    expect(
      testoRisultato(IT, { numero: 12, esiti: ['g', 'g', 's', 't'], giuste: 2, totale: 4, punti: 340 })
    ).toBe('QuickSmart ⚡ Sfida #12\n🟩🟩🟥⬜\n2/4 · 340 punti\nMi batti?');
  });

  it('l’allenamento non ha numero, e senza esiti non lascia righe vuote', () => {
    expect(testoRisultato(IT, { esiti: [], giuste: 7, totale: 10, punti: 1840 })).toBe(
      'QuickSmart ⚡ allenamento\n7/10 · 1840 punti\nMi batti?'
    );
  });

  it('il podio di squadra mostra i primi tre', () => {
    const t = testoPodio(IT, 'Famiglia', [
      { nickname: 'Marta', score: 900 },
      { nickname: 'Papà', score: 500 },
      { nickname: 'Mamma', score: 300 },
      { nickname: 'Nonna', score: 100 },
    ]);
    expect(t).toBe('🏆 QuickSmart · Famiglia\n🥇 Marta 900\n🥈 Papà 500\n🥉 Mamma 300\nChi ci sfida?');
  });

  it('il ref si aggiunge senza perdere il codice della partita', () => {
    expect(conRef('https://quicksmart.it/join?code=ABCDE', 'invito')).toBe('https://quicksmart.it/join?code=ABCDE&ref=invito');
    expect(conRef('https://quicksmart.it/sfida', 'sfida')).toBe('https://quicksmart.it/sfida?ref=sfida');
  });

  it('la striscia ha un quadrato per round', () => {
    expect(striscia(['g', 's', 't'])).toBe('🟩🟥⬜');
  });

  it('i testi inglesi hanno le stesse parti', () => {
    expect(testoRisultato(DICTS.en.share, { numero: 3, esiti: ['g'], giuste: 1, totale: 1, punti: 150 })).toBe(
      'QuickSmart ⚡ Challenge #3\n🟩\n1/1 · 150 points\nCan you beat me?'
    );
  });
});
