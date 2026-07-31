// E2E: una partita vera con 3 browser (telefoni simulati) + modalità solo.
// Il server deve girare su BASE (default :3005) con QS_TEST_MODE=1, che abilita
// l'oracolo delle risposte: le API non le espongono mai prima del reveal.

import { test, expect, type Browser, type Page } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const SHOTS = 'e2e-shots';

interface Snap {
  phase: string;
  status: string;
  roundIndex: number;
  players: { id: string; nickname: string; score: number }[];
  current: {
    qtype: string;
    prompt: { it: string; en: string };
    payload: unknown;
    choices: unknown;
    buzzerId?: string;
    outcome?: string;
  } | null;
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

/**
 * Oracolo: la risposta corretta non compare mai negli snapshot prima del
 * reveal. Le domande sono generate al volo, quindi non stanno nel database:
 * la chiediamo alla route di test (server avviato con QS_TEST_MODE=1).
 */
async function correctIndex(code: string): Promise<number> {
  const res = await fetch(`${BASE}/api/game/${code}/solution`);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'oracolo non disponibile: avvia il server con QS_TEST_MODE=1'
        : `oracolo: HTTP ${res.status}`
    );
  }
  const { correctIndex: ci } = (await res.json()) as { correctIndex: number };
  return ci;
}

async function newPlayer(browser: Browser, locale = 'it-IT'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale });
  const page = await ctx.newPage();
  // l'onboarding compare solo al primo ingresso: nei test i giocatori sono "veterani"
  await page.addInitScript(() => localStorage.setItem('qs:onboarded', '1'));
  return page;
}

test('partita a squadre con 3 giocatori', async ({ browser }) => {
  const anna = await newPlayer(browser);
  const luca = await newPlayer(browser);
  const marco = await newPlayer(browser);

  // — home + creazione
  await anna.goto('/');
  await anna.screenshot({ path: `${SHOTS}/01-home.png` });
  await anna.getByRole('link', { name: /Crea una squadra/ }).click();
  await anna.getByPlaceholder('Es. I Fulmini').fill('I Fulmini');
  await anna.getByPlaceholder('Come ti chiami?').fill('Anna');
  await anna.getByRole('button', { name: '5', exact: true }).first().click(); // 5 round
  await anna.screenshot({ path: `${SHOTS}/02-new.png` });
  await anna.getByRole('button', { name: /Crea la partita/ }).click();
  await anna.waitForURL(/\/g\/[A-Z]{5}/);
  const code = anna.url().split('/').pop()!;

  // — lobby con QR
  await expect(anna.getByText(code)).toBeVisible();
  await expect(anna.locator('img[alt^="QR"]')).toBeVisible();

  // — gli altri entrano
  for (const [page, nick] of [[luca, 'Luca'], [marco, 'Marco']] as const) {
    await page.goto(`/join?code=${code}`);
    await page.getByPlaceholder('Come ti chiami?').fill(nick);
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

  // — chat del vincitore: Luca ha il microfono, gli altri leggono
  await luca.getByPlaceholder('Dì qualcosa agli altri…').fill('gg, troppo facile 😎');
  await luca.getByRole('button', { name: /Invia/ }).click();
  await expect(anna.getByText('gg, troppo facile 😎')).toBeVisible();
  await luca.waitForTimeout(300);
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

  // — rivincita: la decide chi ha vinto, stessa stanza, punteggi azzerati
  const pages: Record<string, Page> = { Anna: anna, Luca: luca, Marco: marco };
  const winnerPage = pages[s.players[0].nickname];
  await winnerPage.getByRole('button', { name: /Rivincita/ }).first().click();
  s = await waitState(code, (x) => x.status === 'playing' && x.roundIndex === 0);
  for (const p of s.players) expect(p.score).toBe(0);
  await waitState(code, (x) => x.phase === 'buzz' && x.roundIndex === 0);
  await anna.screenshot({ path: `${SHOTS}/12-rivincita.png` });

  // il capitano può chiudere anche la rivincita
  await anna.getByRole('button', { name: '🏁' }).click();
  await anna.getByRole('button', { name: /Termina partita\?/ }).click();
  await waitState(code, (x) => x.status === 'ended');
});

test('interfaccia in inglese per chi ha il browser in inglese, con cambio lingua', async ({ browser }) => {
  const page = await newPlayer(browser, 'en-US');
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Join with a code/ })).toBeVisible();
  // il cambio lingua riporta all'italiano e viene ricordato
  await page.getByRole('button', { name: 'language' }).click();
  await expect(page.getByRole('link', { name: /Entra con un codice/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: /Entra con un codice/ })).toBeVisible();
});

test('modalità solo con timeout e risposta', async ({ browser }) => {
  const solista = await newPlayer(browser);
  await solista.goto('/solo');
  await solista.getByPlaceholder('Come ti chiami?').fill('Marta');
  await solista.getByRole('button', { name: '5', exact: true }).first().click(); // 5 round
  await solista.getByRole('button', { name: '10', exact: true }).nth(1).click(); // 10s decisione
  await solista.screenshot({ path: `${SHOTS}/10-solo-setup.png` });
  await solista.getByRole('button', { name: /Inizia!/ }).click();
  await solista.waitForURL(/\/g\/[A-Z]{5}/);
  const code = solista.url().split('/').pop()!;

  // round 1: risponde correttamente
  await waitState(code, (x) => x.phase === 'buzz');
  const ci = await correctIndex(code);
  await solista.getByRole('button', { name: 'PRENOTATI!' }).click();
  await waitState(code, (x) => x.phase === 'answer');
  await solista.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').nth(ci).click();
  let s = await waitState(code, (x) => x.phase === 'reveal');
  expect(s.current?.outcome).toBe('correct');
  expect(s.players[0].score).toBeGreaterThan(0);

  // round 2: lascia scadere il timer di decisione → penalità
  const before = s.players[0].score;
  s = await waitState(code, (x) => x.phase === 'reveal' && x.roundIndex === 1, 30_000);
  expect(s.current?.outcome).toBe('timeout');
  expect(s.players[0].score).toBeLessThan(before);
  await solista.screenshot({ path: `${SHOTS}/11-solo-timeout.png` });
});

test('pacchetto bandiere in solo: pesca solo domande di tipo flags e si gioca fino in fondo', async ({ browser }) => {
  const solista = await newPlayer(browser);
  await solista.goto('/solo');
  await solista.getByPlaceholder('Come ti chiami?').fill('Flavia');
  await solista.getByRole('button', { name: '🚩 Bandiere' }).click();
  await solista.getByRole('button', { name: '5', exact: true }).first().click(); // 5 round
  await solista.getByRole('button', { name: /Inizia!/ }).click();
  await solista.waitForURL(/\/g\/[A-Z]{5}/);
  const code = solista.url().split('/').pop()!;

  for (let round = 0; round < 3; round++) {
    const s = await waitState(code, (x) => x.phase === 'buzz' && x.roundIndex === round);
    expect(s.current?.qtype).toBe('flags');
    const ci = await correctIndex(code);
    await solista.getByRole('button', { name: 'PRENOTATI!' }).click();
    await waitState(code, (x) => x.phase === 'answer');
    await solista.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').nth(ci).click();
    await waitState(code, (x) => x.phase === 'reveal');
  }
});

test('domande in inglese per chi gioca in inglese: tradotto anche il contenuto, non solo l\'interfaccia', async ({
  browser,
}) => {
  const solista = await newPlayer(browser, 'en-US');
  await solista.goto('/solo');
  await solista.getByPlaceholder(/What.?s your name/).fill('Emma');
  await solista.getByRole('button', { name: /Start!/ }).click();
  await solista.waitForURL(/\/g\/[A-Z]{5}/);
  const code = solista.url().split('/').pop()!;

  const s = await waitState(code, (x) => x.phase === 'buzz');
  expect(s.current?.prompt.en.length).toBeGreaterThan(0);
  // vera traduzione, non l'italiano ripetuto due volte
  expect(s.current?.prompt.en).not.toBe(s.current?.prompt.it);
  await expect(solista.getByText(s.current!.prompt.en, { exact: false })).toBeVisible();
});
