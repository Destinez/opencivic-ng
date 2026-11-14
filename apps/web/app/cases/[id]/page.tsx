import type { Metadata } from 'next';
import { CaseView } from './case-view';

export const metadata: Metadata = { title: 'Discrepancy case' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <p className="kicker">Sheet Match</p>
      <h1>Discrepancy case</h1>
      <p className="lede">
        A documented difference between result sheets. This is unofficial evidence for further
        checking.
      </p>
      <CaseView id={id} />
    </>
  );
}
