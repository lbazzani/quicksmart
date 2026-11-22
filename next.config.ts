import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produzione in container (piattaforma SparkTech, 2026-09-08): l'output
  // standalone porta nell'immagine solo i file necessari. In sviluppo non
  // cambia nulla.
  output: "standalone",

  // niente «X-Powered-By: Next.js» (22/11/2026, sicurezza): non serve a nessuno e dice a chi
  // scansiona che cosa provare
  poweredByHeader: false,
};

export default nextConfig;
