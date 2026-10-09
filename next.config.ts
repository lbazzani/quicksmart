import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produzione in container (piattaforma SparkTech, 2026-09-08): l'output
  // standalone porta nell'immagine solo i file necessari. In sviluppo non
  // cambia nulla.
  output: "standalone",

  // L'Ingress manda qui quicksmart.it, www.quicksmart.it e i nomi del cluster
  // (server-sparktech, manifests/apps/bazzani/quicksmart.yaml): per Google
  // erano copie dello stesso sito, e chi giocava su www condivideva link www.
  async redirects() {
    return [
      {
        // /api/ escluso: una pagina già aperta su www che chiama le API non
        // deve ricevere un redirect verso un'altra origine (CORS, partita persa)
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "www.quicksmart.it" }],
        destination: "https://quicksmart.it/:path",
        permanent: true,
      },
    ];
  },

  // I nomi del cluster servono per le prove: restano raggiungibili, ma fuori
  // dall'indice
  async headers() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "quicksmart(-nuovo)?\\.sparktech\\.it" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
};

export default nextConfig;
