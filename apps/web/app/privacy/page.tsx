import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <article>
      <p className="kicker">Nigeria Data Protection Act 2023</p>
      <h1>Privacy</h1>
      <p className="lede">
        This note describes the demo. It is not a filing with the Nigeria Data Protection
        Commission, and a public deployment needs its own controller and contact address.
      </p>
      <section className="card">
        <h2>What is stored</h2>
        <ul>
          <li>Name, email address, and a password hash, if you create an account.</li>
          <li>The observations you file, and an optional photo of a result sheet.</li>
          <li>A session cookie on this browser.</li>
        </ul>
        <p>
          The legal frame is the Nigeria Data Protection Act 2023. The commission’s site is{' '}
          <a href="https://ndpc.gov.ng/">ndpc.gov.ng</a>. Consent is collected at registration, for
          the purpose of attributing unofficial observations.
        </p>
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        <h2>What is not published</h2>
        <p>
          Aggregate pages show counts, not names. Result-sheet photos are shown to the person who
          uploaded them and to reviewers. They are not placed on the public tally.
        </p>
        <p>
          Deleting an account replaces the name and email, drops the password, and ends sessions.
          The audit log stays, with an opaque id and without the email. That log cannot be edited.
        </p>
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        <h2>This demo</h2>
        <p>
          Running it on your machine keeps the database on that machine. The seeded accounts use
          public passwords and example.com addresses. Do not point a public hostname at those
          defaults.
        </p>
      </section>
    </article>
  );
}
