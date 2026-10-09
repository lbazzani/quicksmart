// I testi che finiscono nelle chat (src/lib/share.ts).

import { describe, expect, it } from 'vitest';
import { DICTS } from '../src/lib/i18n';
import {
  codificaRisultato,
  conRef,
  decodificaRisultato,
  linkRisultato,
  striscia,
  testoPodio,
  testoRisultato,
} from '../src/lib/share';

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

describe('il risultato dentro il link (anteprima su WhatsApp)', () => {
  it('andata e ritorno', () => {
    const r = { numero: 12, esiti: ['g', 'g', 's', 't'] as const, punti: 2436, giuste: 2, totale: 4 };
    const c = codificaRisultato({ ...r, esiti: [...r.esiti] });
    expect(c).toBe('12.ggst.2436.2.4');
    expect(decodificaRisultato(c)).toEqual({ ...r, esiti: [...r.esiti] });
  });

  it('l’allenamento non ha numero, e i punti possono essere negativi', () => {
    expect(decodificaRisultato('0.tt.-50.0.2')).toEqual({ esiti: ['t', 't'], punti: -50, giuste: 0, totale: 2 });
  });

  it('rifiuta i link fabbricati o incoerenti', () => {
    for (const s of [
      '',
      'ciao',
      '12.ggx.100.1.3', // lettera non ammessa
      '12.gg.100.3.2', // piu' giuste che domande
      '12.gggg.100.1.3', // piu' esiti che domande
      '12.g.100.1.0', // zero domande
      '12.g.1e9.1.1',
      '<script>.g.1.1.1',
      '1.' + 'g'.repeat(31) + '.1.1.31',
    ]) {
      expect(decodificaRisultato(s), s).toBeNull();
    }
  });

  it('il link porta canale e risultato, ed e’ sempre /sfida', () => {
    expect(linkRisultato('https://quicksmart.it', { numero: 3, esiti: ['g'], punti: 150, giuste: 1, totale: 1 }, 'sfida')).toBe(
      'https://quicksmart.it/sfida?ref=sfida&r=3.g.150.1.1'
    );
  });
});
