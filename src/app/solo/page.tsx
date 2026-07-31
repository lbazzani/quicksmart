'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/lang';
import { api, saveIdentity } from '@/lib/client';
import { AvatarPicker, Field, Segmented, Stepper, inputCls } from '@/components/AvatarPicker';
import { SofaiAvatar } from '@/components/SofaiAvatar';
import type { GamePack } from '@/lib/types';

export default function SoloPage() {
  const T = useT();
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🦄');
  const [pack, setPack] = useState<GamePack>('logic');
  const [rounds, setRounds] = useState<number>(10);
  const [decisionSec, setDecisionSec] = useState(20);
  const [answerSec, setAnswerSec] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ code: string; playerId: string; token: string }>('/api/game', {
        nickname,
        avatar,
        mode: 'solo',
        pack,
        roundsTotal: rounds,
        buzzWindowSec: decisionSec,
        answerSec,
      });
      if (res.error) throw new Error(res.error);
      saveIdentity(res.code, { playerId: res.playerId, token: res.token, nickname, avatar });
      router.push(`/g/${res.code}`);
    } catch {
      setError(T.errors.generic);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href="/" className="btn-ghost px-3 py-1.5 text-lg">←</Link>
        <h1 className="font-display text-3xl font-extrabold">🎯 {T.solo.title}</h1>
      </header>

      <div className="flex items-center gap-3">
        <SofaiAvatar mood="teasing" size={56} />
        <p className="card flex-1 rounded-bl-sm px-3 py-2 text-sm text-stone-300">{T.solo.subtitle}</p>
      </div>

      <Field label={T.new.nickname}>
        <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={T.new.nicknamePlaceholder} maxLength={20} />
      </Field>
      <Field label={T.new.avatar}>
        <AvatarPicker value={avatar} onChange={setAvatar} />
      </Field>
      <Field label={T.new.pack}>
        <Segmented
          options={[
            { label: T.new.packLogic, value: 'logic' as GamePack },
            { label: T.new.packFlags, value: 'flags' as GamePack },
          ]}
          value={pack}
          onChange={setPack}
        />
        {pack === 'flags' && <span className="text-xs text-stone-400">{T.new.packFlagsHint}</span>}
      </Field>
      <Field label={T.new.rounds}>
        <Segmented
          options={[{ label: '5', value: 5 }, { label: '10', value: 10 }, { label: '15', value: 15 }]}
          value={rounds}
          onChange={setRounds}
        />
        <Stepper value={rounds} onChange={setRounds} min={3} max={30} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={T.solo.decisionTime}>
          <Segmented
            options={[{ label: '10', value: 10 }, { label: '20', value: 20 }, { label: '30', value: 30 }]}
            value={decisionSec}
            onChange={setDecisionSec}
          />
        </Field>
        <Field label={T.new.answerTime}>
          <Segmented
            options={[{ label: '8', value: 8 }, { label: '12', value: 12 }, { label: '20', value: 20 }]}
            value={answerSec}
            onChange={setAnswerSec}
          />
        </Field>
      </div>

      {error && <p className="text-sm font-bold text-rose-400">{error}</p>}
      <button
        onClick={start}
        disabled={busy || !nickname.trim()}
        className="btn-primary mt-2 py-4 font-display text-xl"
      >
        {busy ? T.new.creating : T.solo.startBtn}
      </button>
    </main>
  );
}
