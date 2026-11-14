'use client';

import type { SubmissionCard } from '@/lib/types';
import { PARTY_CODES } from '@opencivic/shared/parties';

export function ReferenceForm({
  row,
  busy,
  onSave,
}: { row: SubmissionCard; busy: boolean; onSave: (form: FormData) => Promise<void> }) {
  const sample = row.pollingUnit.dataset === 'sample';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const form = new FormData();
        form.set(
          'record',
          JSON.stringify({
            electionId: row.electionId,
            pollingUnitId: row.pollingUnit.id,
            source: sample ? 'sample' : 'irev',
            sourceUrl: data.get('sourceUrl'),
            retrievedAt: new Date(String(data.get('retrievedAt'))).toISOString(),
            accreditedVoters: Number(data.get('accredited')),
            rejectedBallots: Number(data.get('rejected')),
            partyVotes: Object.fromEntries(
              [...PARTY_CODES, 'others'].map((party) => [party, Number(data.get(party))]),
            ),
          }),
        );
        form.set('photo', data.get('photo') as File);
        void onSave(form);
      }}
    >
      <p>
        {sample
          ? 'SAMPLE reference for this fictional poll.'
          : 'Manually transcribe the published IReV record. No automated fetching takes place.'}{' '}
        Photograph the sheet only, with no faces.
      </p>
      <div className="field">
        <label htmlFor="ref-url">Reference source URL</label>
        <input
          id="ref-url"
          name="sourceUrl"
          type="url"
          required
          defaultValue={sample ? 'https://example.com/sample-reference' : ''}
          maxLength={2000}
        />
      </div>
      <div className="field">
        <label htmlFor="ref-time">Reference retrieval time</label>
        <input
          id="ref-time"
          name="retrievedAt"
          type="datetime-local"
          required
          defaultValue={new Date().toISOString().slice(0, 16)}
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="ref-accredited">Reference accredited voters</label>
          <input
            id="ref-accredited"
            name="accredited"
            type="number"
            min={0}
            max={200000}
            defaultValue={row.accreditedVoters}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="ref-rejected">Reference rejected ballots</label>
          <input
            id="ref-rejected"
            name="rejected"
            type="number"
            min={0}
            max={200000}
            defaultValue={row.rejectedBallots}
            required
          />
        </div>
      </div>
      <div className="grid-3">
        {[...PARTY_CODES, 'others' as const].map((party) => (
          <div className="field" key={party}>
            <label htmlFor={`ref-${party}`}>Reference {party}</label>
            <input
              id={`ref-${party}`}
              name={party}
              type="number"
              min={0}
              max={200000}
              required
              defaultValue={row.partyVotes[party]}
            />
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="ref-photo">Reference sheet photo</label>
        <input
          id="ref-photo"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          aria-describedby="ref-photo-help"
        />
        <p id="ref-photo-help">
          JPEG, PNG or WebP, up to 2 MB. Image location metadata is removed.
        </p>
      </div>
      <button type="submit" disabled={busy}>
        Attach reference
      </button>
    </form>
  );
}
