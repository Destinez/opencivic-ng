import type { Metadata } from 'next';
import { CaseBoard } from './case-board';

export const metadata: Metadata = { title: 'Discrepancy board' };
export default function Page() {
  return (
    <>
      <p className="kicker">Sheet Match</p>
      <h1>Discrepancy board</h1>
      <p className="lede">
        Find confirmed differences between polling-unit documents. Each published case has two
        independent reviewers, a provenance trail, and an evidence download. All findings are
        unofficial.
      </p>
      <CaseBoard />
    </>
  );
}
