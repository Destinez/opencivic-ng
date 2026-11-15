import { DATASET_DISCLAIMER, PRODUCT_DISCLAIMER, RESULTS_DISCLAIMER } from '@opencivic/shared';
import { sheetMatchPaths } from './openapi-sheetmatch';

const identifier = {
  type: 'string',
  minLength: 1,
  maxLength: 160,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]*$',
};
const electionSlug = {
  type: 'string',
  minLength: 1,
  maxLength: 120,
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
};

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
};

export function openApiDocument() {
  const document = {
    openapi: '3.0.3',
    info: {
      title: 'OpenCivic NG API',
      version: '0.1.0',
      description: [
        PRODUCT_DISCLAIMER,
        DATASET_DISCLAIMER,
        RESULTS_DISCLAIMER,
        'Public read endpoints never set official to true.',
        'Registration and sign-in are public. Other account, submission, review, and admin operations use the oc_session cookie.',
        'Postgres shares request limits across instances: 120 per minute per connection address, sign-in 10 per 15 minutes per address and email, registration 5 per hour, observations 10 per hour per observer and 3 per unit per election. A 429 response includes Retry-After for timed quotas. Forwarding headers do not change the client address.',
        'Query parameters must occur once. Unknown query fields and invalid values return 422. JSON bodies are limited to 64 KiB; multipart observations to 2,100,000 bytes including the photo and fields.',
      ].join(' '),
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Polling units' },
      { name: 'Elections' },
      { name: 'Aggregates' },
      { name: 'Authenticated' },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'oc_session',
        },
      },
      schemas: { Error: errorSchema },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Polling units'],
          summary: 'Process health',
          responses: { '200': { description: 'The process is up.' } },
        },
      },
      '/v1/states': {
        get: {
          tags: ['Polling units'],
          summary: 'List states in the loaded dataset',
          responses: {
            '200': {
              description:
                'Each state includes dataset (sample or imported), a human notice, pollingUnitCount, and official: false.',
            },
          },
        },
      },
      '/v1/states/{stateId}/lgas': {
        get: {
          tags: ['Polling units'],
          summary: 'List local government areas in a state',
          parameters: [{ name: 'stateId', in: 'path', required: true, schema: identifier }],
          responses: { '200': { description: 'LGAs' }, '404': { description: 'Unknown state' } },
        },
      },
      '/v1/lgas/{lgaId}/wards': {
        get: {
          tags: ['Polling units'],
          summary: 'List wards in a local government area',
          parameters: [{ name: 'lgaId', in: 'path', required: true, schema: identifier }],
          responses: { '200': { description: 'Wards' }, '404': { description: 'Unknown LGA' } },
        },
      },
      '/v1/polling-units': {
        get: {
          tags: ['Polling units'],
          summary: 'Search or filter polling units',
          parameters: [
            {
              name: 'q',
              in: 'query',
              schema: { type: 'string', minLength: 2, maxLength: 100 },
              description:
                'Trimmed search text, 2 to 100 characters. Control characters are rejected.',
            },
            { name: 'stateId', in: 'query', schema: identifier },
            { name: 'lgaId', in: 'query', schema: identifier },
            { name: 'wardId', in: 'query', schema: identifier },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0, minimum: 0, maximum: 5000 },
            },
          ],
          responses: {
            '200': {
              description:
                'Matching units. Codes that start with SAMPLE/ are demonstration rows. official is false.',
            },
          },
        },
      },
      '/v1/polling-units/{id}': {
        get: {
          tags: ['Polling units'],
          summary: 'One polling unit, with its ward, LGA, and state',
          parameters: [{ name: 'id', in: 'path', required: true, schema: identifier }],
          responses: {
            '200': { description: 'Polling unit' },
            '404': { description: 'Unknown unit' },
          },
        },
      },
      '/v1/elections': {
        get: {
          tags: ['Elections'],
          summary: 'Elections and the demonstration poll',
          responses: {
            '200': { description: 'Includes fictional and acceptsSubmissions. official is false.' },
          },
        },
      },
      '/v1/elections/{slug}': {
        get: {
          tags: ['Elections'],
          summary: 'One election, with dates and guidance blocks',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: electionSlug }],
          responses: {
            '200': {
              description:
                'Guidance blocks set unverified when the underlying operational fact was not confirmed.',
            },
            '404': { description: 'Unknown election' },
          },
        },
      },
      '/v1/aggregates': {
        get: {
          tags: ['Aggregates'],
          summary: 'Approved unofficial observations, rolled up',
          parameters: [
            {
              name: 'election',
              in: 'query',
              required: true,
              schema: electionSlug,
              description: 'Election slug.',
            },
            {
              name: 'level',
              in: 'query',
              required: true,
              schema: { type: 'string', enum: ['state', 'lga', 'ward'] },
            },
            {
              name: 'parentId',
              in: 'query',
              schema: identifier,
              description:
                'Required for lga (a state ID) and ward (an LGA ID). Omit for state totals.',
            },
          ],
          responses: {
            '200': {
              description:
                'Newest approved submission per polling unit. Pending and flagged rows are excluded. pollingUnitsTotal counts units in this database, not the national INEC list.',
            },
            '404': { description: 'Unknown election or parent area' },
          },
        },
      },
      '/v1/auth/register': {
        post: {
          tags: ['Authenticated'],
          summary: 'Create an observer account',
          responses: { '201': { description: 'Signed in' }, '422': { description: 'Validation' } },
        },
      },
      '/v1/auth/login': {
        post: {
          tags: ['Authenticated'],
          summary: 'Sign in',
          responses: { '200': { description: 'Signed in' }, '401': { description: 'Rejected' } },
        },
      },
      '/v1/auth/logout': {
        post: {
          tags: ['Authenticated'],
          summary: 'Sign out of this session',
          security: [{ sessionCookie: [] }],
          responses: { '200': { description: 'Signed out' } },
        },
      },
      '/v1/auth/me': {
        get: {
          tags: ['Authenticated'],
          summary: 'Current account',
          security: [{ sessionCookie: [] }],
          responses: { '200': { description: 'Account' }, '401': { description: 'Signed out' } },
        },
        delete: {
          tags: ['Authenticated'],
          summary: 'Delete the current account',
          description:
            'Replaces the name and email, drops sessions, and keeps the audit log. The log stores an opaque id, not the email.',
          security: [{ sessionCookie: [] }],
          responses: { '200': { description: 'Deleted' } },
        },
      },
      '/v1/submissions': {
        post: {
          tags: ['Authenticated'],
          summary: 'File an unofficial observation',
          description:
            'JSON or multipart, with required clientId (UUID) and capturedAt (ISO timestamp within the election window). Retrying identical figures with the same clientId returns the existing submission. Changed figures under that ID return 409. Send the photo separately to let figures arrive first. Only observers may submit.',
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Existing submission returned for a retry' },
            '201': { description: 'Stored as pending' },
            '409': { description: 'Election is closed' },
          },
        },
      },
      '/v1/submissions/mine': {
        get: {
          tags: ['Authenticated'],
          summary: 'Observations filed by the signed-in person',
          security: [{ sessionCookie: [] }],
          responses: { '200': { description: 'List' } },
        },
      },
      '/v1/submissions/{id}/photo': {
        post: {
          tags: ['Authenticated'],
          summary: 'Attach the observer’s sheet photo',
          description:
            'Owner only. Multipart photo, JPEG/PNG/WebP up to 2 MB. The server re-encodes to JPEG, removes EXIF/GPS, and stores SHA-256 and perceptual hashes. Repeating the same image returns 200. Evidence cannot be replaced after attachment or review.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: identifier }],
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Photo attached or already present' },
            '409': { description: 'Different image or review already started' },
          },
        },
        get: {
          tags: ['Authenticated'],
          summary: 'Result-sheet photo for the observer or a reviewer',
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Image bytes' },
            '401': { description: 'Signed out' },
          },
        },
      },
      '/v1/review/submissions': {
        get: {
          tags: ['Authenticated'],
          summary: 'Review queue',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: {
                type: 'string',
                enum: [
                  'pending',
                  'in_review',
                  'approved',
                  'flagged',
                  'rejected',
                  'superseded',
                  'withdrawn',
                ],
                default: 'pending',
              },
            },
          ],
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Queue' },
            '403': { description: 'Reviewer or admin only' },
          },
        },
      },
      '/v1/review/submissions/{id}': {
        post: {
          tags: ['Authenticated'],
          summary: 'Approve or flag a pending observation',
          description:
            'A person cannot decide their own submission. Flagging requires a note of at least 8 characters. The decision is appended to the audit log.',
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Decided' },
            '409': { description: 'Already decided' },
          },
        },
      },
      '/v1/admin/users': {
        get: {
          tags: ['Authenticated'],
          summary: 'List active accounts for admins',
          security: [{ sessionCookie: [] }],
          responses: { '200': { description: 'Accounts' }, '403': { description: 'Admin only' } },
        },
      },
      '/v1/admin/audit': {
        get: {
          tags: ['Authenticated'],
          summary: 'Append-only audit log',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            },
          ],
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Newest events' },
            '403': { description: 'Admin only' },
          },
        },
      },
      '/v1/admin/users/{id}/role': {
        post: {
          tags: ['Authenticated'],
          summary: 'Change a role',
          description: 'An admin cannot change their own role or remove the last admin.',
          security: [{ sessionCookie: [] }],
          responses: { '200': { description: 'Updated' } },
        },
      },
    },
  };
  Object.assign(document.paths, sheetMatchPaths);
  const errorContent = { 'application/json': { schema: errorSchema } };
  for (const [path, methods] of Object.entries(document.paths)) {
    if (path === '/health') continue;
    for (const [method, operation] of Object.entries(methods)) {
      Object.assign(operation.responses, {
        '422': { description: 'Invalid request fields', content: errorContent },
        '414': { description: 'URL exceeds 8 KiB', content: errorContent },
        '429': {
          description: 'Request quota exhausted',
          headers: {
            'Retry-After': {
              schema: { type: 'integer', minimum: 1 },
              description: 'Seconds before retrying',
            },
          },
          content: errorContent,
        },
      });
      if (method === 'post' || method === 'delete') {
        Object.assign(operation.responses, {
          '400': { description: 'Unreadable request body', content: errorContent },
          '413': { description: 'Request body exceeds the size limit', content: errorContent },
          '415': { description: 'Unsupported content type', content: errorContent },
        });
      }
    }
  }
  return document;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] ?? char;
  });
}

export function docsHtml(): string {
  const spec = openApiDocument();
  const rows = Object.entries(spec.paths)
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => {
        const op = operation as { summary?: string; tags?: string[] };
        return `<tr><td><code>${escapeHtml(method.toUpperCase())}</code></td><td><code>${escapeHtml(path)}</code></td><td>${escapeHtml(op.tags?.[0] ?? '')}</td><td>${escapeHtml(op.summary ?? '')}</td></tr>`;
      }),
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenCivic NG API</title>
  <style>
    body { font-family: "Source Sans 3", "Segoe UI", sans-serif; margin: 0; background: #f4f0e6; color: #1c1915; }
    main { width: min(960px, calc(100% - 32px)); margin: 32px auto 64px; }
    h1 { font-family: "Source Serif 4", Georgia, serif; }
    table { width: 100%; border-collapse: collapse; background: #fffdf8; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e0d6c6; vertical-align: top; }
    a { color: #0a3f73; }
    .note { background: #f8eccf; padding: 12px 14px; border: 1px solid #e2c98a; }
  </style>
</head>
<body>
  <main>
    <h1>OpenCivic NG API</h1>
    <p class="note">${escapeHtml(PRODUCT_DISCLAIMER)} ${escapeHtml(DATASET_DISCLAIMER)} ${escapeHtml(RESULTS_DISCLAIMER)}</p>
    <p>Machine-readable document: <a href="/v1/openapi.json">/v1/openapi.json</a>.</p>
    <table>
      <caption>Routes</caption>
      <thead><tr><th>Method</th><th>Path</th><th>Tag</th><th>Summary</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}
