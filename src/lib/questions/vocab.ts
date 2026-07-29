// Vocabolario italiano condiviso dai generatori: nomi delle forme con genere
// e numero, colori con gli accordi, aggettivi. Sta in un posto solo perché due
// domande non devono mai chiamare la stessa cosa con parole diverse.

import type { ShapeName } from '../types';
import type { Rng } from '../rng';
import { COLOR_FORMS, distinctColors } from '../colors';

export interface ShapeInfo {
  shape: ShapeName;
  one: string; // "stella"
  many: string; // "stelle"
  f: boolean; // femminile
}

/** solo forme ben distinguibili anche in una cella piccola (56px) */
export const SHAPES: ShapeInfo[] = [
  { shape: 'star', one: 'stella', many: 'stelle', f: true },
  { shape: 'circle', one: 'cerchio', many: 'cerchi', f: false },
  { shape: 'square', one: 'quadrato', many: 'quadrati', f: false },
  { shape: 'triangle', one: 'triangolo', many: 'triangoli', f: false },
  { shape: 'heart', one: 'cuore', many: 'cuori', f: false },
  { shape: 'diamond', one: 'rombo', many: 'rombi', f: false },
  { shape: 'moon', one: 'luna', many: 'lune', f: true },
  { shape: 'cross', one: 'croce', many: 'croci', f: true },
];

export interface Agr {
  ms: string;
  fs: string;
  mp: string;
  fp: string;
}

export interface ColorInfo extends Agr {
  idx: number; // indice nella PALETTE del renderer
}

/** i nomi e gli accordi dei colori vivono in ../colors: uno solo per tutto il gioco */
export const COLORS: ColorInfo[] = COLOR_FORMS.map((f, idx) => ({ idx, ...f }));

export const FILL_ADJ = {
  solid: { ms: 'pieno', fs: 'piena', mp: 'pieni', fp: 'piene' },
  outline: { ms: 'vuoto', fs: 'vuota', mp: 'vuoti', fp: 'vuote' },
} as const;

export const SIZE_ADJ = {
  big: { ms: 'grande', fs: 'grande', mp: 'grandi', fp: 'grandi' },
  small: { ms: 'piccolo', fs: 'piccola', mp: 'piccoli', fp: 'piccole' },
} as const;

/** accorda un aggettivo con genere (f) e numero (pl) */
export function agr(a: Agr, f: boolean, pl = true): string {
  return pl ? (f ? a.fp : a.mp) : f ? a.fs : a.ms;
}

export const col = (c: ColorInfo, f: boolean, pl = true) => agr(c, f, pl);
export const quanti = (s: ShapeInfo) => (s.f ? 'Quante' : 'Quanti');
export const artPl = (s: ShapeInfo) => (s.f ? 'le' : 'i');
export const unArt = (s: ShapeInfo) => (s.f ? 'una' : 'un');
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * n colori distinti e mai somiglianti fra loro (CONFUSABLE di ../colors).
 * Con quelle esclusioni il massimo ottenibile è 5: le trame che avrebbero
 * bisogno di più colori usano meno righe/colonne, oppure distinguono i simboli
 * anche per forma.
 */
export function pickColors(rng: Rng, n: number): ColorInfo[] {
  return distinctColors(rng, n).map((idx) => COLORS[idx]);
}
