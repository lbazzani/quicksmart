import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produzione in container (piattaforma SparkTech, 2026-09-08): l'output
  // standalone porta nell'immagine solo i file necessari. In sviluppo non
  // cambia nulla.
  output: "standalone",
};

export default nextConfig;
