import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Privacy' };
export default function PrivacyPage() {
  const controller =
    process.env.PRIVACY_CONTROLLER_NAME ?? 'Obaro Destiny Udurie — personal demo project';
  const contact = process.env.PRIVACY_CONTACT_EMAIL ?? 'obarodestinez@gmail.com';
  return (
    <article>
      <p className="kicker">Nigeria Data Protection Act 2023</p>
      <h1>Privacy</h1>
      <p className="lede">
        This fictional election demo stores only what is needed to check result sheets. OpenCivic is
        unofficial. INEC alone declares results.
      </p>
      <section className="card outbox">
        <h2>Who controls your data</h2>
        <p>
          {controller}. Contact <a href={`mailto:${contact}`}>{contact}</a> for access, corrections,
          an objection or a complaint.
        </p>
        <p>
          You may also complain to the{' '}
          <a href="https://ndpc.gov.ng/">Nigeria Data Protection Commission</a>. A real election
          deployment requires a legal review and an organisation responsible for responding to
          requests.
        </p>
      </section>
      <section className="card outbox">
        <h2>Your consent and choices</h2>
        <p>
          Registration records your consent to account storage with a timestamp. Filing a sheet
          separately records consent to storing observation evidence and publishing it after
          independent review. We do not collect party membership or voter-register data.
        </p>
        <p>
          In Account, download your records and photos, withdraw evidence consent, or delete your
          account. Withdrawal stops new sheets and removes unpublished observations. Published case
          evidence stays to preserve the public record, with your identity removed when the account
          is deleted. Contact the controller about any personal information in an image or note.
        </p>
      </section>
      <section className="card outbox">
        <h2>What is stored and shown</h2>
        <p>
          We store your name, email, password hash, role, trust level, consents, observations,
          reviews and audit events. Sessions use a secure cookie when HTTPS is configured. Passwords
          and session tokens are excluded from exports.
        </p>
        <p>
          Photos must show the sheet only, with no faces or voter details. GPS and EXIF are stripped
          before storage. Reviewers can reject photos containing personal information. Independently
          confirmed case photos become public alongside document figures, source URLs, retrieval
          times and hashes. Observer names and emails are never public; cases use pseudonyms. Notes
          warn about phone numbers and email addresses.
        </p>
        <p>
          Hashed connection addresses and a random device identifier help reviewers inspect
          coordinated submissions. We keep these signals for 30 days. A shared connection does not
          prove misuse.
        </p>
      </section>
      <section className="card outbox">
        <h2>Retention and security</h2>
        <p>
          Raw observer and reference photos expire 180 days after the election, unless included in a
          published or retracted case. The scheduled retention job also deletes expired
          connection/device signals and unpublished evidence archives. Published evidence, its
          hashes and the append-only audit chain remain available. Account deletion ends sessions
          and removes name, email, password and trust details.
        </p>
        <p>
          Operators must use TLS, an encrypted photo volume, private database credentials and access
          limited by role. This local demo does not provide a public hosting service. Audit rows
          preserve opaque record identifiers without copying account emails.
        </p>
      </section>
    </article>
  );
}
