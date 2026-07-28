'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { T } from '@/lib/i18n';
import { api, saveIdentity } from '@/lib/client';
import { AvatarPicker, Field, inputCls } from '@/components/AvatarPicker';

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase());
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🐼');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function join() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ code: string; playerId: string; token: string }>(
        `/api/game/${code.trim()}/join`,
        { nickname, avatar }
      );
      if (res.error) {
        setError(
          res.error === 'not_found'
            ? T.join.notFound
            : res.error === 'nickname_taken'
              ? T.join.nicknameTaken
              : res.error === 'started'
                ? T.join.gameStarted
                : T.errors.generic
        );
        setBusy(false);
        return;
      }
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
        <h1 className="font-display text-3xl font-extrabold">🔑 {T.join.title}</h1>
      </header>

      <Field label={T.join.code}>
        <input
          className={`${inputCls} text-center font-display text-3xl font-extrabold uppercase tracking-[0.35em]`}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))}
          placeholder={T.join.codePlaceholder}
          autoCapitalize="characters"
          autoComplete="off"
        />
      </Field>
      <Field label={T.new.nickname}>
        <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={T.new.nicknamePlaceholder} maxLength={20} />
      </Field>
      <Field label={T.new.avatar}>
        <AvatarPicker value={avatar} onChange={setAvatar} />
      </Field>

      {error && <p className="text-sm font-bold text-rose-400">{error}</p>}
      <button
        onClick={join}
        disabled={busy || !nickname.trim() || code.length !== 5}
        className="btn-primary mt-2 py-4 font-display text-xl"
      >
        {busy ? T.join.joining : T.join.joinBtn}
      </button>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
