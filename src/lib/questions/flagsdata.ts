// Dataset delle bandiere: solo paesi rappresentabili fedelmente a bande di
// colore o a disco (nessun emblema, nessuna semplificazione che falsifichi i
// colori) — vedi src/lib/questions/flags.ts per come viene usato.
//
// Perché proprio questi 30: ogni bandiera qui è o a bande piatte o a disco
// centrato, cioè esattamente ciò che src/components/visuals.tsx sa disegnare.
// Bandiere con stemmi, stelle o croci (Brasile, USA, Regno Unito, i paesi
// nordici...) sono escluse di proposito: raffigurarle senza l'emblema
// sarebbe scorretto, non semplificato. Restano fuori finché non arriva un
// tipo di payload che le disegna per davvero.
//
// Il bello (e la difficoltà vera del gioco) è che diverse bandiere vere sono
// visivamente identiche o speculari fra loro: Ciad/Romania, Indonesia/Monaco,
// Irlanda/Costa d'Avorio, Paesi Bassi/Lussemburgo. Non è una svista del
// dataset: è la stessa sorpresa che si farebbe un enciclopedico vero, ed è
// materiale perfetto per distrattori difficili (vedi rankBySimilarity).

import type { FlagColorName, FlagSpec } from '../types';

export interface FlagCountry {
  id: string;
  it: string;
  en: string;
  pattern: FlagSpec;
}

const bands = (dir: 'h' | 'v', colors: FlagColorName[]): FlagSpec => ({ kind: 'bands', dir, colors });
const disc = (field: FlagColorName, dot: FlagColorName): FlagSpec => ({ kind: 'disc', field, disc: dot });
const cross = (field: FlagColorName, crossColor: FlagColorName, fimbriation?: FlagColorName): FlagSpec => ({
  kind: 'cross',
  field,
  cross: crossColor,
  fimbriation,
});

export const FLAG_COUNTRIES: FlagCountry[] = [
  // --- bande verticali ---
  { id: 'italy', it: 'Italia', en: 'Italy', pattern: bands('v', ['green', 'white', 'red']) },
  { id: 'france', it: 'Francia', en: 'France', pattern: bands('v', ['blue', 'white', 'red']) },
  { id: 'belgium', it: 'Belgio', en: 'Belgium', pattern: bands('v', ['black', 'yellow', 'red']) },
  { id: 'romania', it: 'Romania', en: 'Romania', pattern: bands('v', ['blue', 'yellow', 'red']) },
  { id: 'chad', it: 'Ciad', en: 'Chad', pattern: bands('v', ['blue', 'yellow', 'red']) },
  { id: 'mali', it: 'Mali', en: 'Mali', pattern: bands('v', ['green', 'yellow', 'red']) },
  { id: 'guinea', it: 'Guinea', en: 'Guinea', pattern: bands('v', ['red', 'yellow', 'green']) },
  { id: 'ireland', it: 'Irlanda', en: 'Ireland', pattern: bands('v', ['green', 'white', 'orange']) },
  { id: 'ivorycoast', it: "Costa d'Avorio", en: 'Ivory Coast', pattern: bands('v', ['orange', 'white', 'green']) },
  { id: 'nigeria', it: 'Nigeria', en: 'Nigeria', pattern: bands('v', ['green', 'white', 'green']) },
  { id: 'peru', it: 'Perù', en: 'Peru', pattern: bands('v', ['red', 'white', 'red']) },

  // --- bande orizzontali (3 fasce) ---
  { id: 'germany', it: 'Germania', en: 'Germany', pattern: bands('h', ['black', 'red', 'yellow']) },
  { id: 'russia', it: 'Russia', en: 'Russia', pattern: bands('h', ['white', 'blue', 'red']) },
  { id: 'netherlands', it: 'Paesi Bassi', en: 'Netherlands', pattern: bands('h', ['red', 'white', 'blue']) },
  { id: 'luxembourg', it: 'Lussemburgo', en: 'Luxembourg', pattern: bands('h', ['red', 'white', 'lightblue']) },
  { id: 'austria', it: 'Austria', en: 'Austria', pattern: bands('h', ['red', 'white', 'red']) },
  { id: 'armenia', it: 'Armenia', en: 'Armenia', pattern: bands('h', ['red', 'blue', 'orange']) },
  { id: 'bulgaria', it: 'Bulgaria', en: 'Bulgaria', pattern: bands('h', ['white', 'green', 'red']) },
  { id: 'hungary', it: 'Ungheria', en: 'Hungary', pattern: bands('h', ['red', 'white', 'green']) },
  { id: 'bolivia', it: 'Bolivia', en: 'Bolivia', pattern: bands('h', ['red', 'yellow', 'green']) },
  { id: 'lithuania', it: 'Lituania', en: 'Lithuania', pattern: bands('h', ['yellow', 'green', 'red']) },
  { id: 'gabon', it: 'Gabon', en: 'Gabon', pattern: bands('h', ['green', 'yellow', 'blue']) },
  { id: 'sierraleone', it: 'Sierra Leone', en: 'Sierra Leone', pattern: bands('h', ['green', 'white', 'lightblue']) },
  { id: 'yemen', it: 'Yemen', en: 'Yemen', pattern: bands('h', ['red', 'white', 'black']) },

  // --- bande orizzontali (2 fasce) ---
  { id: 'poland', it: 'Polonia', en: 'Poland', pattern: bands('h', ['white', 'red']) },
  { id: 'indonesia', it: 'Indonesia', en: 'Indonesia', pattern: bands('h', ['red', 'white']) },
  { id: 'monaco', it: 'Monaco', en: 'Monaco', pattern: bands('h', ['red', 'white']) },
  { id: 'ukraine', it: 'Ucraina', en: 'Ukraine', pattern: bands('h', ['blue', 'yellow']) },

  // --- disco centrato ---
  { id: 'japan', it: 'Giappone', en: 'Japan', pattern: disc('white', 'red') },
  { id: 'bangladesh', it: 'Bangladesh', en: 'Bangladesh', pattern: disc('green', 'red') },
  { id: 'palau', it: 'Palau', en: 'Palau', pattern: disc('lightblue', 'yellow') },

  // --- croce nordica ---
  { id: 'norway', it: 'Norvegia', en: 'Norway', pattern: cross('red', 'blue', 'white') },
  { id: 'iceland', it: 'Islanda', en: 'Iceland', pattern: cross('blue', 'red', 'white') },
  { id: 'sweden', it: 'Svezia', en: 'Sweden', pattern: cross('blue', 'yellow') },
  { id: 'finland', it: 'Finlandia', en: 'Finland', pattern: cross('white', 'blue') },
  { id: 'denmark', it: 'Danimarca', en: 'Denmark', pattern: cross('red', 'white') },
];

/**
 * Quanto due bandiere si somigliano a colpo d'occhio: stesso schema (bande vs
 * disco), stessa direzione, colori nella stessa posizione, stessi colori in
 * insieme. Non è un giudizio estetico: è la base per scegliere distrattori
 * onesti — vicini per la difficoltà alta, lontani per quella bassa (vedi
 * genFlags in ./flags.ts).
 */
export function flagSimilarity(a: FlagCountry, b: FlagCountry): number {
  const pa = a.pattern;
  const pb = b.pattern;
  if (pa.kind !== pb.kind) return 0;
  if (pa.kind === 'bands' && pb.kind === 'bands') {
    let score = pa.dir === pb.dir ? 2 : 0;
    const n = Math.min(pa.colors.length, pb.colors.length);
    for (let i = 0; i < n; i++) if (pa.colors[i] === pb.colors[i]) score += 2;
    const setB = new Set(pb.colors);
    for (const c of new Set(pa.colors)) if (setB.has(c)) score += 1;
    if (pa.colors.length === pb.colors.length) score += 1;
    return score;
  }
  if (pa.kind === 'disc' && pb.kind === 'disc') {
    return (pa.field === pb.field ? 2 : 0) + (pa.disc === pb.disc ? 2 : 0);
  }
  if (pa.kind === 'cross' && pb.kind === 'cross') {
    // stessi due colori (a prescindere da chi è il campo e chi la croce) è
    // il caso Norvegia/Islanda: rosso+blu scambiati, il più confondibile
    // che questo schema possa avere senza essere davvero identico
    const samePair = new Set([pa.field, pa.cross]).size === new Set([pa.field, pa.cross, pb.field, pb.cross]).size;
    return (pa.field === pb.field ? 2 : 0) + (pa.cross === pb.cross ? 2 : 0) + (samePair ? 1 : 0);
  }
  return 0;
}

/** tutti gli altri paesi, dal più simile al meno simile a `target` */
export function rankBySimilarity(target: FlagCountry, pool: FlagCountry[] = FLAG_COUNTRIES): FlagCountry[] {
  return pool
    .filter((c) => c.id !== target.id)
    .map((c) => ({ c, s: flagSimilarity(target, c) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/**
 * Vero SOLO quando due bandiere sono indistinguibili a colpo d'occhio: stessi
 * colori, nello stesso ordine, nella stessa direzione (o esattamente
 * speculari). A differenza di flagSimilarity — un punteggio per scegliere
 * distrattori più o meno ostici, dove "abbastanza simile" basta — qui serve
 * la certezza: lo usa il generatore per dire nella spiegazione "si confonde
 * con quella di X", e quella frase deve essere sempre vera. Prima usava una
 * soglia sul punteggio di flagSimilarity: bastava condividere 2 colori su 3
 * (Mali/Italia) o addirittura la stessa terna a bande scambiate di
 * orientamento (Guinea verticale/Bolivia orizzontale) per superarla, con la
 * spiegazione che affermava "identiche" di due bandiere chiaramente diverse.
 */
export function isExactTwin(a: FlagCountry, b: FlagCountry): boolean {
  const pa = a.pattern;
  const pb = b.pattern;
  if (pa.kind !== pb.kind) return false;
  if (pa.kind === 'bands' && pb.kind === 'bands') {
    if (pa.dir !== pb.dir || pa.colors.length !== pb.colors.length) return false;
    const n = pa.colors.length;
    const same = pa.colors.every((c, i) => c === pb.colors[i]);
    if (same) return true;
    // lo specchio (ordine invertito) inganna solo a bande VERTICALI: sinistra
    // e destra non hanno un "verso" fisso in cui si legge una bandiera, sopra
    // e sotto sì (la gravità lo impone) — "bianco sopra" vs "bianco sotto" si
    // vede a colpo d'occhio, mai "identiche" (è il caso Polonia/Indonesia,
    // che l'audit ha scartato: capovolgere una bandiera non è come guardarla).
    if (pa.dir !== 'v') return false;
    return pa.colors.every((c, i) => c === pb.colors[n - 1 - i]);
  }
  if (pa.kind === 'disc' && pb.kind === 'disc') {
    return pa.field === pb.field && pa.disc === pb.disc;
  }
  if (pa.kind === 'cross' && pb.kind === 'cross') {
    // Norvegia/Islanda hanno campo e croce SCAMBIATI (rosso+blu in entrambe,
    // ma quale sia il fondo e quale la croce cambia): assomigliano, ma non
    // sono la stessa immagine — la barra verticale è più vicina all'asta, e
    // scambiare i due colori sposta dove cade il contrasto forte.
    return pa.field === pb.field && pa.cross === pb.cross && pa.fimbriation === pb.fimbriation;
  }
  return false;
}

/** l'unico paese davvero indistinguibile da `target` a colpo d'occhio, se esiste */
export function findExactTwin(target: FlagCountry, pool: FlagCountry[] = FLAG_COUNTRIES): FlagCountry | undefined {
  return pool.find((c) => c.id !== target.id && isExactTwin(target, c));
}
