'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LangSwitch, useT } from '@/lib/lang';
import { api, saveIdentity } from '@/lib/client';
import { AvatarPicker, Field, inputCls } from '@/components/AvatarPicker';
import { SofaiAvatar } from '@/components/SofaiAvatar';
import { ShareButton } from '@/components/ShareButton';
import { numeroSfida } from '@/lib/daily';
import {
  leggiRisultatoSfida,
  linkRisultato,
  leggiUltimoGiocatore,
  refCorrente,
  striscia,
  testoRisultato,
  type RisultatoSfida,
} from '@/lib/share';

export function SfidaClient() {
  const T = useT();
  const router = useRouter();
  // Nel browser, non al render: la pagina è pre-generata alla build e un
  // numero scritto nell'HTML sarebbe quello del giorno della build. A cavallo
  // della mezzanotte decide comunque l'API.
  const [numero, setNumero] = useState<number | null>(null);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🦉');
  const [fatta, setFatta] = useState<RisultatoSfida | null>(null);
  const [rigioca, setRigioca] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // localStorage esiste solo nel browser: si legge dopo il montaggio
  useEffect(() => {
    const n = numeroSfida();
    const io = leggiUltimoGiocatore();
    /* eslint-disable react-hooks/set-state-in-effect -- letture client-only al montaggio */
    setNumero(n);
    if (io) {
      setNickname(io.nickname);
      setAvatar(io.avatar);
    }
    setFatta(leggiRisultatoSfida(n));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function start() {
    setBusy(true);
    setError('');
    const res = await api<{ code: string; playerId: string; token: string }>('/api/game', {
      daily: true,
      ref: refCorrente(),
      nickname,
      avatar,
    });
    if (res.error || !res.code) {
      setError(T.errors.generic);
      setBusy(false);
      return;
    }
    saveIdentity(res.code, { playerId: res.playerId, token: res.token, nickname, avatar });
    router.push(`/g/${res.code}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href="/" className="btn-ghost px-3 py-1.5 text-lg">←</Link>
        <h1 className="min-w-0 flex-1 font-display text-3xl font-extrabold">
          🗓️ {T.daily.title} {numero !== null && <span className="text-amber-300">#{numero}</span>}
        </h1>
        <LangSwitch />
      </header>

      <div className="flex items-center gap-3">
        <SofaiAvatar mood="teasing" size={56} />
        <p className="card flex-1 rounded-bl-sm px-3 py-2 text-sm text-stone-300">{T.daily.subtitle}</p>
      </div>

      {fatta && !rigioca ? (
        <div className="card flex flex-col gap-3 px-4 py-4 text-center">
          <p className="font-display text-xl font-extrabold text-amber-300">
            {T.daily.done.replace('{n}', String(fatta.numero))}
          </p>
          {fatta.esiti.length > 0 && <p className="text-2xl tracking-wider">{striscia(fatta.esiti)}</p>}
          <p className="text-sm font-bold text-stone-300">
            {fatta.giuste}/{fatta.totale} · {fatta.punti} {T.share.points}
          </p>
          <ShareButton
            label={T.share.button}
            title="QuickSmart"
            text={testoRisultato(T.share, fatta)}
            url={linkRisultato(window.location.origin, fatta, 'sfida')}
          />
          <p className="text-xs text-stone-400">{T.daily.comeBack}</p>
          <div className="flex gap-2">
            <button onClick={() => setRigioca(true)} className="btn-ghost flex-1 py-2.5 text-sm font-bold text-stone-200">
              🔁 {T.daily.replay}
            </button>
            <Link href="/solo" className="btn-ghost flex-1 py-2.5 text-center text-sm font-bold text-stone-200">
              🎯 {T.daily.training}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ul className="card flex flex-col gap-1.5 px-4 py-3 text-sm text-stone-300">
            {T.daily.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <Field label={T.new.nickname}>
            <input
              className={inputCls}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={T.new.nicknamePlaceholder}
              maxLength={20}
            />
          </Field>
          <Field label={T.new.avatar}>
            <AvatarPicker value={avatar} onChange={setAvatar} />
          </Field>
          {error && <p className="text-sm font-bold text-rose-400">{error}</p>}
          <button onClick={start} disabled={busy || !nickname.trim()} className="btn-primary mt-2 py-4 font-display text-xl">
            {busy ? T.new.creating : `⚡ ${T.daily.startBtn}`}
          </button>
        </>
      )}
    </main>
  );
}
