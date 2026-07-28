// E2E: una partita vera con 3 browser (telefoni simulati) + modalità solo.
// Il server deve girare su BASE (default :3005). L'oracolo della risposta
// corretta viene dal DB (le API non la espongono mai prima del reveal).

import { test, expect, type Browser, type Page } from '@playwright/test';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://costola:costola@localhost:5433/quicksmart',
});

const BASE = process.env.BASE ?? 'http://localhost:3005';
const SHOTS = 'e2e-shots';

interface Snap {
  phase: string;
  status: string;
  roundIndex: number;
  players: { id: string; nickname: string; score: number }[];
  current: { prompt: string; payload: unknown; choices: unknown; buzzerId?: string; outcome?: string } | null;
}

async function snap(code: string): Promise<Snap> {
  const res = await fetch(`${BASE}/api/game/${code}`);
  return (await res.json()) as Snap;
}

async function waitState(code: string, pred: (s: Snap) => boolean, timeoutMs = 40_000): Promise<Snap> {
  const t0 = Date.now();
  for (;;) {
    const s = await snap(code);
    if (pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`stato non raggiunto (phase=${s.phase} round=${s.roundIndex})`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function correctIndex(code: string): Promise<number> {
  const s = await snap(code);
  const { rows } = await pool.query(
    `SELECT correct_index FROM questions WHERE prompt = $1 AND payload = $2::jsonb AND choices = $3::jsonb`,
    [s.current!.prompt, JSON.stringify(s.current!.payload), JSON.stringify(s.current!.choices)]
  );
  if (rows.length !== 1) throw new Error('oracolo: domanda non trovata');
  return rows[0].correct_index as number;
}

async function newPlayer(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  return ctx.newPage();
}

test.afterAll(async () => {
  await pool.end();
});

test('partita a squadre con 3 giocatori', async ({ browser }) => {
  const anna = await newPlayer(browser);
  const luca = await newPlayer(browser);
  const marco = await newPlayer(browser);

  // — home + creazione
  await anna.goto('/');
  await anna.screenshot({ path: `${SHOTS}/01-home.png` });
  await anna.getByRole('link', { name: /Crea una squadra/ }).click();
  await anna.getByPlaceholder('Es. I Fulmini').fill('I Fulmini');
  await anna.getByPlaceholder('Es. Sofia').fill('Anna');
  await anna.getByRole('button', { name: '5', exact: true }).first().click(); // 5 round
  await anna.screenshot({ path: `${SHOTS}/02-new.png` });
  await anna.getByRole('button', { name: /Crea la partita/ }).click();
  await anna.waitForURL(/\/g\/[A-Z]{5}/);
  const code = anna.url().split('/').pop()!;

  // — lobby con QR
  await expect(anna.getByText(code)).toBeVisible();
  await expect(anna.locator('img[alt="QR"]')).toBeVisible();

  // — gli altri entrano
  for (const [page, nick] of [[luca, 'Luca'], [marco, 'Marco']] as const) {
    await page.goto(`/join?code=${code}`);
    await page.getByPlaceholder('Es. Sofia').fill(nick);
    await page.getByRole('button', { name: /^Entra$/ }).click();
    await page.waitForURL(/\/g\//);
  }
  await expect(anna.getByText('🐼Luca')).toBeVisible();
  await expect(anna.getByText('🐼Marco')).toBeVisible();
  await anna.screenshot({ path: `${SHOTS}/03-lobby.png` });

  // — via!
  await anna.getByRole('button', { name: /Via alla partita/ }).click();
  await waitState(code, (s) => s.phase === 'buzz');
  await anna.waitForTimeout(400);
  await anna.screenshot({ path: `${SHOTS}/04-domanda-buzz.png` });

  // ROUND 1: Luca si prenota e risponde bene
  const ci1 = await correctIndex(code);
  await luca.getByRole('button', { name: 'PRENOTATI!' }).click();
  await waitState(code, (s) => s.phase === 'answer');
  await expect(anna.getByText(/sta rispondendo/)).toBeVisible();
  await anna.screenshot({ path: `${SHOTS}/05-avversario-risponde.png` });
  await luca.screenshot({ path: `${SHOTS}/06-scelta-risposta.png` });
  await luca.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').nth(ci1).click();
  let s = await waitState(code, (x) => x.phase === 'reveal');
  expect(s.current?.outcome).toBe('correct');
  await luca.waitForTimeout(500);
  await luca.screenshot({ path: `${SHOTS}/07-reveal-giusto.png` });

  // ROUND 2: Anna sbaglia, la domanda riapre, Marco indovina
  await waitState(code, (x) => x.phase === 'buzz' && x.roundIndex === 1);
  const ci2 = await correctIndex(code);
  await anna.getByRole('button', { name: 'PRENOTATI!' }).click();
  await waitState(code, (x) => x.phase === 'answer');
  await anna.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').nth((ci2 + 1) % 3).click();
  await waitState(code, (x) => x.phase === 'buzz' && x.roundIndex === 1); // riapertura
  await expect(anna.getByText(/Sei fuori per questo round/)).toBeVisible();
  await anna.screenshot({ path: `${SHOTS}/08-riapertura-lockout.png` });
  await marco.getByRole('button', { name: 'PRENOTATI!' }).click();
  await waitState(code, (x) => x.phase === 'answer');
  await marco.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').nth(ci2).click();
  s = await waitState(code, (x) => x.phase === 'reveal' && x.roundIndex === 1);
  expect(s.current?.outcome).toBe('correct');

  // ROUND 3-5: il capitano termina in anticipo → podio
  await waitState(code, (x) => x.phase === 'buzz' && x.roundIndex === 2);
  await anna.getByRole('button', { name: '🏁' }).click();
  await anna.getByRole('button', { name: /Termina partita\?/ }).click();
  s = await waitState(code, (x) => x.status === 'ended');
  await expect(anna.getByText('Classifica finale')).toBeVisible();
  await anna.waitForTimeout(1600); // animazioni podio
  await anna.screenshot({ path: `${SHOTS}/09-podio.png` });

  // classifica coerente: Luca e Marco hanno punti, Anna in negativo
  const byNick = Object.fromEntries(s.players.map((p) => [p.nickname, p.score]));
  expect(byNick['Luca']).toBeGreaterThan(0);
  expect(byNick['Marco']).toBeGreaterThan(0);
  expect(byNick['Anna']).toBeLessThan(0);
});

test('modalità solo con timeout e risposta', async ({ browser }) => {
  const sofia = await newPlayer(browser);
  await sofia.goto('/solo');
  await sofia.getByPlaceholder('Es. Sofia').fill('Sofia');
  await sofia.getByRole('button', { name: '5', exact: true }).first().click(); // 5 round
  await sofia.getByRole('button', { name: '10', exact: true }).nth(1).click(); // 10s decisione
  await sofia.screenshot({ path: `${SHOTS}/10-solo-setup.png` });
  await sofia.getByRole('button', { name: /Inizia!/ }).click();
  await sofia.waitForURL(/\/g\/[A-Z]{5}/);
  const code = sofia.url().split('/').pop()!;

  // round 1: risponde correttamente
  await waitState(code, (x) => x.phase === 'buzz');
  const ci = await correctIndex(code);
  await sofia.getByRole('button', { name: 'PRENOTATI!' }).click();
  await waitState(code, (x) => x.phase === 'answer');
  await sofia.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').nth(ci).click();
  let s = await waitState(code, (x) => x.phase === 'reveal');
  expect(s.current?.outcome).toBe('correct');
  expect(s.players[0].score).toBeGreaterThan(0);

  // round 2: lascia scadere il timer di decisione → penalità
  const before = s.players[0].score;
  s = await waitState(code, (x) => x.phase === 'reveal' && x.roundIndex === 1, 30_000);
  expect(s.current?.outcome).toBe('timeout');
  expect(s.players[0].score).toBeLessThan(before);
  await sofia.screenshot({ path: `${SHOTS}/11-solo-timeout.png` });
});
