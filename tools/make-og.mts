// Genera public/og.png, l'anteprima che si vede quando il link della partita
// viene incollato su WhatsApp o Telegram.
//
// Esiste come script e non come PNG disegnato a mano perché il testo
// dell'immagine ripete la descrizione del sito: quando quella cambia (è già
// successo con "prenotati per primo", sostituito da una formula che non si
// rivolge a nessun genere) l'immagine deve poter essere rifatta in un comando.
//
// Uso: npx tsx tools/make-og.mts

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** deve restare uguale a DESCRIPTION in src/app/layout.tsx */
const DESCRIZIONE = 'Quiz visuali in tempo reale: guarda la figura,\nprenotati prima degli altri e rispondi in 5 secondi.';
const CLAIM = 'Chi pensa più in fretta?';

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@400;700;800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: center; gap: 64px;
    padding: 0 80px; font-family: Nunito, sans-serif; color: #f7efe6;
    background:
      radial-gradient(700px 420px at 22% 46%, rgba(249,115,22,0.30), transparent 62%),
      radial-gradient(760px 420px at 84% 12%, rgba(251,191,36,0.16), transparent 60%),
      radial-gradient(620px 400px at 60% 108%, rgba(45,212,191,0.10), transparent 60%),
      #16100c;
  }
  .icona {
    width: 260px; height: 260px; flex: none; border-radius: 58px;
    background: linear-gradient(180deg, #2e1c11, #16100c);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 90px rgba(249,115,22,0.34);
  }
  .icona svg { width: 150px; height: 150px; }
  h1 { font-family: 'Baloo 2', Nunito, sans-serif; font-size: 92px; font-weight: 800; line-height: 1; letter-spacing: -1px; }
  h1 .q { color: #f97316; } h1 .s { color: #fbbf24; }
  h1 { text-shadow: 0 0 46px rgba(249,115,22,0.45); }
  h2 { font-size: 42px; font-weight: 800; margin-top: 26px; }
  p { font-size: 30px; font-weight: 400; color: #cabcae; margin-top: 16px; line-height: 1.42; white-space: pre-line; }
  .dominio {
    display: inline-block; margin-top: 32px; padding: 14px 34px; border-radius: 999px;
    background: linear-gradient(135deg, #fb923c, #f97316 55%, #ea580c);
    color: #2b1405; font-size: 30px; font-weight: 800;
  }
</style></head>
<body>
  <div class="icona">
    <svg viewBox="0 0 32 32"><defs><linearGradient id="b" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#fbbf24"/><stop offset="0.5" stop-color="#fb923c"/><stop offset="1" stop-color="#f97316"/>
    </linearGradient></defs>
    <path d="M21.6 2.6 7.2 18.4h7L11 29.4 25.4 13.6h-7z" fill="url(#b)"/></svg>
  </div>
  <div>
    <h1><span class="q">Quick</span><span class="s">Smart</span></h1>
    <h2>${CLAIM}</h2>
    <p>${DESCRIZIONE}</p>
    <div class="dominio">quicksmart.it</div>
  </div>
</body></html>`;

const out = resolve('public/og.png');
mkdirSync(resolve('public'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(`✓ ${out}`);
