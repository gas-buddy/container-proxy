# EXT-002: Implement Service Registration in @gasbuddy/gb-services start()

## Package
`@gasbuddy/gb-services` — https://github.com/gas-buddy/gb-services

## Priority
CRITICAL — without this, v23 services never register with container-proxy and the proxy can't route to them

## Depends On
- `@gasbuddy/container-proxy-client` v3.0.0 published (container-proxy repo US-006)
- EXT-001: `@gasbuddy/service` requestInterceptor fix merged and released

## Problem

### The TODO (source: `src/service.ts` line 113)

```typescript
async start(app) {
  await baseService?.start(app);
  const idKey = app.locals.config.get('crypto:idKey');
  if (idKey) {
    id.initialize(app.locals, idKey);
  }

  setupDefaultServices(app);

  if (app.locals.config.get('routing:authentication') === false) {
    shouldRunAuth = false;
  }
  // TODO Register the service with container proxy if necessary   // LINE 113
},
```

This TODO has existed since gb-services v23 was created. In v21, registration was handled by `@gasbuddy/hydration` which loaded `container-proxy-client` as a connection module and called its `start()` method (which registered the service and monkey-patched http/https). v23 eliminated hydration entirely — but never replaced the proxy registration functionality.

### The Dead Config (source: `config/development.json`)

```json
{
  "registerProxy": "http://localhost:9990",
  "crypto": {
    "idKey": "development_id_obfuscation_key"
  }
}
```

`registerProxy` is present but **no code path reads it**. Zero references to `registerProxy` in any `.ts` file in the repo.

### Effect

1. v23 services boot and listen on their configured port
2. No POST /register call is made to container-proxy
3. Proxy has no knowledge of locally running v23 services
4. When another service calls through the proxy using `protocol.hostname.port` encoding, the proxy finds no registration and either:
   - Falls back to INGRESS_DOMAIN (routes to staging instead of local) — if INGRESS_DOMAIN is set
   - Returns null → 502 — if INGRESS_DOMAIN is not set

### How v21 Handled This

In v21, `config/development.json` had:
```json
{
  "connections": {
    "proxy": {
      "module": "require:@gasbuddy/container-proxy-client",
      "registerIn": "native"
    }
  }
}
```

`@gasbuddy/hydration` loaded the module via shortstop `require:`, called `new Proxy(context, config)`, then `proxy.start(context)` which:
1. Found an available port via `portFinder(8002)`
2. Mutated `service.config.set('port', foundPort)`
3. POSTed to `http://container-proxy:9990/register` with `{ services: ["http.service-name.8000-foundPort"] }`
4. Monkey-patched `http.request` and `https.request`

v23 needs steps 1-3 (registration) but NOT step 4 (monkey-patching, since v23 uses `requestInterceptor`).

## Fix

In `src/service.ts`, replace the TODO comment at line 113 with actual registration logic using the new `registerService()` function from `@gasbuddy/container-proxy-client` v3.

### Proposed Code

```typescript
// At top of file, add conditional import
// (container-proxy-client is a devDependency — only used in development)

async start(app) {
  await baseService?.start(app);
  const idKey = app.locals.config.get('crypto:idKey');
  if (idKey) {
    id.initialize(app.locals, idKey);
  }

  setupDefaultServices(app);

  if (app.locals.config.get('routing:authentication') === false) {
    shouldRunAuth = false;
  }

  // Register with container-proxy for local development
  const registerProxy = app.locals.config.get('registerProxy');
  if (registerProxy) {
    try {
      const { registerService } = await import('@gasbuddy/container-proxy-client');
      const serverPort = app.locals.config.get('server:port') || 8000;
      await registerService({
        name: app.locals.name,
        port: serverPort,
        proxyUrl: registerProxy,
      });
      app.locals.logger.info(
        { proxyUrl: registerProxy, port: serverPort },
        'Registered with container-proxy',
      );
    } catch (error) {
      app.locals.logger.warn(
        { error: { message: (error as Error).message } },
        'Failed to register with container-proxy — local proxy routing may not work',
      );
    }
  }
},
```

### Key Design Decisions

1. **Dynamic import (`await import()`)**: `container-proxy-client` should be a devDependency (or optional dependency), not a production dependency. Dynamic import allows it to be absent in production without breaking the service.

2. **`registerProxy` config key**: Already exists in `config/development.json`. No config changes needed. The key is only present in development config, so registration only happens in development — exactly as intended.

3. **`server:port` for actual port**: `@gasbuddy/service/config/config.json` sets `server.port: 8000` as default. In development, `@gasbuddy/service/config/development.json` sets `port: 0` (ephemeral). The challenge: at `start()` time, the server MAY already be listening on an ephemeral port. Need to determine if the actual bound port is available.

4. **No monkey-patching**: `registerService()` only POSTs to /register. URL rewriting is handled by `createServiceInterface()`'s `requestInterceptor` (fixed in EXT-001).

5. **Warn, don't crash**: Registration failure is logged as warning. Service continues to function — it just can't receive proxied traffic locally. External/staging routing still works.

### Port Resolution Challenge

In v21, the client called `portFinder()` to find an available port and mutated the service config before the server started listening. In v23, the server may already be listening by the time `start()` runs (since `start()` is called during `setupApp()` in `@gasbuddy/service`'s `app.ts` line 268, which is after the server is bound).

Need to verify: is the actual listening port available from `app` at `start()` time?

Options:
- `app.locals.config.get('server:port')` — configured port (may be 0 if ephemeral)
- Check if `app.locals.internalApp` or similar has the bound address
- Accept that v23 services must set an explicit port in development config (not `port: 0`)

**Recommended approach**: Read `server:port` from config. If it's 0 or not set, log a warning that explicit port configuration is needed for proxy registration. This is simpler and more predictable than trying to discover the ephemeral port.

Alternatively, the service's development.json can override `server.port` to a specific number (e.g., 8001) — this is a one-line config change per service and eliminates the ephemeral port problem entirely.

## Acceptance Criteria

1. When `registerProxy` config is set (development environment):
   - `registerService()` is called during `start()` with service name and port
   - Successful registration logged at `info` level
   - Failed registration logged at `warn` level (service continues)
2. When `registerProxy` config is NOT set (production/staging/test):
   - No registration attempted
   - No import of `container-proxy-client`
   - No behavior change
3. `container-proxy-client` is listed as a devDependency (or optionalDependency), not a production dependency
4. Existing tests pass unchanged
5. New test: mock `container-proxy-client` import, set `registerProxy` config, verify `registerService()` called with correct args

## Files to Modify

| File | Change |
|------|--------|
| `src/service.ts` | Replace TODO at line 113 with registration logic |
| `package.json` | Add `@gasbuddy/container-proxy-client: "^3.0.0"` as devDependency |
| `__tests__/service.spec.ts` (new or existing) | Test registration in development mode |

## Dependency Chain

```
container-proxy-client v3 published (US-006)
         │
         ▼
@gasbuddy/service interceptor fix merged (EXT-001)
         │
         ▼
@gasbuddy/gb-services registration (THIS — EXT-002)
         │
         ▼
v23 services can use container-proxy end-to-end
```

## Risk Assessment

**Low risk**:
- Dynamic import means missing package doesn't crash production
- `registerProxy` only set in development.json — no production/staging impact
- Registration failure is a warning, not an error
- No changes to request handling, auth, or service lifecycle

## Related

- container-proxy modernization PRD: `tasks/modernization.md` US-006 (registerService)
- EXT-001: @gasbuddy/service requestInterceptor fix (must be merged first)
- v21 reference: `@gasbuddy/hydration` v2.2.0 `buildObject()` function — how v21 registration worked
