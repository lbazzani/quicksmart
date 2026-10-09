# Caratteri per le immagini generate dal server

Baloo 2 ExtraBold e Nunito Bold/Regular, gli stessi della pagina (next/font li carica
per il browser, ma non li rende disponibili a `ImageResponse`). Servono a
`src/app/api/og/risultato/route.tsx`, che li legge da `process.cwd()/assets/fonts`:
per questo `docker/Dockerfile.quicksmart` copia `assets/` accanto a `server.js`
(l'output standalone di Next non porta con sé i file letti con `readFile`).

TTF statici (Satori non legge i caratteri variabili né il woff2), scaricati da Google
Fonts il 9/10/2026. Licenza: SIL Open Font License 1.1.
