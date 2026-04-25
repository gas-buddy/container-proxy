# v23 registerService() Integration Smoke Test Guide

This guide explains how to verify that `registerService()` from
`@gasbuddy/container-proxy-client` works correctly with gb-services v23.

## Background

gb-services v23 services call `registerService()` directly — there is no plugin
hydration step. The function sends a single POST to the container-proxy server
to register the service's host pattern and returns a promise that resolves when
the proxy acknowledges the registration.

The tests in `client/__tests__/v23-register.spec.ts` codify the correct wire
format and promise lifecycle.

## Running the dedicated v23 register tests

```bash
cd client
yarn test --testPathPattern v23-register
```

Expected output (all passing):

```
PASS __tests__/v23-register.spec.ts
  registerService() — v23 (US-013)
    ✓ sends correct POST body for http service with different public/private port
    ✓ sends correct POST body for https service with explicit publicPort
    ✓ omits private port when public port equals private port
    ✓ sends request to custom proxyUrl hostname and port
    ✓ promise resolves after response end event fires
    ✓ promise rejects when request emits an error
```

## Usage in a v23 service

Import and call `registerService()` during service startup, typically in the
`start` lifecycle hook:

```ts
import { registerService } from '@gasbuddy/container-proxy-client';

export async function start(app: GbApp): Promise<void> {
  const port = app.locals.config.get('port') as number;

  await registerService({
    name: 'my-service',          // matches the service name in container-proxy
    port,                         // actual listening port
    proxyUrl: 'http://container-proxy:9990',
  });
}
```

## Service string encoding

The function encodes the service as a host pattern string before sending it to
the proxy:

| Scenario                    | Encoded string                   |
|-----------------------------|----------------------------------|
| http, port == publicPort    | `http.<name>.<publicPort>`       |
| http, port != publicPort    | `http.<name>.<publicPort>-<port>`|
| https, explicit publicPort  | `https.<name>.<publicPort>-<port>`|

Default port values:
- `protocol: 'http'`  → `publicPort` defaults to `8000`
- `protocol: 'https'` → `publicPort` defaults to `8443`

## Verifying registration against a live proxy

With the proxy running locally (`yarn start` in the root package):

```bash
curl -X POST http://localhost:9990/register \
  -H 'Content-Type: application/json' \
  -H 'HostIp: 127.0.0.1' \
  -d '{"services":["http.my-service.8000-3001"]}'
```

Expected response:

```json
{ "http.my-service.8000": "http://127.0.0.1:3001" }
```

Then verify routing:

```bash
curl http://localhost:9990/health -H 'Host: http.my-service.8000'
```

This should be forwarded to `http://127.0.0.1:3001/health`.
