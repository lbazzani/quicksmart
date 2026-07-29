// Il patto con chi gioca: tutto quello che serve per rispondere è dichiarato
// PRIMA di rispondere, e il gioco non dice mai il falso.
//
// Questi test nascono da difetti reali, trovati da audit alla cieca e costati
// la sospensione di tre tipi di domanda. Servono a impedire che tornino.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/rng';
import { GENERATORS } from '../src/lib/questions';
import type { CellSpec, Difficulty, Question } from '../src/lib/types';
import { COLOR_FORMS, COLOR_NAMES, distinctColors, tooSimilar } from '../src/lib/colors';
import { PALETTE } from '../src/components/visuals';

function generate(qtype: keyof typeof GENERATORS, n: number, seed = 4242): Question[] {
  const rng = mulberry32(seed);
  const out: Question[] = [];
  for (const d of [1, 2, 3] as Difficulty[]) {
    for (let i = 0; i < n; i++) {
      try {
        out.push(GENERATORS[qtype](rng, d));
      } catch {
        // generazione fallita: non è oggetto di questo test
      }
    }
  }
  return out;
}

describe('fold — la regola della piega si legge prima di rispondere', () => {
  const questions = generate('fold', 60);

  it('avverte nel prompt quando un buco cade sulla linea di piega', () => {
    // la spiegazione (che si legge DOPO) non può essere l'unico posto in cui
    // sta la regola decisiva: chi contava in modo ingenuo trovava la propria
    // svista fra le opzioni
    const conCordonatura = questions.filter((q) => /SULLA linea|SULLA piega/i.test(q.explanation));
    expect(conCordonatura.length).toBeGreaterThan(0);
    for (const q of conCordonatura) {
      expect(q.prompt, `prompt senza avviso: ${q.prompt}`).toMatch(/SULLA piega/i);
    }
  });

  it('disegna sempre la linea di piega su ogni pannello mostrato', () => {
    for (const q of questions) {
      expect(q.payload.kind).toBe('cells');
      if (q.payload.kind !== 'cells') continue;
      const panels = q.payload.rows.flat().filter((c: CellSpec) => !c.unknown);
      expect(panels.length).toBeGreaterThan(0);
      for (const p of panels) expect(p.crease, 'pannello senza linea di piega').toBeTruthy();
    }
  });

  it('sta sempre in una riga sola di pannelli', () => {
    for (const q of questions) {
      if (q.payload.kind !== 'cells') continue;
      expect(q.payload.rows.length).toBe(1);
      expect(q.payload.rows[0].length).toBeLessThanOrEqual(4);
    }
  });
});

describe('symmetry — l’asse si vede anche dove serve giudicarlo', () => {
  it('disegna l’asse sulle opzioni quando il quesito ne riguarda uno solo', () => {
    for (const q of generate('symmetry', 40)) {
      const conAsse = q.choices.filter((c) => c.kind === 'cell' && c.cell.crease);
      // o tutte le opzioni hanno l'asse, o nessuna: un sottoinsieme
      // suggerirebbe quale guardare
      expect([0, 3]).toContain(conAsse.length);
      if (q.payload.kind !== 'cells') continue;
      const assiEsempi = new Set(
        q.payload.rows
          .flat()
          .map((c: CellSpec) => c.crease)
          .filter(Boolean)
      );
      // Se gli esempi mostrano DUE assi diversi, il quesito riguarda entrambi
      // (e il prompt lo dice a parole): disegnarne uno solo sulle opzioni
      // sarebbe fuorviante. Con un asse solo, invece, va mostrato dove si
      // giudica la simmetria.
      if (assiEsempi.size === 1) {
        expect(conAsse.length, `asse negli esempi ma non nelle opzioni: ${q.prompt}`).toBe(3);
      }
    }
  });
});

describe('domino — il suggerimento dice la verità', () => {
  it('non promette "gira e basta" quando la regola cambia anche i numeri', () => {
    const questions = generate('domino', 60);
    let controllate = 0;
    for (const q of questions) {
      if (!/si gira|girando/.test(q.prompt)) continue;
      if (q.payload.kind !== 'dominoes') continue;
      const tiles = q.payload.tiles;
      const hidden = tiles.findIndex((t) => t.unknown);
      if (hidden < 1) continue;
      const prev = tiles[hidden - 1];
      // "gira e basta" applicato alla lettera
      const letterale = { a: prev.b, b: prev.a };
      const indice = q.choices.findIndex(
        (c) => c.kind === 'domino' && c.tile.a === letterale.a && c.tile.b === letterale.b
      );
      if (indice < 0) continue;
      controllate++;
      if (indice !== q.correctIndex) {
        // se seguire il suggerimento alla lettera porta a un distrattore,
        // il prompt DEVE aver avvertito che i numeri cambiano
        expect(q.prompt, `prompt fuorviante: ${q.prompt}`).toMatch(/cambia|crescono/);
      }
    }
    expect(controllate).toBeGreaterThan(0);
  });
});

describe('i colori si chiamano come sono disegnati', () => {
  // Cambiare la tavolozza è facile; dimenticare che una domanda chiama "viola"
  // un colore che ora è verde acqua lo è altrettanto, e chi ragiona bene
  // sbaglia. I nomi devono venire tutti da src/lib/colors.ts.
  const fuoriTavolozza = /\b(ciano|viola|corallo|ambra|celeste|blu|magenta|turchese)\b/i;

  it('nessun testo nomina un colore che non è nella tavolozza', () => {
    for (const qtype of Object.keys(GENERATORS) as (keyof typeof GENERATORS)[]) {
      for (const q of generate(qtype, 25)) {
        const testo = [q.prompt, q.explanation, ...q.choices.map((c) => (c.kind === 'text' ? c.text : ''))].join(' ');
        const trovato = testo.match(fuoriTavolozza);
        expect(trovato?.[0], `${qtype} nomina "${trovato?.[0]}": ${testo.slice(0, 120)}`).toBeUndefined();
      }
    }
  });

  it('la tavolozza dei nomi e quella dei colori disegnati hanno la stessa lunghezza', () => {
    expect(COLOR_NAMES.length).toBe(PALETTE.length);
    expect(COLOR_FORMS.length).toBe(PALETTE.length);
  });

  it('trovare 4 colori distinguibili riesce SEMPRE', () => {
    // Cambiare la tavolozza cambia anche quali coppie si confondono, e quindi
    // se quattro colori distinguibili esistano ancora. La versione golosa
    // falliva il 17,8% delle estrazioni con le coppie attuali: le domande
    // "sets" e "pattern" semplicemente non venivano generate.
    const rng = mulberry32(1234);
    for (let i = 0; i < 5000; i++) {
      const c = distinctColors(rng, 4);
      expect(c.length).toBe(4);
      for (let a = 0; a < c.length; a++)
        for (let b = a + 1; b < c.length; b++)
          expect(tooSimilar(c[a], c[b]), `${COLOR_NAMES[c[a]]}/${COLOR_NAMES[c[b]]} si confondono`).toBe(false);
    }
  });
});

describe('tutti i tipi — nessuna opzione è indistinguibile da un’altra', () => {
  it('le tre opzioni sono sempre diverse fra loro', () => {
    for (const qtype of ['fold', 'symmetry', 'domino'] as const) {
      for (const q of generate(qtype, 40)) {
        const chiavi = q.choices.map((c) => JSON.stringify(c));
        expect(new Set(chiavi).size, `${qtype}: opzioni duplicate`).toBe(3);
      }
    }
  });
});
