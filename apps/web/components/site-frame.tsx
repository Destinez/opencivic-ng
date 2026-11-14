'use client';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { PRODUCT_DISCLAIMER } from '@opencivic/shared/labels';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function SiteFrame({ children }: { children: ReactNode }) {
  const observer = usePathname() === '/results/new';
  return (
    <div className={observer ? 'observer-flow' : undefined}>
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
    </div>
  );
}
