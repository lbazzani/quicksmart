'use client';
// Pagina di gioco: lobby → countdown → buzz → answer → reveal → … → podio.
// Lo stato autoritativo arriva via SSE; qui solo rendering + azioni.

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import type { GameSnapshot, PlayerPublic } from '@/lib/types';
import { T } from '@/lib/i18n';
import { api, loadIdentity, useGame, type Identity } from '@/lib/client';
import { REOPEN_WINDOW_MS } from '@/lib/scoring';
import { QuestionView, ChoiceView } from '@/components/visuals';
import { TimerRing } from '@/components/TimerRing';
import { SofaiBubble } from '@/components/SofaiBubble';
import { SofaiAvatar } from '@/components/SofaiAvatar';
import { isMuted, setMuted, sfx, unlockAudio } from '@/lib/sounds';

const CHOICE_LABELS = ['A', 'B', 'C'];

export default function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null | 'loading'>('loading');

  useEffect(() => {
    const id = loadIdentity(code);
    if (!id) router.replace(`/join?code=${code}`);
    else setIdentity(id);
  }, [code, router]);

  if (identity === 'loading' || identity === null) {
    return <Center><p className="text-slate-400">{T.errors.reconnecting}</p></Center>;
  }
  return <Game code={code.toUpperCase()} identity={identity} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6">{children}</main>;
}

function Game({ code, identity }: { code: string; identity: Identity }) {
  const { snap, offset, notFound } = useGame(code, identity.playerId);
  const [muted, setMutedState] = useState(true);
  const startedRef = useRef(false);
  const prevRef = useRef<GameSnapshot | null>(null);

  useEffect(() => setMutedState(isMuted()), []);

  // la modalità solo parte da sola
  useEffect(() => {
    if (snap?.mode === 'solo' && snap.status === 'lobby' && !startedRef.current) {
      startedRef.current = true;
      api(`/api/game/${code}/start`, { playerId: identity.playerId, token: identity.token });
    }
  }, [snap, code, identity]);

  // effetti sonori + confetti sulle transizioni
  useEffect(() => {
    if (!snap) return;
    const prev = prevRef.current;
    prevRef.current = snap;
    if (!prev) return;
    if (snap.phase !== prev.phase) {
      if (snap.phase === 'countdown') sfx.countdown();
      if (snap.phase === 'buzz' && prev.phase === 'countdown') sfx.go();
      if (snap.phase === 'buzz' && prev.phase === 'answer') sfx.wrong(); // riapertura dopo errore
      if (snap.phase === 'answer') sfx.buzz();
      if (snap.phase === 'reveal') {
        const out = snap.current?.outcome;
        if (out === 'correct') {
          sfx.correct();
          if (snap.current?.buzzerId === identity.playerId) fireConfetti(false);
        } else if (out === 'nobody' || out === 'timeout') sfx.nobody();
        else sfx.wrong();
      }
    }
    if (snap.status === 'ended' && prev.status !== 'ended') {
      sfx.fanfare();
      if (snap.players[0]?.id === identity.playerId) fireConfetti(true);
    }
  }, [snap, identity.playerId]);

  // se abbiamo già ricevuto il podio, lo teniamo anche se il server riparte
  if (notFound && snap?.status !== 'ended') {
    return (
      <Center>
        <SofaiAvatar mood="sad" size={90} />
        <p className="text-center text-lg font-bold">{T.join.notFound}</p>
        <Link href="/" className="btn-primary px-6 py-3 font-display">{T.podium.home}</Link>
      </Center>
    );
  }
  if (!snap) return <Center><p className="animate-pulse text-slate-400">{T.errors.reconnecting}</p></Center>;

  const me = snap.players.find((p) => p.id === identity.playerId);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-lg font-extrabold text-slate-300">
          <span className="text-cyan-300">Quick</span><span className="text-pink-400">Smart</span> ⚡
        </span>
        <div className="flex items-center gap-2">
          {snap.status === 'playing' && me?.isHost && snap.mode === 'team' && <EndButton code={code} identity={identity} />}
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
              if (!next) unlockAudio(); // deve avvenire dentro il tocco (iOS)
            }}
            className="btn-ghost px-2.5 py-1.5 text-base"
            aria-label="audio"
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {snap.status === 'lobby' && snap.mode === 'team' && <Lobby snap={snap} me={me} code={code} identity={identity} />}
      {snap.status === 'lobby' && snap.mode === 'solo' && (
        <Center><p className="animate-pulse font-display text-2xl">🎯 …</p></Center>
      )}
      {snap.status === 'playing' && me && <Play snap={snap} me={me} code={code} identity={identity} offset={offset} />}
      {snap.status === 'ended' && <Podium snap={snap} meId={identity.playerId} />}
    </main>
  );
}

function EndButton({ code, identity }: { code: string; identity: Identity }) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="flex items-center gap-1.5">
      <button
        onClick={() => api(`/api/game/${code}/end`, { playerId: identity.playerId, token: identity.token })}
        className="rounded-xl bg-rose-500/90 px-3 py-1.5 text-sm font-extrabold"
      >
        {T.game.endGame}?
      </button>
      <button onClick={() => setConfirm(false)} className="btn-ghost px-2 py-1.5 text-sm">✕</button>
    </span>
  ) : (
    <button onClick={() => setConfirm(true)} className="btn-ghost px-3 py-1.5 text-sm font-bold text-rose-300">
      🏁
    </button>
  );
}

// ---------------------------------------------------------------------------
// LOBBY
// ---------------------------------------------------------------------------

function Lobby({ snap, me, code, identity }: { snap: GameSnapshot; me?: PlayerPublic; code: string; identity: Identity }) {
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard non disponibile (http): pazienza, il codice è ben visibile
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold">{snap.name}</h1>
        <p className="text-sm text-slate-400">{T.lobby.waiting}</p>
      </div>

      <button onClick={copy} className="card mx-auto flex flex-col items-center gap-1 px-8 py-4 active:scale-95">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{T.lobby.shareCode}</span>
        <span className="font-display text-5xl font-extrabold tracking-[0.3em] text-cyan-300 glow-cyan">{code}</span>
        <span className="text-xs text-slate-400">{copied ? T.lobby.copied : '👆 tocca per copiare'}</span>
      </button>

      {snap.joinUrl && (
        <div className="mx-auto flex flex-col items-center gap-1.5">
          <span className="text-xs font-bold text-slate-400">{T.lobby.scanQr}</span>
          <img
            src={`/api/qr?code=${code}`}
            alt="QR"
            width={150}
            height={150}
            className="rounded-xl border-4 border-white/80"
          />
        </div>
      )}

      <div className="card px-4 py-3">
        <p className="mb-2 text-sm font-bold text-slate-300">
          {T.lobby.players} <span className="text-cyan-300">{snap.players.length}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <AnimatePresence>
            {snap.players.map((p) => (
              <motion.span
                key={p.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1.5 pr-3 text-sm font-bold"
              >
                <span className="text-xl">{p.avatar}</span>
                {p.nickname}
                {p.isHost && ' 👑'}
                <span className={`h-2 w-2 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3 pb-2">
        <SofaiBubble comment={snap.sofia} />
        {me?.isHost ? (
          <>
            {startError && <p className="text-center text-sm font-bold text-rose-400">{startError}</p>}
            <button
              disabled={starting}
              onClick={async () => {
                setStarting(true);
                setStartError('');
                unlockAudio();
                const r = await api(`/api/game/${code}/start`, { playerId: identity.playerId, token: identity.token });
                if (!r.ok) {
                  setStarting(false);
                  setStartError(r.error === 'no_questions' ? T.errors.noQuestions : T.errors.generic);
                }
              }}
              className="btn-primary py-4 font-display text-2xl"
            >
              🚀 {T.lobby.startBtn}
            </button>
          </>
        ) : (
          <p className="animate-pulse text-center text-sm text-slate-400">{T.lobby.waiting}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GIOCO
// ---------------------------------------------------------------------------

function Play({
  snap,
  me,
  code,
  identity,
  offset,
}: {
  snap: GameSnapshot;
  me: PlayerPublic;
  code: string;
  identity: Identity;
  offset: number;
}) {
  const cur = snap.current!;
  const [tooLate, setTooLate] = useState(false);
  const [buzzing, setBuzzing] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);

  useEffect(() => {
    setChosen(null);
    setBuzzing(false);
  }, [snap.roundIndex, snap.phase]);

  const iAmBuzzer = cur?.buzzerId === me.id;
  const lockedMe = cur?.lockedOut.includes(me.id) ?? false;
  const buzzer = snap.players.find((p) => p.id === cur?.buzzerId);
  const reopened = (cur?.lockedOut.length ?? 0) > 0;

  async function doBuzz() {
    if (buzzing || lockedMe) return;
    setBuzzing(true);
    unlockAudio(); // primo tocco della partita: abilita l'audio su iOS
    const r = await api(`/api/game/${code}/buzz`, { playerId: identity.playerId, token: identity.token });
    if (!r.ok) {
      setBuzzing(false);
      if (r.error === 'too_late') {
        setTooLate(true);
        setTimeout(() => setTooLate(false), 900);
      }
    }
  }

  async function doAnswer(i: number) {
    if (chosen !== null) return;
    setChosen(i);
    const r = await api(`/api/game/${code}/answer`, {
      playerId: identity.playerId,
      token: identity.token,
      choiceIndex: i,
    });
    // se l'invio non è arrivato (rete ballerina) si può ritoccare finché c'è tempo
    if (!r.ok) setChosen(null);
  }

  if (!cur) return null;

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* header round */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-display text-lg font-extrabold">
            {T.game.round} {snap.roundIndex + 1}
            {snap.settings.roundsTotal ? ` ${T.game.of} ${snap.settings.roundsTotal}` : ''}
          </span>
          <span className="text-xs text-slate-400">
            {T.qtypes[cur.qtype]} · {'★'.repeat(cur.difficulty)}{'☆'.repeat(3 - cur.difficulty)}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <motion.span
            key={cur.value}
            initial={{ scale: 1.4 }}
            animate={{ scale: 1 }}
            className={`font-display text-2xl font-extrabold ${reopened ? 'text-amber-300' : 'text-cyan-300'}`}
          >
            {cur.value}
            <span className="ml-1 text-xs font-bold text-slate-400">pt</span>
          </motion.span>
          {snap.phase === 'buzz' && cur.buzzDeadline && (
            <TimerRing
              endsAt={cur.buzzDeadline}
              durationMs={reopened ? REOPEN_WINDOW_MS : snap.settings.buzzWindowMs}
              offset={offset}
              size={54}
            />
          )}
          {snap.phase === 'answer' && cur.answerDeadline && (
            <TimerRing endsAt={cur.answerDeadline} durationMs={snap.settings.answerMs} offset={offset} size={54} stroke="#f472b6" />
          )}
        </div>
      </div>

      <ScoreStrip players={snap.players} meId={me.id} buzzerId={cur.buzzerId} showDeltas={snap.phase === 'reveal'} />

      {/* countdown */}
      <AnimatePresence>
        {snap.phase === 'countdown' && cur.countdownEndsAt && (
          <Countdown key="cd" endsAt={cur.countdownEndsAt} offset={offset} />
        )}
      </AnimatePresence>

      {/* domanda */}
      {snap.phase !== 'countdown' && (
        <motion.div
          key={`q${snap.roundIndex}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="card flex flex-col items-center gap-3 px-3 py-4"
        >
          <p className="text-center font-display text-lg font-bold leading-tight">{cur.prompt}</p>
          <QuestionView payload={cur.payload} />
          {reopened && snap.phase === 'buzz' && (
            <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-extrabold text-amber-300">
              🔁 {T.game.reopened}
            </span>
          )}
        </motion.div>
      )}

      {/* opzioni: visibili a tutti, attive solo per chi risponde */}
      {(snap.phase === 'answer' || snap.phase === 'reveal') && (
        <div className="grid grid-cols-3 gap-2">
          {cur.choices.map((c, i) => {
            const isCorrect = snap.phase === 'reveal' && cur.correctIndex === i;
            const isWrongPick = snap.phase === 'reveal' && cur.answeredIndex === i && cur.correctIndex !== i;
            const active = snap.phase === 'answer' && iAmBuzzer && chosen === null;
            return (
              <motion.button
                key={i}
                whileTap={active ? { scale: 0.93 } : undefined}
                disabled={!active}
                onClick={() => doAnswer(i)}
                className={`relative flex flex-col items-center gap-1 rounded-2xl border-2 px-1 py-2.5 transition-colors ${
                  isCorrect
                    ? 'border-emerald-400 bg-emerald-400/15 shadow-[0_0_18px_rgba(52,211,153,0.4)]'
                    : isWrongPick
                      ? 'border-rose-400 bg-rose-400/15'
                      : chosen === i
                        ? 'border-cyan-300 bg-cyan-300/10'
                        : 'border-white/12 bg-white/5'
                } ${active ? '' : 'opacity-95'} ${snap.phase === 'answer' && !iAmBuzzer ? 'opacity-55' : ''}`}
              >
                <span className="absolute left-1.5 top-1 font-display text-xs font-extrabold text-slate-400">
                  {CHOICE_LABELS[i]}
                </span>
                <ChoiceView choice={c} />
                {isCorrect && <span className="absolute -right-1.5 -top-1.5 text-xl">✅</span>}
                {isWrongPick && <span className="absolute -right-1.5 -top-1.5 text-xl">❌</span>}
              </motion.button>
            );
          })}
        </div>
      )}

      {/* zona azione */}
      <div className="mt-auto flex flex-col items-center gap-3 pb-3">
        {snap.phase === 'buzz' && (
          <>
            <AnimatePresence>
              {tooLate && (
                <motion.span
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-full bg-rose-500/20 px-4 py-1 font-bold text-rose-300"
                >
                  {T.game.tooLate}
                </motion.span>
              )}
            </AnimatePresence>
            {lockedMe ? (
              <p className="py-6 text-center font-bold text-slate-400">🚫 {T.game.lockedOut}</p>
            ) : (
              <motion.button
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileTap={{ scale: 0.92 }}
                onClick={doBuzz}
                disabled={buzzing}
                className="buzzer h-36 w-36 rounded-full bg-gradient-to-b from-rose-400 to-rose-600 font-display text-2xl font-extrabold text-white"
              >
                {T.game.buzz}
              </motion.button>
            )}
            {!lockedMe && <p className="text-xs text-slate-500">{T.game.buzzHint}</p>}
          </>
        )}

        {snap.phase === 'answer' && !iAmBuzzer && buzzer && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 rounded-full bg-pink-400/15 px-5 py-2.5"
          >
            <span className="animate-pulse text-2xl">✋</span>
            <span className="font-bold text-pink-300">
              {buzzer.avatar} {buzzer.nickname} {T.game.answering}
            </span>
          </motion.div>
        )}
        {snap.phase === 'answer' && iAmBuzzer && (
          <p className="font-display text-lg font-extrabold text-cyan-300">⚡ {T.game.youAnswer}</p>
        )}

        {snap.phase === 'reveal' && <Reveal snap={snap} meId={me.id} offset={offset} />}
        {snap.phase !== 'reveal' && <SofaiBubble comment={snap.sofia} compact />}
      </div>
    </div>
  );
}

function Countdown({ endsAt, offset }: { endsAt: number; offset: number }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    const iv = setInterval(() => {
      const left = Math.ceil((endsAt - (Date.now() + offset)) / 1000);
      setN(Math.max(0, left));
      if (left <= 0) clearInterval(iv);
    }, 80);
    return () => clearInterval(iv);
  }, [endsAt, offset]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 items-center justify-center py-16"
    >
      <motion.span
        key={n}
        initial={{ scale: 2.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="font-display text-8xl font-extrabold text-cyan-300 glow-cyan"
      >
        {n > 0 ? n : 'VIA!'}
      </motion.span>
    </motion.div>
  );
}

function ScoreStrip({
  players,
  meId,
  buzzerId,
  showDeltas,
}: {
  players: PlayerPublic[];
  meId: string;
  buzzerId?: string;
  showDeltas: boolean;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {players.map((p, rank) => (
        <div
          key={p.id}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${
            p.id === buzzerId
              ? 'bg-pink-400/25 ring-1 ring-pink-300'
              : p.id === meId
                ? 'bg-cyan-400/15 ring-1 ring-cyan-300/50'
                : 'bg-white/5'
          }`}
        >
          <span>{rank === 0 && p.score > 0 ? '👑' : ''}{p.avatar}</span>
          <span className="max-w-20 truncate font-bold">{p.nickname}</span>
          <span className="font-display font-extrabold text-slate-200">{p.score}</span>
          {p.streak >= 3 && <span className="text-xs">🔥{p.streak}</span>}
          {showDeltas && p.lastDelta !== 0 && (
            <span className={`popscore font-display text-xs font-extrabold ${p.lastDelta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {p.lastDelta > 0 ? '+' : ''}{p.lastDelta}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Reveal({ snap, meId, offset }: { snap: GameSnapshot; meId: string; offset: number }) {
  const cur = snap.current!;
  const winner = snap.players.find((p) => p.id === cur.buzzerId);
  const outcome = cur.outcome;
  let banner: string;
  let color: string;
  if (outcome === 'correct') {
    banner = `🎉 ${winner?.nickname ?? ''} — ${T.game.correct}`;
    color = 'text-emerald-300';
  } else if (outcome === 'nobody') {
    banner = T.game.nobodyBuzzed;
    color = 'text-slate-300';
  } else if (outcome === 'timeout') {
    banner = T.game.timeoutSolo;
    color = 'text-amber-300';
  } else {
    banner = `😅 ${T.game.exhausted}`;
    color = 'text-rose-300';
  }
  void meId;
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex w-full flex-col items-center gap-2.5">
      <p className={`font-display text-2xl font-extrabold ${color}`}>{banner}</p>
      {cur.explanation && (
        <p className="card max-w-md px-4 py-2 text-center text-sm text-slate-300">💡 {cur.explanation}</p>
      )}
      <SofaiBubble comment={snap.sofia} />
      {cur.revealUntil && (
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <ShrinkBar endsAt={cur.revealUntil} durationMs={snap.settings.revealMs} offset={offset} />
        </div>
      )}
    </motion.div>
  );
}

function ShrinkBar({ endsAt, durationMs, offset }: { endsAt: number; durationMs: number; offset: number }) {
  const [frac, setFrac] = useState(1);
  useEffect(() => {
    const iv = setInterval(() => {
      setFrac(Math.max(0, (endsAt - (Date.now() + offset)) / durationMs));
    }, 100);
    return () => clearInterval(iv);
  }, [endsAt, durationMs, offset]);
  return <div className="h-full bg-cyan-300" style={{ width: `${frac * 100}%` }} />;
}

// ---------------------------------------------------------------------------
// PODIO
// ---------------------------------------------------------------------------

function Podium({ snap, meId }: { snap: GameSnapshot; meId: string }) {
  const ranked = snap.players;
  const top = ranked.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const heights = [148, 108, 84];
  const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i);

  return (
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="text-center font-display text-3xl font-extrabold">🏆 {T.podium.title}</h1>

      <div className="flex items-end justify-center gap-2">
        {order.map((idx) => {
          const p = top[idx];
          if (!p) return null;
          return (
            <div key={p.id} className="flex w-24 flex-col items-center gap-1">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + idx * 0.25 }}
                className="flex flex-col items-center"
              >
                <span className="text-4xl">{p.avatar}</span>
                <span className="max-w-24 truncate text-sm font-extrabold">{p.nickname}</span>
                <span className="font-display text-lg font-extrabold text-cyan-300">{p.score}</span>
              </motion.div>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: heights[idx] }}
                transition={{ delay: 0.2 + idx * 0.25, type: 'spring', stiffness: 120, damping: 14 }}
                className={`flex w-full items-start justify-center rounded-t-xl pt-2 text-3xl ${
                  idx === 0
                    ? 'bg-gradient-to-b from-amber-300/80 to-amber-500/30'
                    : idx === 1
                      ? 'bg-gradient-to-b from-slate-300/70 to-slate-400/25'
                      : 'bg-gradient-to-b from-orange-400/60 to-orange-600/25'
                }`}
              >
                {medals[idx]}
              </motion.div>
            </div>
          );
        })}
      </div>

      {ranked[0] && (
        <p className="text-center font-display text-xl font-extrabold text-amber-300">
          {ranked[0].nickname} · {T.podium.winner}
        </p>
      )}

      <SofaiBubble comment={snap.sofia} />

      <div className="card divide-y divide-white/8 px-4 py-1">
        {ranked.map((p, i) => {
          const attempts = p.stats.correct + p.stats.wrong;
          const acc = attempts > 0 ? Math.round((p.stats.correct / attempts) * 100) : 0;
          const avg = p.stats.answerCount > 0 ? (p.stats.answerTimeMsSum / p.stats.answerCount / 1000).toFixed(1) : '–';
          return (
            <div key={p.id} className={`flex items-center gap-2.5 py-2.5 ${p.id === meId ? 'text-cyan-200' : ''}`}>
              <span className="w-6 text-center font-display font-extrabold text-slate-400">{i + 1}</span>
              <span className="text-2xl">{p.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{p.nickname}</p>
                <p className="text-xs text-slate-400">
                  🎯 {acc}% · ⏱ {avg}s · 🔥 {p.stats.bestStreak} · ✋ {p.stats.buzzWins}
                </p>
              </div>
              <span className="font-display text-xl font-extrabold">{p.score}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex gap-3 pb-3">
        <Link href="/" className="btn-ghost flex-1 py-3.5 text-center font-display text-lg font-bold">
          {T.podium.home}
        </Link>
        <Link href={snap.mode === 'solo' ? '/solo' : '/new'} className="btn-primary flex-1 py-3.5 text-center font-display text-lg">
          {T.podium.playAgain}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function fireConfetti(big: boolean) {
  const confetti = (await import('canvas-confetti')).default;
  if (big) {
    const end = Date.now() + 1600;
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0 }, colors: ['#22d3ee', '#f472b6', '#fbbf24'] });
      confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1 }, colors: ['#22d3ee', '#f472b6', '#fbbf24'] });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  } else {
    confetti({ particleCount: 90, spread: 75, origin: { y: 0.7 }, colors: ['#22d3ee', '#f472b6', '#fbbf24', '#34d399'] });
  }
}
