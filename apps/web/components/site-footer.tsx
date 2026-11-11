import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <nav aria-label="About">
          <Link href="/privacy">Privacy</Link>
          <Link href="/developers">API</Link>
          <a href="https://www.inecnigeria.org/">INEC</a>
          <a href="https://cvr.inecnigeria.org/pu">INEC polling-unit portal</a>
        </nav>
        <p>
          OpenCivic NG is an unofficial project by Obaro Destiny Udurie. It is not INEC, it does not
          declare winners, and sample locations are not official polling units.
        </p>
      </div>
    </footer>
  );
}
