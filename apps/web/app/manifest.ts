import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OpenCivic NG',
    short_name: 'OpenCivic',
    description: 'Unofficial civic tools for Nigerian elections.',
    start_url: '/results/new',
    scope: '/',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    display: 'standalone',
    background_color: '#f3efe4',
    theme_color: '#0f5132',
  };
}
