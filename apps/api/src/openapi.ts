import { DATASET_DISCLAIMER, PRODUCT_DISCLAIMER, RESULTS_DISCLAIMER } from '@opencivic/shared';

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
  return {
    openapi: '3.0.3',
    info: {
      title: 'OpenCivic NG API',
      version: '0.1.0',
      description: [
        PRODUCT_DISCLAIMER,
        DATASET_DISCLAIMER,
        RESULTS_DISCLAIMER,
        'Public read endpoints never set official to true.',
        'Write endpoints use the oc_session cookie. They are documented here so the contract is complete, and they are not anonymous.',
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
          parameters: [{ name: 'stateId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'LGAs' }, '404': { description: 'Unknown state' } },
        },
      },
      '/v1/lgas/{lgaId}/wards': {
        get: {
          tags: ['Polling units'],
          summary: 'List wards in a local government area',
          parameters: [{ name: 'lgaId', in: 'path', required: true, schema: { type: 'string' } }],
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
              schema: { type: 'string' },
              description: 'At least 2 characters.',
            },
            { name: 'stateId', in: 'query', schema: { type: 'string' } },
            { name: 'lgaId', in: 'query', schema: { type: 'string' } },
            { name: 'wardId', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
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
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
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
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
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
              schema: { type: 'string' },
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
              schema: { type: 'string' },
              description: 'Required for lga (a state id) and ward (an LGA id).',
            },
          ],
          responses: {
            '200': {
              description:
                'Newest approved submission per polling unit. Pending and flagged rows are excluded. pollingUnitsTotal counts units in this database, not the national INEC list.',
            },
            '404': { description: 'Unknown election' },
          },
        },
      },
      '/v1/auth/register': {
        post: {
          tags: ['Authenticated'],
          summary: 'Create an observer account',
          security: [{ sessionCookie: [] }],
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
            'JSON or multipart. Multipart may include a photo field (JPEG, PNG, or WebP, up to 2 MB). The photo is not published on the aggregate.',
          security: [{ sessionCookie: [] }],
          responses: {
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
                enum: ['pending', 'approved', 'flagged'],
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
      '/v1/admin/audit': {
        get: {
          tags: ['Authenticated'],
          summary: 'Append-only audit log',
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
