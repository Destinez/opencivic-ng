import type { Metadata } from 'next';
import { ReviewQueue } from './review-queue';

export const metadata: Metadata = { title: 'Review queue' };

export default function ReviewPage() {
  return (
    <>
      <p className="kicker">Reviewer</p>
      <h1>Review queue</h1>
      <p className="lede">
        Approve or flag a pending observation. You cannot decide a sheet you filed yourself. Photos
        are visible here and are not published on the tally.
      </p>
      <ReviewQueue />
    </>
  );
}
