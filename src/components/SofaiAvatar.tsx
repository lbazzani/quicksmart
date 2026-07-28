'use client';
// SofAI: la mascotte del gioco. Ragazza bionda, viso rotondo, occhiali tondi.
// Disegnata in SVG con espressioni diverse per ogni "mood".

import type { SofiaMood } from '@/lib/types';

const SKIN = '#fde3c8';
const SKIN_EDGE = '#f0b98d';
const HAIR = '#fcd34d';
const HAIR_EDGE = '#f59e0b';
const FRAME = '#7c3aed';

function Eyes({ mood }: { mood: SofiaMood }) {
  switch (mood) {
    case 'wow':
      return (
        <>
          <circle cx={44} cy={62} r={5.5} fill="#1e293b" />
          <circle cx={76} cy={62} r={5.5} fill="#1e293b" />
          <circle cx={46} cy={60} r={2} fill="#fff" />
          <circle cx={78} cy={60} r={2} fill="#fff" />
        </>
      );
    case 'teasing': // occhiolino
      return (
        <>
          <circle cx={44} cy={62} r={4.5} fill="#1e293b" />
          <circle cx={45.5} cy={60.5} r={1.6} fill="#fff" />
          <path d="M70 62 Q76 65 82 62" stroke="#1e293b" strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      );
    case 'thinking': // occhi in su
      return (
        <>
          <circle cx={44} cy={59} r={4.5} fill="#1e293b" />
          <circle cx={76} cy={59} r={4.5} fill="#1e293b" />
          <circle cx={45} cy={57.5} r={1.6} fill="#fff" />
          <circle cx={77} cy={57.5} r={1.6} fill="#fff" />
        </>
      );
    case 'sad':
      return (
        <>
          <circle cx={44} cy={63} r={4.5} fill="#1e293b" />
          <circle cx={76} cy={63} r={4.5} fill="#1e293b" />
          <path d="M37 55 Q43 52 49 55" stroke="#b45309" strokeWidth={2.5} fill="none" strokeLinecap="round" transform="rotate(8 43 54)" />
          <path d="M71 55 Q77 52 83 55" stroke="#b45309" strokeWidth={2.5} fill="none" strokeLinecap="round" transform="rotate(-8 77 54)" />
        </>
      );
    default: // happy
      return (
        <>
          <circle cx={44} cy={62} r={4.8} fill="#1e293b" />
          <circle cx={76} cy={62} r={4.8} fill="#1e293b" />
          <circle cx={45.5} cy={60.5} r={1.8} fill="#fff" />
          <circle cx={77.5} cy={60.5} r={1.8} fill="#fff" />
        </>
      );
  }
}

function Mouth({ mood }: { mood: SofiaMood }) {
  switch (mood) {
    case 'wow':
      return <ellipse cx={60} cy={84} rx={7} ry={9} fill="#7f1d1d" stroke="#1e293b" strokeWidth={2} />;
    case 'teasing':
      return <path d="M50 84 Q60 92 72 82" stroke="#1e293b" strokeWidth={3.5} fill="none" strokeLinecap="round" />;
    case 'thinking':
      return <path d="M53 86 Q60 84 67 86" stroke="#1e293b" strokeWidth={3.5} fill="none" strokeLinecap="round" />;
    case 'sad':
      return <path d="M50 88 Q60 80 70 88" stroke="#1e293b" strokeWidth={3.5} fill="none" strokeLinecap="round" />;
    default:
      return <path d="M48 82 Q60 94 72 82" stroke="#1e293b" strokeWidth={3.5} fill="none" strokeLinecap="round" />;
  }
}

export function SofaiAvatar({ mood = 'happy', size = 72 }: { mood?: SofiaMood; size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-label="SofAI">
      {/* codine */}
      <circle cx={13} cy={66} r={13} fill={HAIR} stroke={HAIR_EDGE} strokeWidth={2.5} />
      <circle cx={107} cy={66} r={13} fill={HAIR} stroke={HAIR_EDGE} strokeWidth={2.5} />
      <circle cx={20} cy={54} r={4} fill="#f472b6" />
      <circle cx={100} cy={54} r={4} fill="#f472b6" />
      {/* chioma dietro */}
      <path d="M60 8 C28 8 16 32 18 56 C19 70 24 78 28 80 L28 52 C34 34 46 26 60 26 C74 26 86 34 92 52 L92 80 C96 78 101 70 102 56 C104 32 92 8 60 8 Z" fill={HAIR} stroke={HAIR_EDGE} strokeWidth={2.5} strokeLinejoin="round" />
      {/* viso rotondo */}
      <circle cx={60} cy={64} r={34} fill={SKIN} stroke={SKIN_EDGE} strokeWidth={2.5} />
      {/* frangetta */}
      <path d="M28 52 C30 30 44 22 60 22 C76 22 90 30 92 52 C82 44 76 40 60 40 C44 40 38 44 28 52 Z" fill={HAIR} stroke={HAIR_EDGE} strokeWidth={2.5} strokeLinejoin="round" />
      {/* guanciotte */}
      <circle cx={35} cy={74} r={5.5} fill="#fda4af" opacity={0.65} />
      <circle cx={85} cy={74} r={5.5} fill="#fda4af" opacity={0.65} />
      {/* occhiali tondi */}
      <circle cx={44} cy={62} r={12.5} fill="rgba(186,230,253,0.18)" stroke={FRAME} strokeWidth={3.5} />
      <circle cx={76} cy={62} r={12.5} fill="rgba(186,230,253,0.18)" stroke={FRAME} strokeWidth={3.5} />
      <path d="M56.5 62 Q60 58.5 63.5 62" stroke={FRAME} strokeWidth={3.5} fill="none" />
      <line x1={31.5} y1={60} x2={26.5} y2={57} stroke={FRAME} strokeWidth={3.5} strokeLinecap="round" />
      <line x1={88.5} y1={60} x2={93.5} y2={57} stroke={FRAME} strokeWidth={3.5} strokeLinecap="round" />
      <Eyes mood={mood} />
      <Mouth mood={mood} />
      {/* naso */}
      <circle cx={60} cy={72} r={2.4} fill={SKIN_EDGE} />
    </svg>
  );
}
