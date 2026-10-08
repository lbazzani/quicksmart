import type { MetadataRoute } from 'next';

/**
 * Fino al 9/10/2026 /robots.txt rispondeva 404: i motori di ricerca passavano
 * lo stesso (Googlebot c'era), ma senza sitemap e senza sapere cosa lasciar
 * stare. Le partite (/g/…) durano un'ora e non hanno niente da indicizzare;
 * /api/ non è una pagina; /anteprima esiste solo in test.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/g/', '/anteprima'] }],
    sitemap: 'https://quicksmart.it/sitemap.xml',
    host: 'https://quicksmart.it',
  };
}
