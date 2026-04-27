/**
 * v23 registerService() tests — US-013
 *
 * Dedicated tests for the standalone registerService() function that
 * gb-services v23 consumers call directly (no class instantiation needed).
 *
 * All network I/O is mocked — no real HTTP connections are made.
 */

// ---------------------------------------------------------------------------
// Mock declarations — must precede imports
// ---------------------------------------------------------------------------

jest.mock('http', () => {
  const actual = jest.requireActual<typeof import('http')>('http');
  const mockRequest = jest.fn();
  return { ...actual, request: mockRequest };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import http from 'http';
import { registerService } from '../src/index';

// ---------------------------------------------------------------------------
// Helper: build a mock request/response pair
// ---------------------------------------------------------------------------

type MockReqInstance = { write: jest.Mock; end: jest.Mock; on: jest.Mock };
type MockResFactory = (cb: (res: MockResInstance) => void) => void;
type MockResInstance = { resume: jest.Mock; on: jest.Mock };

function makeMockHttp(opts: {
  /** If true, fire the response 'end' event immediately. Default: true. */
  resolveOnEnd?: boolean;
  /** If set, emit this error on the request's 'error' event. */
  reqError?: Error;
}): { mockReqInstance: MockReqInstance; mockHttpRequest: jest.Mock } {
  const { resolveOnEnd = true, reqError } = opts;

  const mockReqInstance: MockReqInstance = {
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn((event: string, handler: (err?: Error) => void) => {
      if (event === 'error' && reqError) {
        setImmediate(() => handler(reqError));
      }
    }),
  };

  const mockHttpRequest = http.request as jest.Mock;
  mockHttpRequest.mockImplementation(
    (_opts: unknown, cb?: (res: MockResInstance) => void) => {
      if (cb && resolveOnEnd) {
        const mockRes: MockResInstance = {
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

  return { mockReqInstance, mockHttpRequest };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerService() — v23 (US-013)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // a) Basic POST body encoding
  // -------------------------------------------------------------------------

  test('sends correct POST body for http service with different public/private port', async () => {
    const { mockReqInstance, mockHttpRequest } = makeMockHttp({ resolveOnEnd: true });

    await registerService({ name: 'foo', port: 3000 });

    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    const callOpts = mockHttpRequest.mock.calls[0][0];
    expect(callOpts.path).toBe('/register');
    expect(callOpts.method).toBe('POST');
    expect(callOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
    // Default publicPort is 8000 for http; port 3000 !== 8000 → include private port
    expect(body.services).toEqual(['http.foo.8000-3000']);
  });

  test('sends correct POST body for https service with explicit publicPort', async () => {
    const { mockReqInstance } = makeMockHttp({ resolveOnEnd: true });

    await registerService({
      name: 'foo',
      port: 3000,
      protocol: 'https',
      publicPort: 8443,
    });

    const body = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
    // port 3000 !== 8443 → include private port
    expect(body.services).toEqual(['https.foo.8443-3000']);
  });

  test('omits private port when public port equals private port', async () => {
    const { mockReqInstance } = makeMockHttp({ resolveOnEnd: true });

    await registerService({ name: 'foo', port: 8000, publicPort: 8000 });

    const body = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
    expect(body.services).toEqual(['http.foo.8000']);
  });

  // -------------------------------------------------------------------------
  // b) Custom proxyUrl is respected
  // -------------------------------------------------------------------------

  test('sends request to custom proxyUrl hostname and port', async () => {
    const { mockHttpRequest } = makeMockHttp({ resolveOnEnd: true });

    await registerService({
      name: 'foo',
      port: 3000,
      proxyUrl: 'http://myproxy.local:4567',
    });

    const callOpts = mockHttpRequest.mock.calls[0][0];
    expect(callOpts.hostname).toBe('myproxy.local');
    expect(String(callOpts.port)).toBe('4567');
  });

  // -------------------------------------------------------------------------
  // c) Promise resolves after response 'end'
  // -------------------------------------------------------------------------

  test('promise resolves after response end event fires', async () => {
    makeMockHttp({ resolveOnEnd: true });

    // Should not throw and should resolve
    await expect(registerService({ name: 'foo', port: 3000 })).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // d) Promise rejects on connection error
  // -------------------------------------------------------------------------

  test('promise rejects when request emits an error', async () => {
    const connError = new Error('ECONNREFUSED');
    makeMockHttp({ resolveOnEnd: false, reqError: connError });

    await expect(registerService({ name: 'foo', port: 3000 })).rejects.toThrow('ECONNREFUSED');
  });
});
