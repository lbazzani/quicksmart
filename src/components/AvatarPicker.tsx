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

export const inputCls =
  'rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-lg font-semibold text-stone-100 placeholder:text-stone-500 focus:border-orange-300';
