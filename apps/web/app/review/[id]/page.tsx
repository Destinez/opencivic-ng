import type { Metadata } from 'next';
import Link from 'next/link';
import { SheetReview } from './sheet-review';

export const metadata: Metadata = { title: 'Compare result sheets' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <p>
        <Link href="/review">Review queue</Link>
      </p>
      <h1>Compare result sheets</h1>
      <p className="lede">
        Check the documents and their provenance. A difference is a reason to investigate; it does
        not establish an official result.
      </p>
      <SheetReview id={id} />
    </>
  );
}
