import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      <p className="kicker">Nigeria · unofficial civic record</p>
      <h1>Find a polling unit. Keep an unofficial count.</h1>
      <p className="lede">
        OpenCivic NG is a non-partisan tool for browsing a polling-unit dataset, reading election
        guidance with the source attached, and publishing observer tallies only after a reviewer has
        looked at them.
      </p>
      <div className="actions">
        <Link className="button" href="/lookup">
          Find a polling unit
        </Link>
        <Link className="button secondary" href="/results">
          View unofficial tallies
        </Link>
      </div>
      <div className="grid-3">
        <article className="card">
          <h2>Lookup</h2>
          <p>
            Browse state, local government, ward, and polling unit. The sample covers a handful of
            wards in Lagos and Edo so the map and the lists can be tried offline from INEC.
          </p>
        </article>
        <article className="card">
          <h2>Guidance</h2>
          <p>
            Key dates and voting steps are copied from INEC’s public pages, with the link beside the
            sentence. Anything this dataset could not confirm is marked unverified.
          </p>
        </article>
        <article className="card">
          <h2>Observations</h2>
          <p>
            A signed-in observer can file figures for the fictional demonstration poll. A different
            person approves or flags them. The public page never calls the result official.
          </p>
        </article>
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <h2>How a tally moves</h2>
        <ol>
          <li>An observer files accredited voters, party figures, and an optional sheet photo.</li>
          <li>
            A reviewer who did not file it approves or flags it. The decision is appended to a log
            that cannot be edited.
          </li>
          <li>
            The public rollup keeps the newest approved sheet per unit and shows how many units are
            still missing.
          </li>
        </ol>
        <p>
          The seeded demo does not collect observations for the real 2027 elections. That switch
          stays off until a deployment is ready to say so out loud.
        </p>
      </section>
    </>
  );
}
