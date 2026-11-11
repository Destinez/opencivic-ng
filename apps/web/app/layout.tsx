import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { PRODUCT_DISCLAIMER } from '@opencivic/shared/labels';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'OpenCivic NG', template: '%s · OpenCivic NG' },
  description:
    'Unofficial Nigerian election tools: polling-unit lookup, voter guidance, and crowdsourced observation tallies.',
};

export const viewport: Viewport = {
  themeColor: '#0f5132',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <p className="banner">
          {PRODUCT_DISCLAIMER} Sample locations are not official polling units. Tallies are
          crowdsourced observations, not results.
        </p>
        <SiteHeader />
        <main id="main" className="shell">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
