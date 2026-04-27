/**
 * Integration tests — US-012
 *
 * Tests the proxy server end-to-end by:
 *   - Starting a real HTTP server on a random port (server.listen() is guarded
 *     by NODE_ENV !== 'test', so we call listen() manually here)
 *   - Spinning up a minimal mock backend so proxy.web() has something to hit
 *   - Verifying /register stores the mapping and proxied requests are forwarded
 *   - Verifying INGRESS_DOMAIN fallback resolves correctly
 *   - Verifying 502 when no registration and no INGRESS_DOMAIN
 *
 * All network activity stays on 127.0.0.1 — no external calls are made.
 */

process.env.NODE_ENV = 'test';

import http from 'http';
import net from 'net';
import supertest from 'supertest';
import httpProxy from 'http-proxy';
import type { Request, Response } from 'express';

import { app, mainResolver, registrations } from '../src/server';
import type { AnnotatedRequest } from '../src/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a free port by letting the OS assign one. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tmp = net.createServer();
    tmp.listen(0, '127.0.0.1', () => {
      const addr = tmp.address() as net.AddressInfo;
      tmp.close((err) => {
        if (err) reject(err);
        else resolve(addr.port);
      });
    });
  });
}

/** Start a minimal HTTP server that always responds 200 + JSON body. */
function startMockBackend(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const backend = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    backend.listen(port, '127.0.0.1', () => resolve(backend));
  });
}

/** Stop a server and wait for it to close fully. */
function stopServer(s: http.Server): Promise<void> {
  return new Promise((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Server integration (US-012)', () => {
  let proxyPort: number;
  let backendPort: number;
  let proxyServer: http.Server;
  let backendServer: http.Server;

  beforeAll(async () => {
    [proxyPort, backendPort] = await Promise.all([freePort(), freePort()]);

    backendServer = await startMockBackend(backendPort);

    // Build a thin proxy server replicating the same dispatch as server.ts.
    // We do this manually because NODE_ENV=test suppresses the module-level
    // listen() call and the raw http.Server is not exported from server.ts.
    // The exported `app`, `mainResolver`, and `registrations` are sufficient.
    const proxyInstance = httpProxy.createProxyServer({ changeOrigin: true });

    proxyServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/register') {
        app(req as Request, res as Response);
        return;
      }

      const target = mainResolver(req.headers.host, req.url, req as AnnotatedRequest);
      if (!target) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Bad Gateway: no route for ${req.headers.host}`);
        return;
      }

      proxyInstance.web(req, res, { target }, (_err) => {
        try {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway');
        } catch {
          // Response may already be partially sent
        }
      });
    });

    await new Promise<void>((resolve) => proxyServer.listen(proxyPort, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await Promise.all([stopServer(proxyServer), stopServer(backendServer)]);
  });

  beforeEach(() => {
    Object.keys(registrations).forEach((k) => delete registrations[k]);
    delete process.env.INGRESS_DOMAIN;
  });

  // -------------------------------------------------------------------------
  // /register endpoint
  // -------------------------------------------------------------------------

  test('POST /register stores service and returns registration map', async () => {
    const res = await supertest(`http://127.0.0.1:${proxyPort}`)
      .post('/register')
      .set('HostIp', '127.0.0.1')
      .send({ services: [`http.test-service.8000-${backendPort}`] })
      .expect(200);

    expect(res.body).toEqual({
      'http.test-service.8000': `http://127.0.0.1:${backendPort}`,
    });
    expect(registrations['http.test-service.8000']).toBe(`http://127.0.0.1:${backendPort}`);
  });

  // -------------------------------------------------------------------------
  // Proxied request via registered service
  // -------------------------------------------------------------------------

  test('proxies GET request to a registered backend', async () => {
    registrations['http.test-service.8000'] = `http://127.0.0.1:${backendPort}`;

    const res = await supertest(`http://127.0.0.1:${proxyPort}`)
      .get('/health')
      .set('Host', 'http.test-service.8000')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  // -------------------------------------------------------------------------
  // INGRESS_DOMAIN fallback
  // -------------------------------------------------------------------------

  test('INGRESS_DOMAIN: routes to a target URL (502 from unreachable host, not "no route")', async () => {
    // mainResolver returns an https:// URL when INGRESS_DOMAIN is set.
    // The proxy attempt fails (host unreachable in test env), returning 502
    // from the proxy error callback — NOT the "Bad Gateway: no route for" branch.
    process.env.INGRESS_DOMAIN = 'internal.example.com';

    const res = await supertest(`http://127.0.0.1:${proxyPort}`)
      .get('/health')
      .set('Host', 'http.my-api.8000')
      .expect(502);

    // The "no route" branch was NOT taken — INGRESS_DOMAIN produced a target URL
    expect(res.text).not.toMatch(/no route for/);
  });

  // -------------------------------------------------------------------------
  // 502 with no match and no INGRESS_DOMAIN
  // -------------------------------------------------------------------------

  test('returns 502 with "no route" body when host has no match', async () => {
    const res = await supertest(`http://127.0.0.1:${proxyPort}`)
      .get('/anything')
      .set('Host', 'unknown-host')
      .expect(502);

    expect(res.text).toMatch(/no route for unknown-host/);
  });
});
