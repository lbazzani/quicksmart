'use client';

import { AVATARS } from '@/lib/client';

export function AvatarPicker({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          className={`aspect-square rounded-xl text-2xl transition-transform active:scale-90 ${
            value === a ? 'bg-orange-400/25 ring-2 ring-orange-300' : 'bg-white/5'
          }`}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-bold text-stone-300">{label}</span>
      {children}
    </div>
  );
}

export function Segmented<T extends string | number | null>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-xl px-2 py-2.5 font-display text-sm font-bold transition-colors ${
            value === o.value ? 'bg-orange-400/25 text-orange-100 ring-2 ring-orange-300' : 'bg-white/5 text-stone-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Contatore con − e +: la scelta fine che i preset non coprono (es. 7 round).
 * Bersagli da 44px: si regola col pollice senza mirare.
 */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="meno"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        className="btn-ghost h-11 w-11 shrink-0 font-display text-2xl font-extrabold disabled:opacity-35"
      >
        −
      </button>
      <span className="flex-1 rounded-xl bg-white/5 py-2 text-center font-display text-xl font-extrabold text-orange-200">
        {value}
      </span>
      <button
        type="button"
        aria-label="più"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        className="btn-ghost h-11 w-11 shrink-0 font-display text-2xl font-extrabold disabled:opacity-35"
      >
        +
      </button>
    </div>
  );
}

/** Interruttore on/off con etichetta e spiegazione: un tocco su tutta la riga. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-stone-200">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-stone-400">{hint}</span>}
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-orange-400' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </span>
    </button>
  );
}

export const inputCls =
  'rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-lg font-semibold text-stone-100 placeholder:text-stone-500 focus:border-orange-300';
