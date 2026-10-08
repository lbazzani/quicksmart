import type { MetadataRoute } from 'next';

/** Le pagine da cui si entra nel gioco. La sfida cambia ogni giorno. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://quicksmart.it';
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/sfida`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/come-si-gioca`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/solo`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/new`, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
