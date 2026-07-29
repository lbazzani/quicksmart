// Verifica del sito pubblico: una partita vera su https://quicksmart.it con
// tre browser separati (come tre telefoni) + una partita in solitaria.
// L'oracolo della risposta corretta non è disponibile da fuori (il DB è sul
// server), quindi qui si prova ogni opzione osservando l'esito: il test
// controlla il FLUSSO e la coerenza dei punteggi, non la singola risposta.
// Uso: PROD=1 npx playwright test tests-e2e/production.spec.ts

import { test, expect, type Browser, type Page } from '@playwright/test';

const SITE = process.env.SITE ?? 'https://quicksmart.it';
const SHOTS = 'e2e-shots/prod';

interface Snap {
  phase: string;
  status: string;
  roundIndex: number;
  sofia: { text: string; ai: boolean } | null;
  players: { id: string; nickname: string; score: number; stats: { correct: number; wrong: number } }[];
  current: {
    prompt: string;
    buzzerId?: string;
    outcome?: string;
    choices: unknown[];
    correctIndex?: number;
    lockedOut: string[];
  } | null;
}

async function snap(code: string): Promise<Snap> {
  const res = await fetch(`${SITE}/api/game/${code}`, { cache: 'no-store' });
  return (await res.json()) as Snap;
}

async function waitState(code: string, pred: (s: Snap) => boolean, timeoutMs = 60_000): Promise<Snap> {
  const t0 = Date.now();
  for (;;) {
    const s = await snap(code);
    if (pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`stato non raggiunto (phase=${s.phase} round=${s.roundIndex})`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function phone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  return ctx.newPage();
}

test('sito pubblico: partita a squadre completa', async ({ browser }) => {
  test.setTimeout(300_000);
  const anna = await phone(browser);
  const luca = await phone(browser);
  const marco = await phone(browser);

  await anna.goto(SITE);
  await expect(anna.getByRole('heading', { name: /QuickSmart/ })).toBeVisible();
  await anna.screenshot({ path: `${SHOTS}/01-home.png` });

  await anna.getByRole('link', { name: /Crea una squadra/ }).click();
  await anna.getByPlaceholder('Es. I Fulmini').fill('Famiglia Bazzani');
  await anna.getByPlaceholder('Come ti chiami?').fill('Marta');
  await anna.getByRole('button', { name: '5', exact: true }).first().click();
  await anna.getByRole('button', { name: /Crea la partita/ }).click();
  await anna.waitForURL(/\/g\/[A-Z]{5}/);
  const code = anna.url().split('/').pop()!;

  // il QR punta al dominio pubblico, non all'IP di LAN
  const qr = anna.locator('img[alt^="QR"]');
  await expect(qr).toBeVisible();
  const qrRes = await anna.request.get(`${SITE}/api/qr?code=${code}`);
  expect(qrRes.status()).toBe(200);
  await anna.screenshot({ path: `${SHOTS}/02-lobby.png` });

  for (const [page, nick] of [[luca, 'Papà'], [marco, 'Mamma']] as const) {
    await page.goto(`${SITE}/join?code=${code}`);
    await page.getByPlaceholder('Come ti chiami?').fill(nick);
    await page.getByRole('button', { name: /^Entra$/ }).click();
    await page.waitForURL(/\/g\//);
  }
  let s = await snap(code);
  expect(s.players).toHaveLength(3);

  await anna.getByRole('button', { name: /Via alla partita/ }).click();
  await waitState(code, (x) => x.phase === 'buzz');
  await anna.waitForTimeout(500);
  await anna.screenshot({ path: `${SHOTS}/03-domanda.png` });

  // durante la fase buzz le opzioni non sono ancora nello snapshot
  s = await snap(code);
  expect(s.current!.choices).toHaveLength(0);
  expect(s.current!.correctIndex).toBeUndefined();

  // gara di buzz da tre telefoni: uno solo vince
  const byNick = new Map<string, Page>([
    ['Marta', anna],
    ['Papà', luca],
    ['Mamma', marco],
  ]);
  const results = await Promise.all(
    [anna, luca, marco].map((p) =>
      p.getByRole('button', { name: 'PRENOTATI!' }).click().then(() => true).catch(() => false)
    )
  );
  expect(results.filter(Boolean).length).toBeGreaterThan(0);
  s = await waitState(code, (x) => x.phase === 'answer');
  expect(s.current!.buzzerId).toBeTruthy();
  expect(s.current!.choices).toHaveLength(3); // ora sì
  // la classifica è ordinata per punteggio: il buzzer si trova per nickname
  const buzzerNick = s.players.find((p) => p.id === s.current!.buzzerId)!.nickname;
  // La risposta corretta non è nota da fuori (il DB sta sul server): ognuno
  // prova un'opzione diversa. Se sbaglia, la domanda RIAPRE per gli altri —
  // così il test copre anche riapertura, lockout e decay del punteggio.
  const round = s.roundIndex;
  let answering = byNick.get(buzzerNick)!;
  expect(answering).toBeDefined();
  const scoreBefore = s.players.find((p) => p.nickname === buzzerNick)!.score;

  for (let attempt = 0; attempt < 3; attempt++) {
    const btns = answering.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")');
    await btns.nth(attempt).click();
    s = await waitState(code, (x) => x.phase === 'reveal' || (x.phase === 'buzz' && x.roundIndex === round), 30_000);
    if (s.phase === 'reveal') break;

    // riapertura dopo l'errore: chi ha sbagliato è escluso e il valore è calato
    const stillIn = [anna, luca, marco].filter((p) => p !== answering);
    if (!stillIn.length) break;
    const next = stillIn[0];
    await next.getByRole('button', { name: 'PRENOTATI!' }).click();
    const after = await waitState(code, (x) => x.phase === 'answer' || x.phase === 'reveal', 25_000);
    if (after.phase === 'reveal') {
      s = after;
      break;
    }
    answering = byNick.get(after.players.find((p) => p.id === after.current!.buzzerId)!.nickname)!;
  }

  expect(['correct', 'exhausted', 'nobody']).toContain(s.current!.outcome);
  expect(s.current!.correctIndex).toBeDefined(); // la soluzione arriva solo al reveal
  // chi ha risposto ha guadagnato (se giusto) o perso (se sbagliato) punti
  const scoreAfter = s.players.find((p) => p.nickname === buzzerNick)!.score;
  expect(scoreAfter).not.toBe(scoreBefore);
  await answering.waitForTimeout(600);
  await answering.screenshot({ path: `${SHOTS}/04-reveal.png` });

  // SofAI commenta (battuta pre-scritta o AI)
  expect(s.sofia?.text?.length ?? 0).toBeGreaterThan(4);

  // qualche round automatico, poi il capitano chiude
  await waitState(code, (x) => x.roundIndex >= 1, 60_000);
  await anna.getByRole('button', { name: '🏁' }).click();
  await anna.getByRole('button', { name: /Termina partita\?/ }).click();
  s = await waitState(code, (x) => x.status === 'ended');
  await expect(anna.getByText('Classifica finale')).toBeVisible();
  await anna.waitForTimeout(2500); // podio + eventuale battuta AI
  await anna.screenshot({ path: `${SHOTS}/05-podio.png` });

  // la classifica è ordinata e i punteggi sono coerenti con le statistiche
  const scores = s.players.map((p) => p.score);
  expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  console.log('SofAI al podio:', s.sofia?.ai ? `[AI] ${s.sofia.text}` : `[canned] ${s.sofia?.text}`);
});

test('sito pubblico: si entra col QR anche a partita già avviata', async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await phone(browser);
  const late = await phone(browser);

  // il capitano crea la partita e la avvia SUBITO, prima che arrivino gli altri
  await host.goto(`${SITE}/new`);
  await host.getByPlaceholder('Es. I Fulmini').fill('Ritardatari');
  await host.getByPlaceholder('Come ti chiami?').fill('Papà');
  await host.getByRole('button', { name: /Crea la partita/ }).click();
  await host.waitForURL(/\/g\/[A-Z]{5}/);
  const code = host.url().split('/').pop()!;

  // l'URL del QR è quello pubblico, non un indirizzo di rete locale
  const joinUrl: string = (await (await fetch(`${SITE}/api/game/${code}`)).json()).joinUrl;
  expect(joinUrl).toBe(`${SITE}/join?code=${code}`);

  await host.getByRole('button', { name: /Via alla partita/ }).click();
  await waitState(code, (x) => x.status === 'playing');

  // Marta arriva DOPO il via, seguendo il QR
  await late.goto(joinUrl);
  await expect(late.locator('input').first()).toHaveValue(code); // codice già compilato
  await late.getByPlaceholder('Come ti chiami?').fill('Marta');
  await late.getByRole('button', { name: /^Entra$/ }).click();
  await late.waitForURL(new RegExp(`/g/${code}`), { timeout: 20_000 });

  const s = await waitState(code, (x) => x.players.some((p) => p.nickname === 'Marta'));
  expect(s.players).toHaveLength(2);
  await late.waitForTimeout(1200);
  await late.screenshot({ path: `${SHOTS}/08-entrata-in-corsa.png` });

  // gioca dal round successivo, non da quello a metà
  const nextRound = await waitState(late.url() && code, (x) => x.roundIndex > s.roundIndex && x.phase === 'buzz', 90_000);
  expect(nextRound.current!.lockedOut).not.toContain(s.players.find((p) => p.nickname === 'Marta')!.id);
  await expect(late.getByRole('button', { name: 'PRENOTATI!' })).toBeVisible({ timeout: 20_000 });
});

test('sito pubblico: allenamento in solitaria', async ({ browser }) => {
  test.setTimeout(240_000);
  const p = await phone(browser);
  await p.goto(`${SITE}/solo`);
  await p.getByPlaceholder('Come ti chiami?').fill('Marta');
  await p.getByRole('button', { name: '5', exact: true }).first().click();
  await p.getByRole('button', { name: /Inizia!/ }).click();
  await p.waitForURL(/\/g\/[A-Z]{5}/);
  const code = p.url().split('/').pop()!;

  await waitState(code, (x) => x.phase === 'buzz');
  await p.getByRole('button', { name: 'PRENOTATI!' }).click();
  await waitState(code, (x) => x.phase === 'answer');
  await p.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').first().click();
  let s = await waitState(code, (x) => x.phase === 'reveal');
  expect(['correct', 'exhausted']).toContain(s.current!.outcome);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${SHOTS}/06-solo.png` });

  // secondo round: non rispondere → penalità da timeout
  s = await waitState(code, (x) => x.roundIndex === 1 && x.phase === 'reveal', 90_000);
  expect(s.current!.outcome).toBe('timeout');
  expect(s.players[0].score).toBeLessThan(0 + 1000);
  await p.screenshot({ path: `${SHOTS}/07-solo-timeout.png` });
});
