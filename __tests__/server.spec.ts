/**
 * Server tests — US-008
 *
 * Tests mainResolver logic directly (exported for testing) and
 * the POST /register endpoint via supertest on the exported express app.
 * Print utility functions (center, prettyPrint) are tested as pure unit tests.
 *
 * The HTTP server never actually binds a port because NODE_ENV=test suppresses
 * the server.listen() call at module load time.
 */

process.env.NODE_ENV = 'test';

import type { IncomingMessage } from 'http';
import supertest from 'supertest';

// Import after setting NODE_ENV=test so server.listen() is skipped
import { mainResolver, registrations, app } from '../src/server';
import { center, prettyPrint } from '../src/print';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake IncomingMessage-shaped object for mainResolver tests.
 * We only need the fields that mainResolver actually reads:
 *   req.headers.host, req.headers['x-envoy-original-path'], req.url
 */
function fakeReq(opts: {
  host?: string;
  url?: string;
  envoyOriginalPath?: string;
}): IncomingMessage {
  return {
    headers: {
      host: opts.host ?? '',
      ...(opts.envoyOriginalPath ? { 'x-envoy-original-path': opts.envoyOriginalPath } : {}),
    },
    url: opts.url ?? '/',
  } as unknown as IncomingMessage;
}

// ---------------------------------------------------------------------------
// mainResolver tests
// ---------------------------------------------------------------------------

describe('mainResolver', () => {
  // Clean registrations before each test — the object is a module singleton
  beforeEach(() => {
    Object.keys(registrations).forEach((k) => delete registrations[k]);
    delete process.env.INGRESS_DOMAIN;
  });

  test('returns registered URL when service is registered', () => {
    registrations['http.my-api.8000'] = 'http://192.168.1.5:8002';
    const req = fakeReq({ host: 'http.my-api.8000' });
    expect(mainResolver('http.my-api.8000', '/', req)).toBe('http://192.168.1.5:8002');
  });

  test('returns INGRESS_DOMAIN fallback for unregistered single-label host', () => {
    process.env.INGRESS_DOMAIN = 'internal.example.com';
    // single-label: match[2] is 'my-api' with no dot
    const req = fakeReq({ host: 'http.my-api.8000' });
    expect(mainResolver('http.my-api.8000', '/', req)).toBe('https://my-api.internal.example.com');
  });

  test('falls through to direct URL when no INGRESS_DOMAIN and host is proto pattern', () => {
    // No INGRESS_DOMAIN, not in registrations — falls back to reconstructed URL
    const req = fakeReq({ host: 'http.my-api.8080' });
    expect(mainResolver('http.my-api.8080', '/', req)).toBe('http://my-api:8080');
  });

  test('strips x-envoy-original-path and reforms host', () => {
    process.env.INGRESS_DOMAIN = 'internal.example.com';
    // URL segment 'identity' → host becomes http.identity-api.8000 (server appends '-api')
    const req = fakeReq({
      host: 'original-host',
      url: '/identity/v1/users',
      envoyOriginalPath: '/identity/v1/users',
    });
    const result = mainResolver('original-host', '/identity/v1/users', req);
    // After envoy processing: host becomes http.identity-api.8000 (single-label)
    // → INGRESS_DOMAIN fallback applies
    expect(result).toBe('https://identity-api.internal.example.com');
    // url should be stripped of the service prefix
    expect(req.url).toBe('/v1/users');
  });

  test('returns null when no match and no INGRESS_DOMAIN', () => {
    const req = fakeReq({ host: 'some-plain-host' });
    expect(mainResolver('some-plain-host', '/', req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /register tests
// ---------------------------------------------------------------------------

describe('POST /register', () => {
  beforeEach(() => {
    Object.keys(registrations).forEach((k) => delete registrations[k]);
  });

  test('stores services and returns registration map', async () => {
    const res = await supertest(app)
      .post('/register')
      .set('HostIp', '10.0.0.5')
      .send({ services: ['http.identity-api.8000-3001'] })
      .expect(200);

    expect(res.body).toEqual({ 'http.identity-api.8000': 'http://10.0.0.5:3001' });
    expect(registrations['http.identity-api.8000']).toBe('http://10.0.0.5:3001');
  });

  test('handles a service with matching public/private port', async () => {
    const res = await supertest(app)
      .post('/register')
      .set('HostIp', '10.0.0.6')
      .send({ services: ['https.payment-api.8443'] })
      .expect(200);

    expect(res.body).toEqual({ 'https.payment-api.8443': 'https://10.0.0.6:8443' });
  });

  test('handles malformed pattern without crashing', async () => {
    const res = await supertest(app)
      .post('/register')
      .set('HostIp', '10.0.0.5')
      .send({ services: ['not-a-valid-pattern'] })
      .expect(200);

    // Returns empty object — pattern was rejected, no crash
    expect(res.body).toEqual({});
  });

  test('returns 400 when body is not parseable JSON', async () => {
    // Express body-parser intercepts malformed JSON and returns 400 before
    // the handler runs — the handler's try/catch covers runtime errors only.
    const res = await supertest(app)
      .post('/register')
      .set('Content-Type', 'application/json')
      .send('not-valid-json{')
      .expect(400);

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// prettyPrint tests
// ---------------------------------------------------------------------------

describe('prettyPrint', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('formats JSON content correctly', () => {
    const buf = Buffer.from(JSON.stringify({ hello: 'world' }));
    prettyPrint([buf], { 'content-type': 'application/json' });
    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ hello: 'world' }, null, 2),
    );
  });

  test('handles gzip-compressed content', () => {
    const { gzipSync } = require('zlib');
    const compressed: Buffer = gzipSync(Buffer.from('hello gzip'));
    prettyPrint([compressed], { 'content-type': 'text/plain' });
    expect(consoleSpy).toHaveBeenCalledWith('hello gzip');
  });

  test('logs raw text when no headers provided', () => {
    const buf = Buffer.from('plain text body');
    prettyPrint([buf]);
    expect(consoleSpy).toHaveBeenCalledWith('plain text body');
  });
});

// ---------------------------------------------------------------------------
// center tests
// ---------------------------------------------------------------------------

describe('center', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Fix stdout width so the math is deterministic
    Object.defineProperty(process.stdout, 'columns', {
      value: 80,
      configurable: true,
    });
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('outputs text padded to terminal width', () => {
    center('=', 'hello');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output: string = consoleSpy.mock.calls[0][0];
    // With w=80 and sz=7 (' hello ' = 7 chars):
    //   leftSet = ceil((80-7)/2) = 37
    //   left = Array(38).join('=') = 37 chars
    //   right = Array(1 + (80 - 37 - 7)).join('=') = Array(37).join('=') = 36 chars
    //   total: 37 + 1 + 5 + 1 + 36 = 80
    expect(output.length).toBe(80);
    expect(output).toContain('hello');
    expect(output.startsWith('=')).toBe(true);
    expect(output.endsWith('=')).toBe(true);
  });

  test('outputs a full separator line when no args', () => {
    center('=');
    const output: string = consoleSpy.mock.calls[0][0];
    // With no args (sz <= 2), prints Array(w).join(char) = 79 '=' chars
    expect(output).toBe('='.repeat(79));
  });
});
