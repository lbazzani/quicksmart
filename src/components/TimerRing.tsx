'use client';
// Anello del tempo: countdown circolare sincronizzato con l'orologio server.

import { useEffect, useRef, useState } from 'react';

export function TimerRing({
  endsAt,
  durationMs,
  offset,
  size = 64,
  stroke = '#2dd4bf', // verde acqua: il tempo è il dettaglio freddo della tavolozza
  showSeconds = true,
}: {
  /** timestamp server di scadenza */
  endsAt: number;
  durationMs: number;
  /** serverNow - clientNow */
  offset: number;
  size?: number;
  stroke?: string;
  showSeconds?: boolean;
}) {
  const [remaining, setRemaining] = useState(() => endsAt - (Date.now() + offset));
  const raf = useRef(0);

  useEffect(() => {
    const loop = () => {
      setRemaining(endsAt - (Date.now() + offset));
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [endsAt, offset]);

  const frac = Math.max(0, Math.min(1, remaining / durationMs));
  const r = 42;
  const circ = 2 * Math.PI * r;
  const urgent = frac < 0.25;
  const color = urgent ? '#fb7185' : stroke; // il rosso dell'ultimo quarto non si tocca
  const secs = Math.max(0, Math.ceil(remaining / 1000));

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={urgent ? 'animate-pulse' : ''}>
      <circle cx={50} cy={50} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={9} />
      <circle
        cx={50}
        cy={50}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - frac)}
        transform="rotate(-90 50 50)"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
      {showSeconds && (
        <text x={50} y={62} textAnchor="middle" fontSize={34} fontWeight={800} fill="#f7efe6" className="font-display">
          {secs}
        </text>
      )}
    </svg>
  );
}
