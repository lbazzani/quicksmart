'use client';
// Pagina di gioco: lobby → countdown → buzz → answer → reveal → … → podio.
// Lo stato autoritativo arriva via SSE; qui solo rendering + azioni.

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import type { GameSnapshot, PlayerPublic } from '@/lib/types';
import { useT } from '@/lib/lang';
import { api, loadIdentity, useCountdownTicks, useGame, type Identity } from '@/lib/client';
import { REOPEN_WINDOW_MS, SOFAI_STEAL_FRACTION } from '@/lib/scoring';
import { QuestionView, ChoiceView } from '@/components/visuals';
import { TimerRing } from '@/components/TimerRing';
import { Buzzer } from '@/components/Buzzer';
import { SofaiBubble } from '@/components/SofaiBubble';
import { SofaiAvatar } from '@/components/SofaiAvatar';
import { isMuted, setMuted, sfx, unlockAudio, vibra } from '@/lib/sounds';

const CHOICE_LABELS = ['A', 'B', 'C'];

export default function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const T = useT();
  const { code } = use(params);
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null | 'loading'>('loading');

  // localStorage esiste solo nel browser: l'identità va letta dopo il montaggio
  // e non durante il render, o server e client renderizzerebbero cose diverse.
  useEffect(() => {
    const id = loadIdentity(code);
    if (!id) {
      router.replace(`/join?code=${code}`);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lettura client-only al montaggio
    setIdentity(id);
  }, [code, router]);

  if (identity === 'loading' || identity === null) {
    return <Center><p className="text-stone-400">{T.errors.reconnecting}</p></Center>;
  }
  return <Game code={code.toUpperCase()} identity={identity} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6">{children}</main>;
}

function Game({ code, identity }: { code: string; identity: Identity }) {
  const T = useT();
  const { snap, offset, notFound } = useGame(code, identity.playerId);
  const [muted, setMutedState] = useState(true);
  const startedRef = useRef(false);
  const prevRef = useRef<GameSnapshot | null>(null);

  // idem: la preferenza audio sta in localStorage
  // eslint-disable-next-line react-hooks/set-state-in-effect -- lettura client-only al montaggio
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
      if (snap.phase === 'buzz' && prev.phase === 'answer') {
        sfx.wrong(); // riapertura dopo errore
        // il pollice di chi ha sbagliato lo sente prima degli occhi
        if (prev.current?.buzzerId === identity.playerId) vibra([70, 40, 70]);
      }
      if (snap.phase === 'answer') {
        sfx.buzz();
        if (snap.current?.buzzerId === identity.playerId) vibra(35); // buzz vinto
      }
      if (snap.phase === 'reveal') {
        const out = snap.current?.outcome;
        if (out === 'correct') {
          // la serie di risposte giuste vale un suono suo: il moltiplicatore
          // era l'unica cosa importante del gioco che non si sentiva
          const streak = snap.players.find((p) => p.id === snap.current?.buzzerId)?.streak ?? 0;
          if (streak >= 3) sfx.streak();
          else sfx.correct();
          if (snap.current?.buzzerId === identity.playerId) {
            fireConfetti(false);
            vibra([25, 40, 25]);
          }
        } else if (out === 'nobody' || out === 'timeout' || out === 'stolen') sfx.nobody();
        else {
          sfx.wrong();
          if (prev.current?.buzzerId === identity.playerId) vibra([70, 40, 70]);
        }
      }
    }
    // qualcuno entra in squadra: in lobby si guarda il codice, non lo schermo
    if (snap.status === 'lobby' && snap.players.length > prev.players.length) sfx.join();
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
  if (!snap) return <Center><p className="animate-pulse text-stone-400">{T.errors.reconnecting}</p></Center>;

  const me = snap.players.find((p) => p.id === identity.playerId);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-lg font-extrabold text-stone-300">
          <span className="text-orange-400">Quick</span><span className="text-amber-300">Smart</span> ⚡
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
      {snap.status === 'ended' && <Podium snap={snap} meId={identity.playerId} code={code} identity={identity} />}
    </main>
  );
}

function EndButton({ code, identity }: { code: string; identity: Identity }) {
  const T = useT();
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
  const T = useT();
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
        <p className="text-sm text-stone-400">{T.lobby.waiting}</p>
      </div>

      <button onClick={copy} className="card mx-auto flex flex-col items-center gap-1 px-8 py-4 active:scale-95">
        <span className="text-xs font-bold uppercase tracking-wide text-stone-400">{T.lobby.shareCode}</span>
        <span className="font-display text-5xl font-extrabold tracking-[0.3em] text-orange-300 glow-orange">{code}</span>
        <span className="text-xs text-stone-400">{copied ? T.lobby.copied : '👆 tocca per copiare'}</span>
      </button>

      {snap.joinUrl && (
        <div className="mx-auto flex flex-col items-center gap-1.5">
          <span className="text-xs font-bold text-stone-400">{T.lobby.scanQr}</span>
          {/* PNG generato al volo dalla nostra route, diverso per ogni partita:
              next/image lo passerebbe a un ottimizzatore che non ha nulla da
              ottimizzare, e un QR ricompresso si legge peggio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/qr?code=${code}`}
            alt={`QR per entrare nella partita ${code}`}
            width={150}
            height={150}
            className="rounded-xl border-4 border-white/80"
          />
        </div>
      )}

      <div className="card px-4 py-3">
        <p className="mb-2 text-sm font-bold text-stone-300">
          {T.lobby.players} <span className="text-orange-300">{snap.players.length}</span>
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
                <span className={`h-2 w-2 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-stone-500'}`} />
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
          <p className="animate-pulse text-center text-sm text-stone-400">{T.lobby.waiting}</p>
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
  const T = useT();
  const cur = snap.current;
  const [tooLate, setTooLate] = useState(false);
  const [buzzing, setBuzzing] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);

  // a ogni cambio di round/fase la scelta e il buzz ripartono da zero. Un
  // `key` sul componente li azzererebbe da solo, ma rimonterebbe anche le
  // animazioni di entrata a metà transizione.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset deliberato al cambio di round
    setChosen(null);
    setBuzzing(false);
  }, [snap.roundIndex, snap.phase]);

  const iAmBuzzer = cur?.buzzerId === me.id;
  const lockedMe = cur?.lockedOut.includes(me.id) ?? false;
  const buzzer = snap.players.find((p) => p.id === cur?.buzzerId);
  // riaperta solo dopo un errore: chi è appena entrato è in lockedOut ma non
  // ha fatto sbagliare nessuno
  const reopened = (cur?.errors ?? 0) > 0;
  // opzioni già scelte e sbagliate (arrivano solo se l'host mostra gli errori)
  const burned = new Set(cur?.wrongIndexes ?? []);

  // il conto alla rovescia si sente, non solo si vede: negli ultimi secondi
  // del tempo per prenotarsi e di quello per rispondere
  useCountdownTicks(cur?.buzzDeadline, offset, snap.phase === 'buzz' && !lockedMe);
  useCountdownTicks(cur?.answerDeadline, offset, snap.phase === 'answer' && iAmBuzzer);

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
          <span className="text-xs text-stone-400">
            {T.qtypes[cur.qtype]} · {'★'.repeat(cur.difficulty)}{'☆'.repeat(3 - cur.difficulty)}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <motion.span
            key={cur.value}
            initial={{ scale: 1.4 }}
            animate={{ scale: 1 }}
            className={`font-display text-2xl font-extrabold ${reopened ? 'text-teal-300' : 'text-amber-300'}`}
          >
            {cur.value}
            <span className="ml-1 text-xs font-bold text-stone-400">pt</span>
          </motion.span>
          {snap.phase === 'buzz' && cur.buzzDeadline && (
            <TimerRing
              endsAt={cur.buzzDeadline}
              durationMs={
                reopened
                  ? REOPEN_WINDOW_MS
                  : cur.special === 'sofai'
                    ? snap.settings.buzzWindowMs * SOFAI_STEAL_FRACTION
                    : snap.settings.buzzWindowMs
              }
              offset={offset}
              size={54}
            />
          )}
          {snap.phase === 'answer' && cur.answerDeadline && (
            <TimerRing endsAt={cur.answerDeadline} durationMs={snap.settings.answerMs} offset={offset} size={54} stroke="#fbbf24" />
          )}
        </div>
      </div>

      <ScoreStrip players={snap.players} meId={me.id} buzzerId={cur.buzzerId} showDeltas={snap.phase === 'reveal'} />

      {/* countdown, con l'anteprima di cosa sta arrivando: toglie l'ansia
          da domanda a sorpresa e dà un secondo per "mettersi in modalità" */}
      <AnimatePresence>
        {snap.phase === 'countdown' && cur.countdownEndsAt && (
          <Countdown
            key="cd"
            endsAt={cur.countdownEndsAt}
            offset={offset}
            qtypeLabel={T.qtypes[cur.qtype] ?? cur.qtype}
            difficulty={cur.difficulty}
            value={cur.value}
            buzzSec={Math.round(snap.settings.buzzWindowMs / 1000)}
            answerSec={Math.round(snap.settings.answerMs / 1000)}
            roundIndex={snap.roundIndex}
          />
        )}
      </AnimatePresence>

      {/* domanda */}
      {snap.phase !== 'countdown' && (
        <motion.div
          key={`q${snap.roundIndex}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          // una scrollata secca quando la domanda finisce senza che nessuno
          // l'abbia presa: si capiva solo leggendo, e in quel momento non
          // legge nessuno
          // Mentre si decide se prenotarsi la card si prende lo spazio libero:
          // prima restava un buco fra la domanda e il pulsante, e la figura
          // era piccola in cima. Quando invece compaiono le tre opzioni lo
          // spazio serve a loro — vanno confrontate, e schiacciate in fondo
          // allo schermo non si confrontano.
          className={`card flex flex-col items-center justify-center gap-3 px-3 py-4 ${
            snap.phase === 'buzz' ? 'flex-1' : ''
          } ${snap.phase === 'reveal' && cur.outcome === 'exhausted' ? 'scossa' : ''}`}
        >
          {cur.special === 'twin' && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="rounded-full bg-amber-400/20 px-3 py-1 text-xs font-extrabold text-amber-200 ring-1 ring-amber-300/50"
            >
              👯 {T.game.twinRound}
            </motion.span>
          )}
          {cur.special === 'lampo' && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="rounded-full bg-orange-500/25 px-3 py-1 text-xs font-extrabold text-orange-200 ring-1 ring-orange-400/60"
            >
              ⚡ {T.game.lampoRound}
            </motion.span>
          )}
          {cur.special === 'sofai' && snap.phase === 'buzz' && !reopened && (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-extrabold text-rose-200 ring-1 ring-rose-400/60"
            >
              🤖 {T.game.sofaiRound}
            </motion.span>
          )}
          <p className="text-center font-display text-xl font-bold leading-snug">{cur.prompt}</p>
          <QuestionView payload={cur.payload} />
        </motion.div>
      )}

      {/* opzioni: visibili a tutti, attive solo per chi risponde. Durante una
          riapertura (con "errori visibili") compaiono già in prenotazione, con
          quelle bruciate sbarrate: si vede cosa NON è, e conviene provarci */}
      {cur.choices.length > 0 && snap.phase !== 'countdown' && (
        <div className="grid grid-cols-3 gap-2">
          {cur.choices.map((c, i) => {
            const isCorrect = snap.phase === 'reveal' && cur.correctIndex === i;
            const isWrongPick =
              (snap.phase === 'reveal' && cur.answeredIndex === i && cur.correctIndex !== i) ||
              (burned.has(i) && !isCorrect);
            const active = snap.phase === 'answer' && iAmBuzzer && chosen === null && !burned.has(i);
            return (
              <motion.button
                key={i}
                whileTap={active ? { scale: 0.93 } : undefined}
                disabled={!active}
                onClick={() => doAnswer(i)}
                className={`relative flex flex-col items-center gap-1 rounded-2xl border-2 px-1 py-3 transition-colors ${
                  isCorrect
                    ? 'border-emerald-400 bg-emerald-400/15 shadow-[0_0_18px_rgba(52,211,153,0.4)]'
                    : isWrongPick
                      ? 'border-rose-400/70 bg-rose-400/10 opacity-60'
                      : chosen === i
                        ? 'border-orange-300 bg-orange-300/10'
                        : 'border-white/12 bg-white/5'
                } ${active ? '' : 'opacity-95'} ${snap.phase === 'answer' && !iAmBuzzer ? 'opacity-55' : ''}`}
              >
                <span className="absolute left-1.5 top-1 font-display text-xs font-extrabold text-stone-400">
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

      {/* zona azione: in basso quando c'è da premere il buzzer (il pollice sta
          lì), subito sotto le opzioni quando invece c'è da scegliere — dirlo
          in fondo allo schermo, lontano da quello che si tocca, non aiuta */}
      <div className={`flex flex-col items-center gap-3 pb-3 ${snap.phase === 'buzz' ? 'mt-auto' : 'mt-3'}`}>
        {snap.phase === 'buzz' && (
          <>
            {/* dopo un errore si dice CHI ha sbagliato e (se l'host lo mostra)
                che cosa: il messaggio implicito non lo capiva nessuno */}
            {reopened && cur.lastMiss && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-1 text-center"
              >
                <span className="rounded-full bg-rose-500/15 px-4 py-1.5 text-base font-extrabold text-rose-300">
                  ❌ {cur.lastMiss.avatar} {cur.lastMiss.nickname}{' '}
                  {cur.lastMiss.mute ? T.game.missedMute : T.game.missed}
                  {cur.lastMiss.choiceIndex != null && ` — ${CHOICE_LABELS[cur.lastMiss.choiceIndex]} ✗`}
                </span>
                {!lockedMe && <span className="text-sm font-bold text-teal-300">🔁 {T.game.stealHint}</span>}
              </motion.div>
            )}
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
              me.joinedAtRound === snap.roundIndex ? (
                <p className="py-6 text-center font-bold text-teal-300">👋 {T.game.joinedLate}</p>
              ) : (
                <p className="py-6 text-center font-bold text-stone-400">🚫 {T.game.lockedOut}</p>
              )
            ) : (
              <Buzzer
                endsAt={cur.buzzDeadline ?? 0}
                durationMs={
                  reopened
                    ? REOPEN_WINDOW_MS
                    : cur.special === 'sofai'
                      ? snap.settings.buzzWindowMs * SOFAI_STEAL_FRACTION
                      : snap.settings.buzzWindowMs
                }
                offset={offset}
                disabled={buzzing}
                onBuzz={doBuzz}
                label={T.game.buzz}
              />
            )}
            {!lockedMe && <p className="text-xs text-stone-500">{T.game.buzzHint}</p>}
          </>
        )}

        {snap.phase === 'answer' && !iAmBuzzer && buzzer && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 rounded-full bg-amber-400/15 px-5 py-2.5"
          >
            <span className="animate-pulse text-2xl">✋</span>
            <span className="font-bold text-amber-200">
              {buzzer.avatar} {buzzer.nickname} {T.game.answering}
            </span>
          </motion.div>
        )}
        {snap.phase === 'answer' && iAmBuzzer && (
          <p className="font-display text-lg font-extrabold text-orange-300">⚡ {T.game.youAnswer}</p>
        )}

        {snap.phase === 'reveal' && <Reveal snap={snap} meId={me.id} offset={offset} code={code} identity={identity} />}
        {snap.phase !== 'reveal' && <SofaiBubble comment={snap.sofia} compact />}
      </div>
    </div>
  );
}

function Countdown({
  endsAt,
  offset,
  qtypeLabel,
  difficulty,
  value,
  buzzSec,
  answerSec,
  roundIndex,
}: {
  endsAt: number;
  offset: number;
  qtypeLabel: string;
  difficulty: number;
  value: number;
  buzzSec: number;
  answerSec: number;
  roundIndex: number;
}) {
  const T = useT();
  const [n, setN] = useState(3);
  useEffect(() => {
    const iv = setInterval(() => {
      const left = Math.ceil((endsAt - (Date.now() + offset)) / 1000);
      setN(Math.max(0, left));
      if (left <= 0) clearInterval(iv);
    }, 80);
    return () => clearInterval(iv);
  }, [endsAt, offset]);
  // il briefing di SofAI: che cosa arriva, quanto vale, quanto tempo c'è.
  // Ruota con il round, così non ripete sempre la stessa formula.
  const recap = T.game.countdownRecap[roundIndex % T.game.countdownRecap.length]
    .replaceAll('{pts}', String(value))
    .replaceAll('{buzz}', String(buzzSec))
    .replaceAll('{ans}', String(answerSec));
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 flex-col items-center justify-center gap-4 py-10"
    >
      <motion.span
        key={n}
        initial={{ scale: 2.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="font-display text-8xl font-extrabold text-orange-400 glow-orange"
      >
        {n > 0 ? n : 'VIA!'}
      </motion.span>
      <motion.span
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-full bg-white/5 px-4 py-1.5 text-base font-bold text-stone-200"
      >
        {T.game.next}: {qtypeLabel} · {'★'.repeat(difficulty)}{'☆'.repeat(3 - difficulty)}
      </motion.span>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex max-w-sm items-start gap-2 px-4"
      >
        <SofaiAvatar mood="teasing" size={40} />
        <p className="card flex-1 rounded-bl-sm px-3 py-2 text-sm leading-snug text-stone-200">{recap}</p>
      </motion.div>
    </motion.div>
  );
}

function PlayerChip({
  p,
  rank,
  meId,
  buzzerId,
  showDeltas,
  showRank = false,
}: {
  p: PlayerPublic;
  rank: number;
  meId: string;
  buzzerId?: string;
  showDeltas: boolean;
  showRank?: boolean;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${
        p.id === buzzerId
          ? 'bg-amber-400/25 ring-1 ring-amber-300'
          : p.id === meId
            ? 'bg-orange-400/20 ring-1 ring-orange-300/60'
            : 'bg-white/5'
      }`}
    >
      {showRank && <span className="font-display text-xs font-extrabold text-orange-300">#{rank + 1}</span>}
      <span>{rank === 0 && p.score > 0 ? '👑' : ''}{p.avatar}</span>
      <span className="max-w-16 truncate font-bold">{p.nickname}</span>
      <span className="font-display shrink-0 font-extrabold text-stone-200">{p.score}</span>
      {p.streak >= 3 && <span className="text-xs">🔥{p.streak}</span>}
      {showDeltas && p.lastDelta !== 0 && (
        <span className={`popscore font-display text-xs font-extrabold ${p.lastDelta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
          {p.lastDelta > 0 ? '+' : ''}{p.lastDelta}
        </span>
      )}
    </div>
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
  // il MIO chip sta fuori dalla zona che scorre: con 5+ giocatori sparivo
  // dalla classifica proprio mentre volevo sapere come sto andando
  const meRank = players.findIndex((p) => p.id === meId);
  const me = meRank >= 0 ? players[meRank] : undefined;
  return (
    <div className="flex items-center gap-1.5">
      {me && <PlayerChip p={me} rank={meRank} meId={meId} buzzerId={buzzerId} showDeltas={showDeltas} showRank />}
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
        {players.map((p, rank) =>
          p.id === meId ? null : (
            <PlayerChip key={p.id} p={p} rank={rank} meId={meId} buzzerId={buzzerId} showDeltas={showDeltas} />
          )
        )}
      </div>
    </div>
  );
}

function Reveal({
  snap,
  meId,
  offset,
  code,
  identity,
}: {
  snap: GameSnapshot;
  meId: string;
  offset: number;
  code: string;
  identity: Identity;
}) {
  const T = useT();
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
    color = 'text-stone-300';
  } else if (outcome === 'stolen') {
    banner = `😼 ${T.game.stolen}`;
    color = 'text-amber-300';
  } else if (outcome === 'timeout') {
    banner = T.game.timeoutSolo;
    color = 'text-amber-300';
  } else {
    banner = `😅 ${T.game.exhausted}`;
    color = 'text-rose-300';
  }
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex w-full flex-col items-center gap-2.5">
      <p className={`text-center font-display text-2xl font-extrabold ${color}`}>{banner}</p>
      {/* quando nessuno ha indovinato, la risposta giusta si dice a voce:
          il solo bordo verde nella griglia passava inosservato */}
      {outcome !== 'correct' && cur.correctIndex != null && (
        <p className="font-bold text-emerald-300">
          ✅ {T.game.theAnswerWas}: {CHOICE_LABELS[cur.correctIndex]}
        </p>
      )}
      {cur.explanation && (
        <p className="card w-full max-w-md px-4 py-3 text-center text-base leading-snug text-stone-200">
          💡 {cur.explanation}
        </p>
      )}
      <SofaiBubble comment={snap.sofia} />
      {/* chi ha vinto il round ha il microfono: una riga per sfottere gli altri
          (in solitaria non c'è nessuno da sfottere) */}
      {snap.mode === 'team' && <ChatPanel snap={snap} meId={meId} code={code} identity={identity} />}
      {cur.revealUntil && (
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
          <ShrinkBar endsAt={cur.revealUntil} durationMs={cur.revealMs ?? snap.settings.revealMs} offset={offset} />
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// CHAT — parla chi se l'è guadagnato (vincitore del round o della partita)
// ---------------------------------------------------------------------------

function ChatPanel({ snap, meId, code, identity }: { snap: GameSnapshot; meId: string; code: string; identity: Identity }) {
  const T = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canTalk = snap.chatOpenFor === meId;
  const messages = snap.chat.slice(-3);
  if (!canTalk && messages.length === 0) return null;

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await api(`/api/game/${code}/say`, { playerId: identity.playerId, token: identity.token, text: t });
    setBusy(false);
    if (r.ok) setText('');
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-1.5">
      <AnimatePresence>
        {messages.map((m) => (
          <motion.div
            key={m.seq}
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="flex items-start gap-2 rounded-2xl rounded-bl-sm bg-teal-400/10 px-3 py-2 ring-1 ring-teal-300/25"
          >
            <span className="text-xl">{m.avatar}</span>
            <p className="min-w-0 text-sm leading-snug">
              <b className="text-teal-200">{m.nickname}</b>{' '}
              <span className="break-words text-stone-100">{m.text}</span>
            </p>
          </motion.div>
        ))}
      </AnimatePresence>
      {canTalk && (
        <div className="flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-xl border border-teal-300/40 bg-white/5 px-3 py-2.5 text-sm font-semibold text-stone-100 placeholder:text-stone-500"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={T.game.chatPlaceholder}
            maxLength={80}
            enterKeyHint="send"
          />
          <button onClick={send} disabled={busy || !text.trim()} className="btn-primary px-3.5 py-2.5 text-sm">
            🎤 {T.game.chatSend}
          </button>
        </div>
      )}
    </div>
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
  return <div className="h-full bg-teal-300" style={{ width: `${frac * 100}%` }} />;
}

// ---------------------------------------------------------------------------
// PODIO
// ---------------------------------------------------------------------------

function Podium({ snap, meId, code, identity }: { snap: GameSnapshot; meId: string; code: string; identity: Identity }) {
  const T = useT();
  const ranked = snap.players;
  const top = ranked.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const heights = [148, 108, 84];
  const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i);
  const me = ranked.find((p) => p.id === meId);
  // la rivincita la comanda chi ha vinto (l'host resta il padrone di casa)
  const canRematch = snap.mode === 'team' && (ranked[0]?.id === meId || me?.isHost === true);
  const [rematchBusy, setRematchBusy] = useState(false);

  async function rematch(applySuggestion: boolean) {
    if (rematchBusy) return;
    setRematchBusy(true);
    const r = await api(`/api/game/${code}/rematch`, {
      playerId: identity.playerId,
      token: identity.token,
      applySuggestion,
    });
    if (!r.ok) setRematchBusy(false); // se riparte, ci pensa lo snapshot
  }

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
                <span className="font-display text-lg font-extrabold text-amber-300">{p.score}</span>
              </motion.div>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: heights[idx] }}
                transition={{ delay: 0.2 + idx * 0.25, type: 'spring', stiffness: 120, damping: 14 }}
                className={`flex w-full items-start justify-center rounded-t-xl pt-2 text-3xl ${
                  idx === 0
                    ? 'bg-gradient-to-b from-amber-300/80 to-amber-500/30'
                    : idx === 1
                      ? 'bg-gradient-to-b from-stone-300/70 to-stone-400/25'
                      : 'bg-gradient-to-b from-orange-600/70 to-orange-800/30'
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

      {/* la chat del podio: il microfono è di chi ha vinto */}
      {snap.mode === 'team' && (
        <>
          <ChatPanel snap={snap} meId={meId} code={code} identity={identity} />
          {snap.chatOpenFor === meId && (
            <p className="-mt-3 text-center text-xs font-bold text-teal-300">{T.game.chatMic}</p>
          )}
        </>
      )}

      {/* rivincita: decide chi ha vinto, con l'eventuale proposta di SofAI */}
      {snap.mode === 'team' && (
        <div className="card flex flex-col gap-2.5 px-4 py-3">
          {snap.suggestion && (
            <p className="text-sm leading-snug text-stone-300">
              <b className="text-amber-300">💡 {T.podium.suggestionTitle}:</b> {snap.suggestion.text}
            </p>
          )}
          {canRematch ? (
            <div className="flex flex-col gap-2">
              {snap.suggestion && (
                <button
                  disabled={rematchBusy}
                  onClick={() => rematch(true)}
                  className="btn-primary py-3 font-display text-lg"
                >
                  ✨ {T.podium.rematchTweak}
                </button>
              )}
              <button
                disabled={rematchBusy}
                onClick={() => rematch(false)}
                className={`${snap.suggestion ? 'btn-ghost font-bold' : 'btn-primary'} py-3 font-display text-lg`}
              >
                🔁 {T.podium.rematch}
              </button>
            </div>
          ) : (
            <p className="animate-pulse text-center text-sm text-stone-400">
              👑 {T.podium.waitWinner}
            </p>
          )}
        </div>
      )}

      <div className="card divide-y divide-white/8 px-4 py-1">
        {ranked.map((p, i) => {
          const attempts = p.stats.correct + p.stats.wrong;
          const acc = attempts > 0 ? Math.round((p.stats.correct / attempts) * 100) : 0;
          const avg = p.stats.answerCount > 0 ? (p.stats.answerTimeMsSum / p.stats.answerCount / 1000).toFixed(1) : '–';
          return (
            <div key={p.id} className={`flex items-center gap-2.5 py-2.5 ${p.id === meId ? 'text-orange-200' : ''}`}>
              <span className="w-6 text-center font-display font-extrabold text-stone-400">{i + 1}</span>
              <span className="text-2xl">{p.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{p.nickname}</p>
                <p className="text-xs text-stone-400">
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
      confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0 }, colors: ['#f97316', '#fbbf24', '#2dd4bf'] });
      confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1 }, colors: ['#f97316', '#fbbf24', '#2dd4bf'] });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  } else {
    confetti({ particleCount: 90, spread: 75, origin: { y: 0.7 }, colors: ['#f97316', '#fbbf24', '#2dd4bf', '#f7efe6'] });
  }
}
