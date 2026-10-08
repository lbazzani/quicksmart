// E2E: la sfida del giorno e la condivisione.
// Server su BASE (default :3005) con QS_TEST_MODE=1 (oracolo delle risposte).

import { test, expect, type Browser, type Page } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const SHOTS = 'e2e-shots';

interface Snap {
  name: string;
  phase: string;
  status: string;
  roundIndex: number;
  settings: { daily?: number; ref?: string; roundsTotal: number | null };
  players: { id: string; nickname: string; score: number }[];
  current: { qtype: string; payload: unknown; outcome?: string } | null;
}

async function snap(code: string): Promise<Snap> {
  return (await (await fetch(`${BASE}/api/game/${code}`)).json()) as Snap;
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
  const res = await fetch(`${BASE}/api/game/${code}/solution`);
  if (!res.ok) throw new Error('oracolo non disponibile: avvia il server con QS_TEST_MODE=1');
  return ((await res.json()) as { correctIndex: number }).correctIndex;
}

async function newPlayer(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'it-IT' });
  // niente foglio di condivisione nel browser di test: si ripiega sugli appunti
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('qs:onboarded', '1');
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  return page;
}

async function avviaSfida(page: Page, nome: string, ref?: string): Promise<string> {
  await page.goto(ref ? `/sfida?ref=${ref}` : '/sfida');
  await page.getByPlaceholder('Come ti chiami?').fill(nome);
  await page.getByRole('button', { name: /Gioca la sfida/ }).click();
  await page.waitForURL(/\/g\/[A-Z]{5}/);
  return page.url().split('/').pop()!;
}

test('sfida del giorno: stesse domande per tutti, risultato da condividere', async ({ browser }) => {
  test.setTimeout(300_000);
  const giulia = await newPlayer(browser);
  const pietro = await newPlayer(browser);

  const codeG = await avviaSfida(giulia, 'Giulia', 'prova');
  await giulia.screenshot({ path: `${SHOTS}/20-sfida-partita.png` });
  const codeP = await avviaSfida(pietro, 'Pietro');

  // regole fisse dal server, provenienza registrata solo per chi è arrivato da un link
  const sG = await waitState(codeG, (x) => x.phase === 'buzz' && x.roundIndex === 0);
  const sP = await waitState(codeP, (x) => x.phase === 'buzz' && x.roundIndex === 0);
  expect(sG.settings.daily).toBeGreaterThan(0);
  expect(sG.name).toBe(`Sfida del giorno #${sG.settings.daily}`);
  expect(sG.settings.roundsTotal).toBe(10);
  expect(sG.settings.ref).toBe('prova');
  expect(sP.settings.ref).toBeUndefined();
  // la stessa prima domanda
  expect(sP.current?.qtype).toBe(sG.current?.qtype);
  expect(sP.current?.payload).toEqual(sG.current?.payload);
  await pietro.close();

  // Giulia gioca tutti e dieci i round: giusta, tranne il terzo sbagliato
  for (let round = 0; round < 10; round++) {
    await waitState(codeG, (x) => x.phase === 'buzz' && x.roundIndex === round, 60_000);
    const ci = await correctIndex(codeG);
    const scelta = round === 2 ? (ci + 1) % 3 : ci;
    await giulia.getByRole('button', { name: 'PRENOTATI!' }).click();
    await waitState(codeG, (x) => x.phase === 'answer');
    await giulia.locator('button:has-text("A"), button:has-text("B"), button:has-text("C")').nth(scelta).click();
    await waitState(codeG, (x) => x.phase === 'reveal' && x.roundIndex === round);
  }
  await waitState(codeG, (x) => x.status === 'ended', 60_000);
  const n = sG.settings.daily!;

  await expect(giulia.getByText(`Sfida #${n} completata`)).toBeVisible();
  await expect(giulia.getByText('🟩🟩🟥🟩🟩🟩🟩🟩🟩🟩')).toBeVisible();
  await expect(giulia.getByText(/^9\/10 · \d+ punti$/)).toBeVisible();
  await giulia.screenshot({ path: `${SHOTS}/21-sfida-podio.png`, fullPage: true });

  // condivisione: senza foglio di condivisione, testo e link finiscono negli appunti
  await giulia.getByRole('button', { name: /Condividi il risultato/ }).first().click();
  await expect(giulia.getByText('Copiato: incollalo nella chat')).toBeVisible();
  const copiato = await giulia.evaluate(() => navigator.clipboard.readText());
  expect(copiato).toContain(`QuickSmart ⚡ Sfida #${n}`);
  expect(copiato).toContain('🟩🟩🟥🟩🟩🟩🟩🟩🟩🟩');
  expect(copiato).toContain('/sfida?ref=sfida');

  // tornando sulla sfida: il risultato c'è già, e la home lo ricorda
  await giulia.goto('/sfida');
  await expect(giulia.getByText(`Sfida #${n} completata`)).toBeVisible();
  await expect(giulia.getByRole('button', { name: /Rigioca/ })).toBeVisible();
  await giulia.screenshot({ path: `${SHOTS}/22-sfida-fatta.png` });
  await giulia.goto('/');
  await expect(giulia.getByText(new RegExp(`Sfida del giorno #${n}`))).toBeVisible();
  await expect(giulia.getByText(/Fatta: \d+ punti/)).toBeVisible();
  await giulia.screenshot({ path: `${SHOTS}/23-home-sfida.png` });
});

test('lobby: il pulsante Invita copia un link che porta a entrare col codice', async ({ browser }) => {
  const host = await newPlayer(browser);
  await host.goto('/new');
  await host.getByPlaceholder('Es. I Fulmini').fill('I Cugini');
  await host.getByPlaceholder('Come ti chiami?').fill('Zia');
  await host.getByRole('button', { name: /Crea la partita/ }).click();
  await host.waitForURL(/\/g\/[A-Z]{5}/);
  const code = host.url().split('/').pop()!;
  await host.getByRole('button', { name: /Invita/ }).click();
  const copiato = await host.evaluate(() => navigator.clipboard.readText());
  expect(copiato).toContain(`Codice ${code}`);
  expect(copiato).toMatch(new RegExp(`/join\\?code=${code}&ref=invito`));
  await host.screenshot({ path: `${SHOTS}/24-lobby-invita.png` });
});
