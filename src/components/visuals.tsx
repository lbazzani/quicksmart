'use client';
// Renderer SVG del linguaggio visuale delle domande (vedi src/lib/types.ts).
// Tutto dichiarativo: nessuna immagine, solo SVG nitido su ogni schermo.

import type {
  CellSpec,
  ChoiceVisual,
  ClockSpec,
  CountedShapes,
  DominoTile,
  FlagColorName,
  FlagSpec,
  ShapeSpec,
  VisualPayload,
} from '@/lib/types';
import { useLoc } from '@/lib/lang';

/** I colori delle figure. I nomi italiani stanno in src/lib/colors.ts, nello stesso ordine. */
export const PALETTE = [
  '#f97316', // 0 arancione — il colore guida
  '#fbbf24', // 1 giallo
  '#14b8a6', // 2 verde acqua
  '#f472b6', // 3 rosa
  '#4ade80', // 4 verde
  '#ef4444', // 5 rosso
  '#38bdf8', // 6 azzurro
  '#f5f0e8', // 7 panna
];

/**
 * Colori delle bandiere (src/lib/questions/flags.ts): una tavolozza a parte
 * da PALETTE, che è tarata per i puzzle di logica (pastello, leggibile a
 * 56px) e non ha un blu vero né un bianco/nero puri — proprio i colori che
 * una bandiera deve avere per essere riconoscibile.
 */
const FLAG_HEX: Record<FlagColorName, string> = {
  red: '#d21f26',
  white: '#f4efe6',
  blue: '#1f3a8f',
  lightblue: '#4aa3df',
  green: '#0f8a3c',
  yellow: '#f7c600',
  black: '#171310',
  orange: '#f97316',
};

/**
 * L'"arredo" delle figure: cornici, punti interrogativi, aste delle bilance,
 * tessere del domino, segni di operazione. Deve restare NEUTRO e caldo — i
 * colori di PALETTE portano significato (le domande li nominano a voce), quindi
 * qui dentro non entrano mai. Prima era una scala grigio-blu che sul fondo
 * bruno sembrava azzurrina.
 */
const INK = {
  dark: '#231a14', // inchiostro sui fondi chiari: pallini di dadi e domino
  tile: '#f7efe6', // avorio delle tessere e dei dadi
  line: '#a89b90', // aste, bordi, lancette secondarie
  faint: '#8a7d70', // tratteggio e "?" delle celle da indovinare
  label: '#cabcae', // segni (= + → ↴) ed etichette
  focus: '#fbbf24', // l'unico accento: "l'esempio da guardare"
} as const;

function starPoints(cx: number, cy: number, outer: number, inner: number, n = 5): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}

function polyPoints(cx: number, cy: number, r: number, n: number, startDeg = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}

/** Disegna una ShapeSpec in un box 100×100 (centro 50,50). */
export function Shape({ spec }: { spec: ShapeSpec }) {
  const color = PALETTE[(spec.color ?? 0) % PALETTE.length];
  const size = spec.size ?? 0.8;
  const fillMode = spec.fillMode ?? 'solid';
  const fill = fillMode === 'outline' ? 'none' : color;
  const stroke = color;
  const sw = fillMode === 'outline' ? 7 : 3;
  const gid = `h${color.slice(1)}`;

  let el: React.ReactNode;
  const common = { fill: fillMode === 'half' ? `url(#${gid})` : fill, stroke, strokeWidth: sw, strokeLinejoin: 'round' as const };
  switch (spec.shape) {
    case 'circle':
      el = <circle cx={50} cy={50} r={40} {...common} />;
      break;
    case 'dot':
      el = <circle cx={50} cy={50} r={16} {...common} />;
      break;
    case 'square':
      el = <rect x={13} y={13} width={74} height={74} rx={8} {...common} />;
      break;
    case 'triangle':
      el = <polygon points="50,8 92,84 8,84" {...common} />;
      break;
    case 'diamond':
      el = <polygon points="50,5 95,50 50,95 5,50" {...common} />;
      break;
    case 'star':
      el = <polygon points={starPoints(50, 52, 45, 19)} {...common} />;
      break;
    case 'pentagon':
      el = <polygon points={polyPoints(50, 52, 44, 5)} {...common} />;
      break;
    case 'hexagon':
      el = <polygon points={polyPoints(50, 50, 44, 6, -60)} {...common} />;
      break;
    case 'arrow':
      // freccia verso destra a rot=0
      el = <polygon points="8,38 54,38 54,20 92,50 54,80 54,62 8,62" {...common} />;
      break;
    case 'heart':
      el = (
        <path
          d="M50 88 C20 64 8 46 8 32 C8 18 20 10 31 10 C40 10 47 16 50 23 C53 16 60 10 69 10 C80 10 92 18 92 32 C92 46 80 64 50 88 Z"
          {...common}
        />
      );
      break;
    case 'cross':
      el = <polygon points="35,8 65,8 65,35 92,35 92,65 65,65 65,92 35,92 35,65 8,65 8,35 35,35" {...common} />;
      break;
    case 'moon':
      el = <path d="M62 8 A44 44 0 1 0 62 92 A34 34 0 1 1 62 8 Z" {...common} />;
      break;
    default:
      el = <circle cx={50} cy={50} r={40} {...common} />;
  }

  // flip = immagine specchiata (dopo la rotazione propria della forma)
  const transforms: string[] = [];
  if (spec.flip) transforms.push('translate(100 0) scale(-1 1)');
  if (spec.rot) transforms.push(`rotate(${spec.rot} 50 50)`);
  const scaled = `translate(50 50) scale(${size}) translate(-50 -50)`;

  return (
    <g transform={scaled}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="50%" stopColor={color} />
          <stop offset="50%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <g transform={transforms.join(' ') || undefined}>{el}</g>
    </g>
  );
}

/** Linea di piega tratteggiata sopra una cella (tipo "foglio piegato"). */
function Crease({ dir }: { dir: NonNullable<CellSpec['crease']> }) {
  const coords: Record<string, [number, number, number, number]> = {
    V: [50, 4, 50, 96],
    H: [4, 50, 96, 50],
    D: [6, 6, 94, 94],
    A: [94, 6, 6, 94],
  };
  const [x1, y1, x2, y2] = coords[dir];
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="#fbbf24"
      strokeWidth={3}
      strokeDasharray="7 5"
      strokeLinecap="round"
      opacity={0.95}
    />
  );
}

/**
 * Una cella 100×100: 1 forma centrata, o più forme in griglia/fila.
 * Con `fluid` la cella si restringe con lo schermo (fino a `size` al massimo):
 * sui telefoni stretti una riga da 5 celle fisse usciva dal bordo.
 */
export function Cell({ cell, size = 76, fluid = false }: { cell: CellSpec; size?: number; fluid?: boolean }) {
  const loc = useLoc();
  const n = cell.shapes.length;
  let content: React.ReactNode;
  if (cell.unknown || n === 0) {
    content = (
      <text x={50} y={66} textAnchor="middle" fontSize={48} fontWeight={800} fill={INK.faint}>
        ?
      </text>
    );
  } else if (n === 1 && cell.layout !== 'row' && cell.layout !== 'grid') {
    content = <Shape spec={cell.shapes[0]} />;
  } else if (cell.layout === 'row') {
    // Le forme in fila devono starci TUTTE INTERE: il viewBox è 0..100 e quello
    // che sborda viene tagliato via. Con tre elementi un minimo di larghezza le
    // faceva uscire dal riquadro, amputando le due esterne di oltre un terzo.
    // Per la leggibilità si ingrandisce la cella (vedi ChoiceView), non le forme.
    const s = 100 / n;
    content = cell.shapes.map((sp, i) => (
      <g key={i} transform={`translate(${i * s} ${(100 - s) / 2}) scale(${s / 100})`}>
        <Shape spec={sp} />
      </g>
    ));
  } else {
    // griglia row-major: per 4 forme = [alto-sx, alto-dx, basso-sx, basso-dx]
    const cols = n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const s = 100 / Math.max(cols, rows);
    const ox = (100 - cols * s) / 2;
    const oy = (100 - rows * s) / 2;
    content = cell.shapes.map((sp, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return (
        <g key={i} transform={`translate(${ox + c * s} ${oy + r * s}) scale(${s / 100})`}>
          <Shape spec={sp} />
        </g>
      );
    });
  }
  const svg = (
    <svg
      viewBox="0 0 100 100"
      width={fluid ? undefined : size}
      height={fluid ? undefined : size}
      style={fluid ? { width: '100%', maxWidth: size, height: 'auto', aspectRatio: '1 / 1' } : undefined}
      className="shrink-0"
    >
      <rect
        x={2}
        y={2}
        width={96}
        height={96}
        rx={14}
        fill={
          cell.dim
            ? 'rgba(255,255,255,0.015)'
            : cell.highlight
              ? 'rgba(251,191,36,0.12)'
              : 'rgba(255,255,255,0.04)'
        }
        stroke={cell.highlight ? INK.focus : cell.unknown ? INK.faint : 'rgba(255,255,255,0.14)'}
        strokeWidth={2}
        strokeDasharray={cell.unknown ? '7 6' : undefined}
      />
      <g opacity={cell.dim ? 0.32 : 1}>{content}</g>
      {cell.crease && <Crease dir={cell.crease} />}
    </svg>
  );
  if (!cell.label) return svg;
  return (
    <div className={`flex flex-col items-center gap-0.5 ${fluid ? 'w-full min-w-0' : ''}`}>
      <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{loc(cell.label)}</span>
      {svg}
    </div>
  );
}

/** Una tessera del domino: due metà con i pallini, come quelle vere. */
export function Domino({ tile, size = 62 }: { tile: DominoTile; size?: number }) {
  if (tile.unknown) {
    return (
      <svg viewBox="0 0 100 52" width={size * 1.9} height={size} className="shrink-0">
        <rect x={2} y={2} width={96} height={48} rx={8} fill="rgba(255,255,255,0.04)" stroke={INK.faint} strokeWidth={2.5} strokeDasharray="7 6" />
        <text x={50} y={38} textAnchor="middle" fontSize={30} fontWeight={800} fill={INK.faint}>?</text>
      </svg>
    );
  }
  const pips = (n: number, dx: number) =>
    (PIP_POS[n] ?? []).map(([x, y], i) => (
      <circle key={i} cx={dx + x * 0.42} cy={4 + y * 0.44} r={4} fill={INK.dark} />
    ));
  return (
    <svg viewBox="0 0 100 52" width={size * 1.9} height={size} className="shrink-0">
      <rect
        x={2}
        y={2}
        width={96}
        height={48}
        rx={8}
        fill={tile.highlight ? '#fdf0cf' : INK.tile}
        stroke={tile.highlight ? INK.focus : INK.line}
        strokeWidth={2.5}
      />
      <line x1={50} y1={7} x2={50} y2={45} stroke={INK.line} strokeWidth={2} />
      {pips(tile.a, 5)}
      {pips(tile.b, 53)}
    </svg>
  );
}

export function Clock({ clock, size = 110 }: { clock: ClockSpec; size?: number }) {
  const loc = useLoc();
  const hourAngle = (clock.h % 12) * 30 + clock.m * 0.5;
  const minAngle = clock.m * 6;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const r1 = i % 3 === 0 ? 34 : 38;
    return (
      <line
        key={i}
        x1={50 + r1 * Math.sin(a)}
        y1={50 - r1 * Math.cos(a)}
        x2={50 + 42 * Math.sin(a)}
        y2={50 - 42 * Math.cos(a)}
        stroke={INK.label}
        strokeWidth={i % 3 === 0 ? 3 : 1.6}
        strokeLinecap="round"
      />
    );
  });
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {clock.unknown ? (
          <>
            <circle cx={50} cy={50} r={46} fill="rgba(255,255,255,0.04)" stroke={INK.faint} strokeWidth={2.5} strokeDasharray="7 6" />
            <text x={50} y={64} textAnchor="middle" fontSize={40} fontWeight={800} fill={INK.faint}>?</text>
          </>
        ) : (
          <g transform={clock.mirrored ? 'translate(100 0) scale(-1 1)' : undefined}>
            <circle cx={50} cy={50} r={46} fill="#241a13" stroke={INK.focus} strokeWidth={2.5} />
            {ticks}
            <line x1={50} y1={50} x2={50 + 22 * Math.sin((hourAngle * Math.PI) / 180)} y2={50 - 22 * Math.cos((hourAngle * Math.PI) / 180)} stroke={INK.tile} strokeWidth={5} strokeLinecap="round" />
            <line x1={50} y1={50} x2={50 + 34 * Math.sin((minAngle * Math.PI) / 180)} y2={50 - 34 * Math.cos((minAngle * Math.PI) / 180)} stroke="#f472b6" strokeWidth={3} strokeLinecap="round" />
            <circle cx={50} cy={50} r={3.5} fill={INK.tile} />
          </g>
        )}
      </svg>
      {clock.label && <span className="text-xs text-stone-400">{loc(clock.label)}</span>}
      {clock.mirrored && !clock.unknown && <span className="text-lg">🪞</span>}
    </div>
  );
}

/** Una bandiera nazionale semplificata: bande piatte o un disco centrato. */
export function Flag({ flag, width = 160 }: { flag: FlagSpec; width?: number }) {
  const w = 150;
  const h = 100;
  let content: React.ReactNode;
  if (flag.kind === 'bands') {
    const n = flag.colors.length;
    const step = flag.dir === 'h' ? h / n : w / n;
    content = flag.colors.map((c, i) =>
      flag.dir === 'h' ? (
        <rect key={i} x={0} y={i * step} width={w} height={step} fill={FLAG_HEX[c]} />
      ) : (
        <rect key={i} x={i * step} y={0} width={step} height={h} fill={FLAG_HEX[c]} />
      )
    );
  } else if (flag.kind === 'disc') {
    content = (
      <>
        <rect x={0} y={0} width={w} height={h} fill={FLAG_HEX[flag.field]} />
        <circle cx={w / 2} cy={h / 2} r={h * 0.3} fill={FLAG_HEX[flag.disc]} />
      </>
    );
  } else {
    // croce nordica: spostata verso l'asta (mai centrata, altrimenti è una
    // croce greca), con una fimbriatura opzionale (il bordo sottile intorno
    // alla croce, come in Norvegia/Islanda) disegnata PRIMA e più larga.
    const vx = w * 0.35;
    const barW = h * 0.24;
    const barH = h * 0.5;
    const fim = flag.fimbriation ? h * 0.06 : 0;
    content = (
      <>
        <rect x={0} y={0} width={w} height={h} fill={FLAG_HEX[flag.field]} />
        {flag.fimbriation && (
          <>
            <rect x={vx - barW / 2 - fim} y={0} width={barW + fim * 2} height={h} fill={FLAG_HEX[flag.fimbriation]} />
            <rect x={0} y={h / 2 - barH / 2 - fim} width={w} height={barH + fim * 2} fill={FLAG_HEX[flag.fimbriation]} />
          </>
        )}
        <rect x={vx - barW / 2} y={0} width={barW} height={h} fill={FLAG_HEX[flag.cross]} />
        <rect x={0} y={h / 2 - barH / 2} width={w} height={barH} fill={FLAG_HEX[flag.cross]} />
      </>
    );
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={width} height={(width * h) / w} className="mx-auto shrink-0 drop-shadow-lg">
      {content}
      <rect x={1} y={1} width={w - 2} height={h - 2} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={2} />
    </svg>
  );
}

function DiceStack({ grid }: { grid: number[][] }) {
  const w = 20; // semi-larghezza cubo
  const hh = w / 2;
  const v = w * 0.95;
  type Cube = { x: number; y: number; key: string; order: number };
  const cubes: Cube[] = [];
  grid.forEach((row, r) =>
    row.forEach((height, c) => {
      for (let z = 0; z < height; z++) {
        cubes.push({
          x: (c - r) * w,
          y: (c + r) * hh - z * v,
          key: `${r}-${c}-${z}`,
          order: (c + r) * 100 + z,
        });
      }
    })
  );
  cubes.sort((a, b) => a.order - b.order);
  const xs = cubes.flatMap((k) => [k.x - w, k.x + w]);
  const ys = cubes.flatMap((k) => [k.y - hh, k.y + hh + v]);
  const minX = Math.min(...xs, 0) - 6;
  const minY = Math.min(...ys, 0) - 6;
  const vbW = Math.max(...xs, 0) - minX + 12;
  const vbH = Math.max(...ys, 0) - minY + 12;
  return (
    <svg viewBox={`${minX} ${minY} ${vbW} ${vbH}`} width={Math.min(300, vbW * 2.2)} className="mx-auto">
      {cubes.map(({ x, y, key }) => (
        <g key={key} stroke={INK.dark} strokeWidth={1.2} strokeLinejoin="round">
          <polygon points={`${x},${y - hh} ${x + w},${y} ${x},${y + hh} ${x - w},${y}`} fill="#fcd34d" />
          <polygon points={`${x - w},${y} ${x},${y + hh} ${x},${y + hh + v} ${x - w},${y + v}`} fill="#b45309" />
          <polygon points={`${x + w},${y} ${x},${y + hh} ${x},${y + hh + v} ${x + w},${y + v}`} fill="#f59e0b" />
        </g>
      ))}
    </svg>
  );
}

const PIP_POS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 70], [70, 30]],
  3: [[28, 72], [50, 50], [72, 28]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
};

export function PipFace({ n, size = 56, accent = false }: { n: number; size?: number; accent?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <rect x={4} y={4} width={92} height={92} rx={16} fill={accent ? 'rgba(244,114,182,0.15)' : INK.tile} stroke={accent ? '#f472b6' : INK.line} strokeWidth={3} />
      {(PIP_POS[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={9} fill={accent ? '#f472b6' : INK.dark} />
      ))}
    </svg>
  );
}

function DiceNet({ net }: { net: (number | null)[][] }) {
  return (
    <div className="mx-auto w-fit">
      {net.map((row, r) => (
        <div key={r} className="flex">
          {row.map((cellVal, c) => (
            <div key={c} className="h-14 w-14 p-0.5">
              {cellVal != null && <PipFace n={cellVal} size={52} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PanShapes({ items }: { items: CountedShapes[] }) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center">
          {/* con più gruppi sullo stesso piatto il "+" evita di leggerli come un unico blocco */}
          {i > 0 && <span className="px-0.5 text-sm font-bold text-stone-300">+</span>}
          {it.count <= 3 ? (
            Array.from({ length: it.count }, (_, k) => (
              <svg key={k} viewBox="0 0 100 100" width={26} height={26}>
                <Shape spec={{ shape: it.shape, color: it.color }} />
              </svg>
            ))
          ) : (
            <span className="flex items-center text-sm font-bold text-stone-200">
              {it.count}×
              <svg viewBox="0 0 100 100" width={26} height={26}>
                <Shape spec={{ shape: it.shape, color: it.color }} />
              </svg>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BalanceScales({ scales }: { scales: { left: CountedShapes[]; right: CountedShapes[]; tilt: -1 | 0 | 1 }[] }) {
  return (
    <div className="flex flex-col items-center gap-3">
      {scales.map((s, i) => {
        const angle = s.tilt * 7;
        return (
          <div key={i} className="relative h-[104px] w-[290px]">
            {/* fulcro */}
            <svg viewBox="0 0 290 104" width={290} height={104} className="absolute inset-0">
              <polygon points="145,58 132,96 158,96" fill="#6b5d52" />
              <rect x={98} y={96} width={94} height={5} rx={2.5} fill="#6b5d52" />
              <g transform={`rotate(${angle} 145 56)`}>
                <rect x={25} y={53} width={240} height={6} rx={3} fill={INK.line} />
                <line x1={45} y1={56} x2={45} y2={72} stroke={INK.line} strokeWidth={3} />
                <line x1={245} y1={56} x2={245} y2={72} stroke={INK.line} strokeWidth={3} />
              </g>
            </svg>
            {/* piatti (in HTML per contenere le forme) */}
            <div
              className="absolute flex h-11 w-[108px] items-center justify-center rounded-xl border border-white/20 bg-white/5"
              style={{ left: 0, top: 62 + s.tilt * 14 }}
            >
              <PanShapes items={s.left} />
            </div>
            <div
              className="absolute flex h-11 w-[108px] items-center justify-center rounded-xl border border-white/20 bg-white/5"
              style={{ right: 0, top: 62 - s.tilt * 14 }}
            >
              <PanShapes items={s.right} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EquationRows({ rows }: { rows: { items: (ShapeSpec | string)[]; result: number | string }[] }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-4 py-1.5">
          {row.items.map((it, k) =>
            typeof it === 'string' ? (
              <span key={k} className="font-display text-2xl font-bold text-stone-300">
                {it === 'x' ? '×' : it}
              </span>
            ) : (
              <svg key={k} viewBox="0 0 100 100" width={40} height={40}>
                <Shape spec={it} />
              </svg>
            )
          )}
          <span className="font-display text-2xl font-bold text-stone-300">=</span>
          <span className={`font-display text-2xl font-extrabold ${row.result === '?' ? 'text-amber-300' : 'text-stone-100'}`}>
            {row.result}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Renderer principale del payload della domanda. */
export function QuestionView({ payload }: { payload: VisualPayload }) {
  switch (payload.kind) {
    case 'cells': {
      const cols = Math.max(...payload.rows.map((r) => r.length));
      const cellSize = cols >= 5 ? 56 : cols === 4 ? 66 : cols === 3 ? 82 : 92;
      // le griglie semplici (senza frecce fra le celle) sono FLUIDE: su un
      // telefono stretto le celle si restringono invece di uscire dal bordo
      const fluid = !payload.arrows && !payload.analogy && !payload.wrapSequence;
      return (
        <div className={`flex w-full flex-col items-center ${payload.groups ? 'gap-2.5' : 'gap-2'}`}>
          {payload.rows.map((row, ri) =>
            fluid ? (
              <div
                key={ri}
                className={`grid w-full max-w-md justify-center gap-1.5 ${
                  payload.groups ? 'rounded-2xl border border-white/12 bg-white/[0.03] px-2 py-1.5' : ''
                }`}
                style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, ${cellSize}px))` }}
              >
                {row.map((cell, ci) => (
                  <Cell key={ci} cell={cell} size={cellSize} fluid />
                ))}
              </div>
            ) : (
              <div key={ri} className="flex items-center gap-1.5">
                {row.map((cell, ci) => (
                  <div key={ci} className="flex items-center gap-1.5">
                    {ci > 0 && (payload.arrows || payload.analogy) && (
                      <span className="font-display text-xl text-stone-500">{payload.analogy ? '➜' : '→'}</span>
                    )}
                    <Cell cell={cell} size={cellSize} />
                  </div>
                ))}
                {/* la sequenza continua sulla riga sotto: senza questo segno le
                    righe si leggono come una matrice invece che come una catena */}
                {payload.wrapSequence && ri < payload.rows.length - 1 && (
                  <span className="font-display text-xl text-stone-500">↴</span>
                )}
              </div>
            )
          )}
        </div>
      );
    }
    case 'dominoes': {
      // le tessere sono larghe il doppio dell'altezza: rimpiccioliscono quanto
      // serve perché la fila resti su UNA riga (una fila spezzata si legge come
      // due file diverse)
      const n = payload.tiles.length;
      const size = n <= 3 ? 56 : n === 4 ? 46 : n === 5 ? 38 : n === 6 ? 32 : 27;
      return (
        <div className="flex items-center justify-center gap-1">
          {payload.tiles.map((t, i) => (
            <Domino key={i} tile={t} size={size} />
          ))}
        </div>
      );
    }
    case 'numbers':
      return (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {payload.seq.map((n, i) => (
            <span
              key={i}
              className={`font-display min-w-12 rounded-xl border px-3 py-2 text-center text-2xl font-extrabold ${
                n === '?'
                  ? 'border-amber-400 bg-amber-400/10 text-amber-300'
                  : 'border-white/15 bg-white/5 text-stone-100'
              }`}
            >
              {n}
            </span>
          ))}
        </div>
      );
    case 'clock':
      return (
        <div className="flex items-center justify-center gap-4">
          {payload.clocks.map((c, i) => (
            <Clock key={i} clock={c} size={payload.clocks.length > 1 ? 96 : 130} />
          ))}
        </div>
      );
    case 'dicestack':
      return <DiceStack grid={payload.grid} />;
    case 'dicenet':
      return <DiceNet net={payload.net} />;
    case 'balance':
      return <BalanceScales scales={payload.scales} />;
    case 'equation':
      return <EquationRows rows={payload.rows} />;
    case 'flag':
      return <Flag flag={payload.flag} width={200} />;
    default:
      return null;
  }
}

/** Renderer di una singola opzione di risposta. */
export function ChoiceView({ choice }: { choice: ChoiceVisual }) {
  const loc = useLoc();
  switch (choice.kind) {
    case 'cell': {
      // una fila di tre forme in una cella da 72px le rende minuscole: la cella
      // cresce, così ogni forma resta leggibile e per intero. Fluida: sui
      // telefoni stretti si adatta alla colonna invece di sbordare.
      const affollata = choice.cell.layout === 'row' && choice.cell.shapes.length >= 3;
      return <Cell cell={choice.cell} size={affollata ? 96 : 72} fluid />;
    }
    case 'clock':
      return <Clock clock={choice.clock} size={76} />;
    case 'domino':
      return <Domino tile={choice.tile} size={40} />;
    case 'text': {
      // le risposte testuali possono essere parole lunghe ("pentagono") o
      // espressioni ("1 h 25 min"): rimpiccioliscono invece di uscire dal bordo.
      // Taglie riviste verso l'alto dopo i test in famiglia: si gioca dal telefono
      const text = loc(choice.text);
      const n = text.length;
      const size = n <= 4 ? 'text-3xl' : n <= 7 ? 'text-2xl' : n <= 11 ? 'text-lg' : 'text-base';
      return (
        <span className={`font-display w-full break-words px-0.5 text-center font-extrabold leading-tight ${size}`}>
          {text}
        </span>
      );
    }
    default:
      return null;
  }
}
