'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/lookup', label: 'Polling units' },
  { href: '/elections', label: 'Elections' },
  { href: '/results', label: 'Tallies', exact: true },
  { href: '/results/new', label: 'Report' },
  { href: '/review', label: 'Review' },
  { href: '/account', label: 'Account' },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="shell header-row">
        <Link className="wordmark" href="/">
          OpenCivic <span>NG</span>
        </Link>
        <nav className="nav" aria-label="Primary">
          {links.map((link) => {
            const current = link.exact
              ? path === link.href
              : path === link.href || path.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} aria-current={current ? 'page' : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
