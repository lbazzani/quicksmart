'use client';
// Un pulsante che condivide: foglio di condivisione del telefono se c'è,
// altrimenti appunti. Il resto (testi, link) lo decide chi lo usa.

import { useState } from 'react';
import { useT } from '@/lib/lang';
import { condividi } from '@/lib/share';

export function ShareButton({
  label,
  title,
  text,
  url,
  className = 'btn-primary py-3.5 font-display text-lg',
}: {
  label: string;
  title: string;
  text: string;
  url: string;
  className?: string;
}) {
  const T = useT();
  const [msg, setMsg] = useState('');

  async function share() {
    const esito = await condividi({ title, text, url });
    if (esito === 'copiato') setMsg(T.share.copied);
    else if (esito === 'errore') setMsg(T.share.failed);
    else return;
    setTimeout(() => setMsg(''), 2500);
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={share} className={className}>
        📤 {label}
      </button>
      {msg && <p className="text-center text-xs font-bold text-teal-300">{msg}</p>}
    </div>
  );
}
