import type { Metadata } from 'next';
import { SubmitForm } from './submit-form';

export const metadata: Metadata = { title: 'File an observation' };

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ pollingUnitId?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <p className="kicker">Observer</p>
      <h1>File an unofficial observation</h1>
      <p className="lede">
        This records what you say you saw. It stays pending until a different person reviews it, and
        it is still unofficial after that. Do not upload a voter register, a face, or anyone else’s
        identity document.
      </p>
      <SubmitForm initialUnitId={params.pollingUnitId} />
    </>
  );
}
