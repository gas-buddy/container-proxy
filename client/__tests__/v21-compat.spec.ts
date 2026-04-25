/**
 * v21 hydration compatibility tests — US-013
 *
 * gb-services v21 hydrates plugins by calling:
 *   new Plugin(context, config, tree)   // 3 arguments
 *
 * These tests verify that the Proxy class:
 *   a) is the default export and is a class constructor
 *   b) tolerates the 3-argument hydration call without throwing
 *   c) patches http.request after start()
 *   d) rewires the host header for domain names after patching
 *   e) respects registerIn: 'docker' (skips registration when not in Docker)
 *
 * All I/O is mocked — no network, no filesystem access.
 *
 * NOTE on http mock isolation:
 *   client/src/index.ts captures `originalRequest = http.request.bind(http)`
 *   once at module load.  proxyRequests() later *replaces* http.request with a
 *   closure that mutates options then delegates to that captured originalRequest.
 *   After any test that calls proxy.start(), http.request is the closure, not
 *   the jest.fn().  We therefore hold `jestHttpRequest` as a stable reference to
 *   the jest.fn() and restore it onto http.request in beforeEach.
 */

// ---------------------------------------------------------------------------
// Mock declarations — must precede imports
// ---------------------------------------------------------------------------

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    statSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

jest.mock('dns', () => ({
  lookup: jest.fn((_host: string, cb: (err: Error | null) => void) => cb(null)),
}));

jest.mock('http', () => {
  const actual = jest.requireActual<typeof import('http')>('http');
  const mockRequest = jest.fn();
  return { ...actual, request: mockRequest };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import fs from 'fs';
import http from 'http';
import Proxy, { resetIsContainerCache } from '../src/index';

// ---------------------------------------------------------------------------
// Stable reference to the jest.fn() assigned to http.request at mock time.
// proxyRequests() will overwrite http.request, so we use this ref to restore
// it before each test and to assert on registration calls.
// ---------------------------------------------------------------------------
const jestHttpRequest = http.request as jest.Mock;

// ---------------------------------------------------------------------------
// Shared mock context factory
// ---------------------------------------------------------------------------

function makeContext(name = 'test-serv') {
  return {
    logger: { info: jest.fn(), error: jest.fn() },
    service: {
      name,
      config: { get: jest.fn().mockReturnValue(undefined), set: jest.fn() },
    },
  };
}

/** Make jestHttpRequest simulate a registration response. */
function mockRegistrationResponse(): { write: jest.Mock; end: jest.Mock; on: jest.Mock } {
  const mockReqInstance = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
  jestHttpRequest.mockImplementation(
    (_opts: unknown, cb?: (res: { resume: jest.Mock; on: jest.Mock }) => void) => {
      if (cb) {
        const mockRes = {
          resume: jest.fn(),
          on: jest.fn((ev: string, handler: () => void) => {
            if (ev === 'end') setImmediate(handler);
          }),
        };
        setImmediate(() => cb(mockRes));
      }
      return mockReqInstance;
    },
  );
  return mockReqInstance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('v21 hydration compat (US-013)', () => {
  beforeEach(() => {
    resetIsContainerCache();
    (fs.statSync as jest.Mock).mockReset().mockImplementation(() => {
      throw new Error('ENOENT');
    });
    (fs.readFileSync as jest.Mock).mockReset().mockImplementation(() => {
      throw new Error('ENOENT');
    });
    // Restore the jest.fn() onto http.request — a previous test's proxyRequests()
    // may have replaced it with the proxy closure.
    http.request = jestHttpRequest as typeof http.request;
    jestHttpRequest.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // a) Default export is a class constructor
  // -------------------------------------------------------------------------

  test('require().default is a function (class constructor)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../src/index');
    expect(typeof mod.default).toBe('function');
    expect(mod.default.prototype).toBeDefined();
    expect(typeof mod.default.prototype.start).toBe('function');
  });

  // -------------------------------------------------------------------------
  // b) 3-argument construction (v21 hydration signature)
  // -------------------------------------------------------------------------

  test('new Proxy(context, config, tree) — 3 args works without throwing', () => {
    const ctx = makeContext();
    const config = { hostname: 'localhost', port: 9990 };
    // v21 hydration passes a third `tree` argument; Proxy accepts only two
    // but JavaScript does not error on extra arguments.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new (Proxy as any)(ctx, config, { someTree: true })).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // c) http.request is patched after start()
  // -------------------------------------------------------------------------

  test('http.request is patched after start()', async () => {
    mockRegistrationResponse();

    // Before start(), http.request is still our jest.fn()
    expect(http.request).toBe(jestHttpRequest);

    const proxy = new Proxy(makeContext(), { hostname: 'localhost', port: 9990 });
    await proxy.start(makeContext());

    // After start(), proxyRequests() replaced http.request with its closure
    expect(http.request).not.toBe(jestHttpRequest);
    expect(typeof http.request).toBe('function');
  });

  // -------------------------------------------------------------------------
  // d) Patched http.request rewires host header for domain names
  // -------------------------------------------------------------------------

  test('patched http.request sets host header for domain requests', async () => {
    mockRegistrationResponse();

    const proxy = new Proxy(makeContext('my-serv'), { hostname: 'localhost', port: 9990 });
    await proxy.start(makeContext('my-serv'));

    // Reset call history so only the next call is observed
    jestHttpRequest.mockClear();

    // Call the now-patched http.request — it mutates options then delegates
    // to originalRequest (which is jestHttpRequest bound at module load)
    const options: Record<string, unknown> = {
      host: 'identity-api.internal',
      port: 8080,
      path: '/v1/users',
      headers: {},
    };
    http.request(options as Parameters<typeof http.request>[0]);

    // jestHttpRequest was called once (from the proxy closure)
    expect(jestHttpRequest).toHaveBeenCalledTimes(1);
    // The options object was mutated in place by rewire() before being forwarded
    expect((options.headers as Record<string, string>).host).toBe(
      'http.identity-api.internal.8080',
    );
    expect(options.host).toBe('localhost');
    expect(options.port).toBe(9990);
  });

  // -------------------------------------------------------------------------
  // e) registerIn: 'docker' skips registration when not running in Docker
  // -------------------------------------------------------------------------

  test('registerIn: "docker" — registration skipped when not in Docker', async () => {
    // isContainer() → false (no /.dockerenv, no cgroup match — mocked in beforeEach)
    // registerIn: 'docker' means only register when running inside Docker.
    // In a native (non-Docker) environment, registerWithProxy must be skipped.
    const proxy = new Proxy(makeContext(), {
      hostname: 'localhost',
      port: 9990,
      registerIn: 'docker',
    });

    await proxy.start(makeContext());

    // jestHttpRequest is originalRequest — it should NOT have been called for
    // registration. (proxyRequests() still runs so http.request is replaced,
    // but no POST /register call reaches originalRequest.)
    expect(jestHttpRequest).not.toHaveBeenCalled();
  });
});
