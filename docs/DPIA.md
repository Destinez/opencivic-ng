# Data protection impact assessment

Owner: Obaro Destiny Udurie. Scope: the fictional Sheet Match demonstration. Reviewed 15 November 2026. Reassess before a real election, new partner, new source or new processing purpose.

Purpose: compare observer EC8A figures with manually cited reference documents and publish independently checked document discrepancies. INEC alone declares election results. No automated harvesting of IReV, voter-register data, party membership or photographs of people are allowed.

The controller name and privacy email are configured with `PRIVACY_CONTROLLER_NAME` and `PRIVACY_CONTACT_EMAIL`. The local default identifies the personal demo project. A real deployment needs a named organisation, trained reviewers, reviewed lawful bases and a legal sign-off.

Account storage and observation evidence have separate timestamped consent records. Evidence consent can be withdrawn in Account; account-storage consent can be withdrawn by deleting the account. Downloads include personal records and stored photos. Corrections, objections and complaints go to the displayed contact. Published evidence is retained as a de-identified public record; legal review must assess the appropriate retention basis before any real election use.

The data flow is browser → same-origin API proxy → Hono → Postgres/private photo volume. The phone outbox holds unsent figures and compressed photos in IndexedDB. It is scoped to the signed-in account; withdrawal and deletion clear that account's drafts. Metadata and GPS are removed on both client and server. Reviewers see identities; public/desk cases expose pseudonyms. Password hashes and session tokens are never exported.

Observer retaliation is the highest privacy risk. Mitigations are pseudonyms, private raw submissions, least-privilege roles, sheet-only capture guidance, rejection of images containing personal information and contact-detail checks on notes. A photographed signature can still identify a person: reviewers must check the whole image before public confirmation and reject any image needing redaction. Automatic contact detection is incomplete and does not replace that check.

Misinformation risk is reduced by two-person reference verification, independent case confirmation, immutable published snapshots, hash-sealed evidence, provenance and visible retractions. Duplicate-image signals are private abuse checks and cannot support a public case. Shared networks and devices can be legitimate; signals require human investigation.

Compromise risks are mitigated by TLS, encrypted storage volumes/backups, hashed sessions, private database access, bounded uploads, source validation, shared quotas and append-only hash-chained audit. The operator must verify volume encryption; Compose alone does not encrypt a volume. Store deployment secrets in environment variables, restrict backups and test restores.

Raw observer/reference photos and unpublished archives expire 180 days after the election; published/retracted evidence is retained. Connection/device hashes expire after 30 days. Run `pnpm privacy:retain` daily using the same database and upload directory as the API. The durable file-deletion queue retries interrupted cleanup and never deletes a path referenced by retained evidence. Account deletion removes unpublished submissions and de-identifies retained ones while preserving the private audit trail.

Residual risks include inference from image content/location, malicious or mistaken reviewer decisions, re-identification of pseudonyms, unreviewed translations and device theft. Real-election deployment remains blocked until counsel and the partner controller approve the lawful bases, retention schedule, reviewer guidance, rights process and incident response. Hausa, Yoruba, Igbo and Pidgin keys are reserved; reviewed translations are not shipped.
