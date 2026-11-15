import type { Metadata } from 'next';
import { ReviewQueue } from './review-queue';

export const metadata: Metadata = { title: 'Review queue' };

export default function ReviewPage() {
  return (
    <>
      <p className="kicker">Reviewer</p>
      <h1>Review queue</h1>
      <p className="lede">
        Claim a sheet for ten minutes, check its photo and figures, then record a decision. New
        observers need two independent approvals. You cannot review your own sheet.
      </p>
      <ReviewQueue />
    </>
  );
}
