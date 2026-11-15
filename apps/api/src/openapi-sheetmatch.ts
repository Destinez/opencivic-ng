const auth = [{ sessionCookie: [] }];
const result = {
  '200': { description: 'Unofficial record with disclaimer and requestId' },
  '401': { description: 'Sign in required' },
  '403': { description: 'Role or independence requirement not met' },
  '404': { description: 'Record not found' },
  '409': { description: 'Claim or workflow conflict' },
};
const id = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', maxLength: 160 } }];

export const sheetMatchPaths = {
  '/v1/me/export': {
    get: {
      tags: ['Authenticated'],
      summary: 'Download your personal records and stored photos',
      description:
        'ZIP containing account.json and photos. Password hashes, session tokens and storage paths are excluded. Account JSON includes official: false and the disclaimer.',
      security: auth,
      responses: {
        ...result,
        '200': {
          description: 'Personal data ZIP',
          content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
        },
      },
    },
  },
  '/v1/me/consent': {
    post: {
      tags: ['Authenticated'],
      summary: 'Withdraw or restore observation-evidence consent',
      description:
        'Withdrawal removes unpublished observations and private evidence packs and stops new submissions. Published evidence remains. Account-storage consent is withdrawn with account deletion.',
      security: auth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['purpose', 'granted'],
              properties: {
                purpose: { type: 'string', enum: ['observation_evidence'] },
                granted: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: result,
    },
  },
  '/v1/admin/observers': {
    get: {
      tags: ['Authenticated'],
      summary: 'List observer trust, counts and freezes for admins',
      security: auth,
      responses: result,
    },
  },
  '/v1/admin/observers/{id}/trust': {
    post: {
      tags: ['Authenticated'],
      summary: 'Document an admin trust or accreditation decision',
      parameters: id,
      security: auth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['trustLevel', 'frozen', 'note'],
              properties: {
                trustLevel: { type: 'integer', minimum: 0, maximum: 3 },
                frozen: { type: 'boolean' },
                accreditationRef: { type: 'string', nullable: true, maxLength: 160 },
                homeStateId: { type: 'string', nullable: true },
                note: { type: 'string', minLength: 8, maxLength: 500 },
              },
            },
          },
        },
      },
      responses: result,
    },
  },
  '/v1/admin/abuse': {
    get: {
      tags: ['Authenticated'],
      summary:
        'Review duplicate-image and shared connection/device signals from the last thirty days',
      security: auth,
      responses: result,
    },
  },
  '/v1/admin/elections/{id}/config': {
    post: {
      tags: ['Authenticated'],
      summary: 'Change the election submission switch with an audit note',
      parameters: id,
      security: auth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['acceptsSubmissions', 'note'],
              properties: {
                acceptsSubmissions: { type: 'boolean' },
                note: { type: 'string', minLength: 8, maxLength: 500 },
              },
            },
          },
        },
      },
      responses: result,
    },
  },
  '/v1/cases': {
    get: {
      tags: ['Sheet Match'],
      summary: 'Filter published cases or the desk’s non-draft queue',
      description:
        'No account or embargo for published/retracted records. Public status=published includes retracted cases. Desk can request all non-drafts; reviewers and admins can include drafts. Returns data and nextPageToken, ordered by server creation time and ID. Tokens preserve microseconds and are bound to filters and access. No observer identities.',
      parameters: [
        ...['election', 'state', 'lga'].map((name) => ({
          name,
          in: 'query',
          schema: { type: 'string', maxLength: 160 },
        })),
        {
          name: 'severity',
          in: 'query',
          schema: { type: 'string', enum: ['info', 'warn', 'critical'] },
        },
        {
          name: 'status',
          in: 'query',
          schema: {
            type: 'string',
            default: 'published',
            enum: [
              'published',
              'retracted',
              'under_investigation',
              'confirmed',
              'open',
              'explained',
              'dismissed',
              'all',
            ],
          },
        },
        { name: 'page_token', in: 'query', schema: { type: 'string', maxLength: 1000 } },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      ],
      responses: result,
    },
    post: {
      tags: ['Authenticated'],
      summary: 'Open a private case from current discrepancy flags',
      description:
        'Reviewer or admin. All flags must concern one unit/election. Duplicate-image abuse signals are excluded. Observations need reviewed photos; L0 needs two approvals and another observer’s corroboration. One active case per unit/election.',
      security: auth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['flagIds', 'summary'],
              properties: {
                flagIds: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 50,
                  uniqueItems: true,
                  items: { type: 'string' },
                },
                summary: { type: 'string', minLength: 10, maxLength: 1000 },
              },
            },
          },
        },
      },
      responses: { ...result, '201': { description: 'Case opened, still private' } },
    },
  },
  '/v1/cases/{id}': {
    get: {
      tags: ['Sheet Match'],
      summary: 'Published case facts, evidence snapshots and public history',
      description:
        'Public after publication, including retracted cases. Reviewers/admins can see drafts; desk accounts can read non-drafts. Observer identities and private notes are not exposed publicly. Includes permissions for the current account.',
      parameters: id,
      responses: result,
    },
  },
  '/v1/cases/{id}/history': {
    get: {
      tags: ['Sheet Match'],
      summary: 'Case history with audit-chain anchors and pseudonymous actors',
      parameters: id,
      responses: result,
    },
  },
  '/v1/polling-units/{id}/sheetmatch': {
    get: {
      tags: ['Sheet Match'],
      summary: 'Published cases and counts for a polling unit',
      description:
        'Only published or retracted cases contribute to counts. No private flags or observer identities are disclosed.',
      parameters: [
        ...id,
        {
          name: 'election',
          in: 'query',
          required: true,
          schema: { type: 'string', description: 'Election ID or slug' },
        },
      ],
      responses: result,
    },
  },
  '/v1/cases/{id}/evidence-pack': {
    get: {
      tags: ['Sheet Match'],
      summary: 'Download the current hash-sealed evidence ZIP',
      description:
        'Public for published and retracted cases; other readable cases require a reviewer, desk or admin session. Streams case.json, original case images, provenance.json, audit.json, manifest.json, SHA256SUMS and a disclaimer. Each archive is versioned; retractions produce a new version. Image hashes must match the saved case evidence.',
      parameters: id,
      responses: {
        ...result,
        '200': {
          description: 'Evidence ZIP stream',
          headers: {
            'X-Content-SHA256': {
              schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
              description: 'SHA-256 of the complete ZIP response body',
            },
          },
          content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
        },
      },
    },
  },
  '/v1/cases/{id}/images/{kind}/{recordId}': {
    get: {
      tags: ['Sheet Match'],
      summary: 'Display a hash-verified image attached to a readable case',
      parameters: [
        ...id,
        {
          name: 'kind',
          in: 'path',
          required: true,
          schema: { type: 'string', enum: ['observer', 'reference'] },
        },
        { name: 'recordId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: result,
    },
  },
  '/v1/cases/{id}/transition': {
    post: {
      tags: ['Authenticated'],
      summary: 'Investigate, independently confirm, resolve or retract a case',
      description:
        'open → under_investigation → confirmed/explained/dismissed. Confirmation requires verified references and a reviewer other than the opener; it publishes immediately in the same transaction. Published evidence is immutable. Two different admins must request and confirm retraction; the original case remains visible. Every transition writes an atomic audit event.',
      security: auth,
      parameters: id,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['to', 'note'],
              properties: {
                to: {
                  type: 'string',
                  enum: ['under_investigation', 'confirmed', 'explained', 'dismissed', 'retracted'],
                },
                note: { type: 'string', minLength: 8, maxLength: 1000 },
              },
            },
          },
        },
      },
      responses: result,
    },
  },
  '/v1/cases/{id}/comments': {
    post: {
      tags: ['Authenticated'],
      summary: 'Add a private review or desk comment to a readable case',
      security: auth,
      parameters: id,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['body'],
              properties: { body: { type: 'string', minLength: 1, maxLength: 2000 } },
            },
          },
        },
      },
      responses: { ...result, '201': { description: 'Comment saved and audited' } },
    },
  },
  '/v1/review/submissions/{id}/claim': {
    post: {
      tags: ['Authenticated'],
      summary: 'Claim another observer’s sheet for ten minutes',
      description:
        'Reviewer or admin. A competing claim returns 409 claimed_by_other. Repeating an active own claim keeps its original expiry. Previous reviewers cannot claim again.',
      security: auth,
      parameters: id,
      responses: result,
    },
  },
  '/v1/review/submissions/{id}': {
    get: {
      tags: ['Authenticated'],
      summary: 'Private sheet, references, field differences and reviews',
      security: auth,
      parameters: id,
      responses: result,
    },
    post: {
      tags: ['Authenticated'],
      summary: 'Record an independent decision under an active claim',
      description:
        'L0 needs two independent approvals. Flagged or rejected sheets can be checked by a different reviewer. Only the newest approved sheet from the same observer stays active. The review, status and audit event commit together.',
      security: auth,
      parameters: id,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['decision'],
              properties: {
                decision: { type: 'string', enum: ['approved', 'flagged', 'rejected'] },
                reasonCode: {
                  type: 'string',
                  enum: [
                    'checked',
                    'document_mismatch',
                    'unreadable',
                    'missing_photo',
                    'fabrication',
                    'personal_data',
                    'other',
                  ],
                },
                note: {
                  type: 'string',
                  maxLength: 500,
                  description:
                    'At least eight characters and a reason code required for flagging or rejection.',
                },
              },
            },
          },
        },
      },
      responses: result,
    },
  },
  '/v1/submissions/{id}/withdraw': {
    post: {
      tags: ['Authenticated'],
      summary: 'Withdraw an own observation before its first review',
      security: auth,
      parameters: id,
      responses: result,
    },
  },
  '/v1/references': {
    post: {
      tags: ['Authenticated'],
      summary: 'Manually attach a reference transcription and image',
      description:
        'Reviewer or admin; 60 per hour. Multipart photo plus record (JSON): electionId, pollingUnitId, source (irev, ec8a_copy or sample), sourceUrl (HTTPS), retrievedAt (ISO timestamp), accreditedVoters, rejectedBallots, partyVotes and optional declaredTotalVotes. Counts are integers up to 200,000 per field. Sample units require source=sample. Source URLs are cited and never fetched. Images are re-encoded and hashed. A duplicate image for the unit/election returns 409.',
      security: auth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['record', 'photo'],
              properties: {
                record: { type: 'string', description: 'JSON transcription and provenance' },
                photo: {
                  type: 'string',
                  format: 'binary',
                  description: 'One JPEG, PNG or WebP up to 2 MB',
                },
              },
            },
          },
        },
      },
      responses: {
        ...result,
        '201': { description: 'Reference created, awaiting independent verification' },
      },
    },
  },
  '/v1/references/{id}/verify': {
    patch: {
      tags: ['Authenticated'],
      summary: 'Verify a reference entered by a different reviewer',
      description:
        'The transcriber receives 403 two_person_rule, including admins. Verification is immutable and retries do not add audit events.',
      security: auth,
      parameters: id,
      responses: result,
    },
  },
  '/v1/references/{id}/photo': {
    get: {
      tags: ['Authenticated'],
      summary: 'Private reference image for reviewers and admins',
      security: auth,
      parameters: id,
      responses: {
        ...result,
        '200': { description: 'Image bytes with private, no-store caching' },
      },
    },
  },
};
