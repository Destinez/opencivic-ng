# Incident response

Owner: Obaro Destiny Udurie. Applies to suspected disclosure, loss, alteration or unauthorised access to account data, observer photos or unpublished evidence.

1. Record discovery time in UTC, the reporter, affected systems and immediate risks. Appoint an incident lead and notify the configured controller contact. Restrict the affected service, revoke compromised sessions/credentials and preserve an encrypted copy of relevant logs and audit-chain verification results. Do not copy observer identities into a public ticket.
2. Determine which people, records, images and backups are affected, whether content was accessed, whether observers face retaliation, and whether public evidence integrity is affected. Keep the original evidence and a chronology; repair using verified backups and rotate secrets through environment variables.
3. Under NDPA 2023 section 40(2), notify the Nigeria Data Protection Commission within **72 hours of becoming aware** when the breach is likely to risk individuals' rights and freedoms. Do not wait for a complete investigation: provide known facts and follow up. Record the awareness time, notification deadline, assessment and decision, including reasons if notification is not required. Use the current official NDPC process at https://ndpc.gov.ng/.
4. Where risk is high, notify affected people **without delay** in clear language: what happened, likely consequences, protective steps and the controller's contact. Avoid public lists of affected observers. The controller approves communications and records when each notice was sent.
5. Restore access only after validating the fix, permissions, audit hash chain, retained photo hashes and evidence ZIPs. A compromised published case remains visible with an explained retraction approved by two different admins. Preserve the history.
6. Review within seven days: root cause, timeline, scope, notification decisions, controls, retention, training and assigned actions. Update this runbook and the DPIA. Test recovery and a notification tabletop before a real-election pilot.

Deployment requirements: TLS, an encrypted photo volume and backups, private database credentials, `COOKIE_SECURE=true`, least-privilege roles, daily retention and audit verification. Public demo passwords must never be exposed on a live hostname.
