/**
 * Client tests — US-009
 *
 * All external I/O is mocked:
 *   - net.createServer  → portFinder (no real port binding)
 *   - fs.statSync / fs.readFileSync → isContainer (no Docker required)
 *   - http.request → registerService / registerWithProxy (no live network)
 */

// ---------------------------------------------------------------------------
// Mock declarations — must come before imports
// ---------------------------------------------------------------------------

// Mock net so portFinder never binds a real port
jest.mock('net', () => {
  const actual = jest.requireActual<typeof import('net')>('net');
  return {
    ...actual,
    createServer: jest.fn(),
  };
});

// Mock fs so isContainer never reads the real filesystem
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    statSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

// Mock http entirely so originalRequest (captured at module load) is our mock
jest.mock('http', () => {
  const actual = jest.requireActual<typeof import('http')>('http');
  const mockRequest = jest.fn();
  return {
    ...actual,
    request: mockRequest,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import net from 'net';
import fs from 'fs';
import http from 'http';
import Proxy, {
  registerService,
  isContainer,
  resetIsContainerCache,
} from '../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProxyInstance(overrides: {
  hostname?: string;
  port?: number;
  doNotProxy?: Record<string, unknown> | Array<unknown>;
} = {}): Proxy {
  return new Proxy(
    {
      logger: { info: jest.fn(), error: jest.fn() },
      service: {
        name: 'test-serv',
        config: { get: jest.fn(), set: jest.fn() },
      },
    },
    {
      hostname: overrides.hostname ?? 'localhost',
      port: overrides.port ?? 9990,
      doNotProxy: overrides.doNotProxy ?? {},
    },
  );
}

// ---------------------------------------------------------------------------
// rewire() tests
// ---------------------------------------------------------------------------

describe('Proxy.rewire()', () => {
  let proxy: Proxy;

  beforeEach(() => {
    proxy = makeProxyInstance({ hostname: 'localhost', port: 9990 });
  });

  test('rewires host options for a domain hostname', () => {
    const options: Record<string, unknown> = {
      hostname: 'identity-api.internal',
      port: 8080,
      path: '/v1/users',
      headers: {},
    };
    const result = proxy.rewire(options, 'http', 80);
    expect(result).toBe(true);
    expect(options.host).toBe('localhost');
    expect((options.headers as Record<string, string>).host).toBe(
      'http.identity-api.internal.8080',
    );
    expect(options.port).toBe(9990);
    expect(options.protocol).toBe('http:');
  });

  test('returns false for a numeric IP address', () => {
    const options = { host: '192.168.1.1', port: 8080 };
    const result = proxy.rewire(options, 'http', 80);
    expect(result).toBe(false);
    // host should be unchanged
    expect(options.host).toBe('192.168.1.1');
  });

  test('returns false when host matches doNotProxy string entry', () => {
    proxy = makeProxyInstance({
      doNotProxy: { db: 'postgres.internal' },
    });
    const options = { host: 'postgres.internal', port: 5432 };
    const result = proxy.rewire(options, 'http', 80);
    expect(result).toBe(false);
  });

  test('returns false when neither host nor hostname is present', () => {
    const options = { path: '/health' };
    const result = proxy.rewire(options, 'http', 80);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldNotProxy() tests
// ---------------------------------------------------------------------------

describe('Proxy.shouldNotProxy()', () => {
  test('works with RegExp pattern in array', () => {
    const proxy = makeProxyInstance({
      doNotProxy: [/\.internal$/],
    });
    expect(proxy.shouldNotProxy('db.internal')).toBe(true);
    expect(proxy.shouldNotProxy('external.com')).toBe(false);
  });

  test('works with function pattern in object', () => {
    const proxy = makeProxyInstance({
      doNotProxy: { check: (h: string) => h.startsWith('localhost') },
    });
    expect(proxy.shouldNotProxy('localhost')).toBe(true);
    expect(proxy.shouldNotProxy('remotehost')).toBe(false);
  });

  test('returns false for empty host', () => {
    const proxy = makeProxyInstance({ doNotProxy: { x: /.*/ } });
    expect(proxy.shouldNotProxy('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerService() tests
// ---------------------------------------------------------------------------

describe('registerService()', () => {
  let mockReqInstance: {
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
  };
  let mockHttpRequest: jest.Mock;

  beforeEach(() => {
    mockReqInstance = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    };
    mockHttpRequest = http.request as jest.Mock;
    mockHttpRequest.mockImplementation((_opts: unknown, callback: (res: {
      resume: () => void;
      on: (event: string, handler: () => void) => void;
    }) => void) => {
      // Simulate a response that immediately drains and fires 'end'
      const mockRes = {
        resume: jest.fn(),
        on: jest.fn((event: string, handler: () => void) => {
          if (event === 'end') setImmediate(handler);
        }),
      };
      if (callback) setImmediate(() => callback(mockRes));
      return mockReqInstance;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('builds correct service string with different public/private port', async () => {
    await registerService({
      name: 'identity-api',
      port: 3001,
      publicPort: 8000,
      protocol: 'http',
      proxyUrl: 'http://localhost:9990',
    });

    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockHttpRequest.mock.calls[0][0];
    expect(callArgs.path).toBe('/register');
    expect(callArgs.method).toBe('POST');

    const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
    expect(writtenData.services).toEqual(['http.identity-api.8000-3001']);
  });

  test('builds correct service string when public port equals private port', async () => {
    await registerService({
      name: 'payment-api',
      port: 8000,
      publicPort: 8000,
      protocol: 'http',
      proxyUrl: 'http://localhost:9990',
    });

    const writtenData = JSON.parse(mockReqInstance.write.mock.calls[0][0]);
    expect(writtenData.services).toEqual(['http.payment-api.8000']);
  });
});

// ---------------------------------------------------------------------------
// findPort() tests  (via portFinder module)
// ---------------------------------------------------------------------------

describe('findPort()', () => {
  // Import portFinder directly for isolated testing
  let findPort: (start: number) => Promise<number | null>;
  let mockCreateServer: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    // Re-mock net after resetModules
    jest.mock('net', () => {
      const actual = jest.requireActual<typeof import('net')>('net');
      return { ...actual, createServer: jest.fn() };
    });
    const netModule = await import('net');
    mockCreateServer = netModule.createServer as jest.Mock;
    const pfModule = await import('../src/portFinder');
    findPort = pfModule.default;
  });

  test('returns first available port', async () => {
    // Simulate server that fires "listening" immediately
    mockCreateServer.mockImplementation(() => {
      const listeners: Record<string, (() => void)[]> = {};
      const server = {
        listen: jest.fn().mockImplementation(function (this: unknown) {
          setImmediate(() => {
            (listeners['listening'] ?? []).forEach((h) => h());
          });
          return server;
        }),
        close: jest.fn(),
        once: jest.fn().mockImplementation(function (
          event: string,
          handler: () => void,
        ) {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(handler);
          return server;
        }),
      };
      return server;
    });

    const port = await findPort(9100);
    expect(port).toBe(9100);
  });

  test('skips port that is in use and returns next available', async () => {
    let callCount = 0;
    mockCreateServer.mockImplementation(() => {
      const thisCall = callCount++;
      const listeners: Record<string, ((err?: NodeJS.ErrnoException) => void)[]> = {};
      const server = {
        listen: jest.fn().mockImplementation(function (this: unknown) {
          setImmediate(() => {
            if (thisCall === 0) {
              // First port in use
              const err = Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' });
              (listeners['error'] ?? []).forEach((h) => h(err as NodeJS.ErrnoException));
            } else {
              (listeners['listening'] ?? []).forEach((h) => h());
            }
          });
          return server;
        }),
        close: jest.fn(),
        once: jest.fn().mockImplementation(function (
          event: string,
          handler: (err?: NodeJS.ErrnoException) => void,
        ) {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(handler);
          return server;
        }),
      };
      return server;
    });

    const port = await findPort(9200);
    expect(port).toBe(9201);
  });
});

// ---------------------------------------------------------------------------
// isContainer() tests
// ---------------------------------------------------------------------------

describe('isContainer()', () => {
  beforeEach(() => {
    resetIsContainerCache();
    (fs.statSync as jest.Mock).mockReset();
    (fs.readFileSync as jest.Mock).mockReset();
  });

  test('returns false when /.dockerenv absent and /proc/self/cgroup absent', () => {
    (fs.statSync as jest.Mock).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(isContainer()).toBe(false);
  });

  test('returns true when /.dockerenv exists', () => {
    (fs.statSync as jest.Mock).mockReturnValue({});
    expect(isContainer()).toBe(true);
  });

  test('returns true when /proc/self/cgroup contains "docker"', () => {
    (fs.statSync as jest.Mock).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    (fs.readFileSync as jest.Mock).mockReturnValue('12:blkio:/docker/abc123');
    expect(isContainer()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// v21 compat tests
// ---------------------------------------------------------------------------

describe('v21 compatibility', () => {
  test('require().default is a class constructor', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../src/index');
    expect(typeof mod.default).toBe('function');
    // Has a prototype — it's a class
    expect(mod.default.prototype).toBeDefined();
  });

  test('new Proxy(ctx, config) accepts 2 args without error', () => {
    const ctx = {
      logger: { info: jest.fn(), error: jest.fn() },
      service: {
        name: 'compat-serv',
        config: { get: jest.fn(), set: jest.fn() },
      },
    };
    const config = { hostname: 'localhost', port: 9990 };
    expect(() => new Proxy(ctx, config)).not.toThrow();
  });
});
