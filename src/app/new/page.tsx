'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/lang';
import { api, saveIdentity } from '@/lib/client';
import { AvatarPicker, Field, Segmented, Stepper, Toggle, inputCls } from '@/components/AvatarPicker';
import type { GamePack } from '@/lib/types';

export default function NewGame() {
  const T = useT();
  const router = useRouter();
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🦊');
  const [pack, setPack] = useState<GamePack>('logic');
  const [rounds, setRounds] = useState<number | null>(10);
  const [buzzSec, setBuzzSec] = useState(40);
  const [answerSec, setAnswerSec] = useState(12);
  const [showMistakes, setShowMistakes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ code: string; playerId: string; token: string }>('/api/game', {
        name,
        nickname,
        avatar,
        mode: 'team',
        pack,
        roundsTotal: rounds,
        buzzWindowSec: buzzSec,
        answerSec,
        showMistakes,
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
        <h1 className="font-display text-3xl font-extrabold">👑 {T.new.title}</h1>
      </header>

      <Field label={T.new.gameName}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={T.new.gameNamePlaceholder} maxLength={30} />
      </Field>
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
          options={[
            { label: '5', value: 5 as number | null },
            { label: '10', value: 10 },
            { label: '15', value: 15 },
            { label: '20', value: 20 },
            { label: `∞ ${T.new.roundsOpen}`, value: null },
          ]}
          value={rounds}
          onChange={setRounds}
        />
        {rounds === null ? (
          <span className="text-xs text-stone-400">{T.new.roundsOpenHint}</span>
        ) : (
          <Stepper value={rounds} onChange={setRounds} min={3} max={30} />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={T.new.buzzTime}>
          <Segmented
            options={[{ label: '25', value: 25 }, { label: '40', value: 40 }, { label: '60', value: 60 }]}
            value={buzzSec}
            onChange={setBuzzSec}
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
      <Toggle checked={showMistakes} onChange={setShowMistakes} label={T.new.showMistakes} hint={T.new.showMistakesHint} />

      {error && <p className="text-sm font-bold text-rose-400">{error}</p>}
      <button
        onClick={create}
        disabled={busy || !nickname.trim()}
        className="btn-primary mt-2 py-4 font-display text-xl"
      >
        {busy ? T.new.creating : T.new.createBtn}
      </button>
    </main>
  );
}
