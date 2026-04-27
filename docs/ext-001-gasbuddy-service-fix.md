# EXT-001: Fix requestInterceptor Overwrite in @gasbuddy/service

## Package
`@gasbuddy/service` — https://github.com/gas-buddy/service

## Priority
CRITICAL — without this fix, no v23 service can route calls through container-proxy

## Depends On
- `@gasbuddy/container-proxy-client` v3.0.0 published (container-proxy repo US-006)

## Problem

`createServiceInterface()` in `src/service-calls/index.ts` has a bug where the proxy `requestInterceptor` is unconditionally overwritten.

### Root Cause (source: `src/service-calls/index.ts`)

```typescript
// Lines 63-88: Proxy interceptor — sets host header encoding + URL rewrite
if (config?.proxy) {
  const proxyUrl = new URL(config.proxy);
  const proxyPort = proxyUrl.protocol === 'https:' ? '8443' : '8000';

  fetchConfig.requestInterceptor = (params: FetchRequest) => {   // LINE 67
    const parsedUrl = new URL(params.url);
    const proto = parsedUrl.protocol.replace(/:$/, '');
    const defaultPort = proto === 'https' ? 8443 : 8000;
    const headers: FetchRequest['headers'] = {
      correlationid: params.headers?.correlationid
        || service.locals.traceId
        || currentTelemetryInfo()?.traceId
        || crypto.randomBytes(16).toString('hex'),
    };
    headers.host = `${proto}.${parsedUrl.hostname}.${port || defaultPort}`;
    headers.source = service.locals.name;
    parsedUrl.hostname = proxyUrl.hostname;
    parsedUrl.protocol = proxyUrl.protocol;
    parsedUrl.port = proxyUrl.port || proxyPort;
    params.headers = params.headers || {};
    Object.assign(params.headers, headers);
    params.url = parsedUrl.href;
  };
}

// Lines 91-102: Correlation ID interceptor — OVERWRITES line 67
fetchConfig.requestInterceptor = (params: FetchRequest) => {     // LINE 91
  params.headers = params.headers || {};
  const headers: FetchRequest['headers'] = {
    correlationid: params.headers?.correlationid
      || service.locals.traceId
      || currentTelemetryInfo()?.traceId
      || crypto.randomBytes(16).toString('hex'),
  };
  Object.assign(params.headers, headers);
};
```

Line 91 **unconditionally reassigns** `fetchConfig.requestInterceptor`, discarding the proxy interceptor set at line 67. `rest-api-support`'s `FetchConfig` only supports a single `requestInterceptor` function — there is no chaining mechanism at the config level.

### Effect
- `config/development.json` sets `connections.default.proxy: "http://localhost:9990"`
- `createServiceInterface()` reads this config and enters the `if (config?.proxy)` block
- Proxy interceptor is built correctly at line 67
- Line 91 immediately destroys it
- Result: all v23 service calls go directly to service hostname (unresolvable locally) instead of through container-proxy
- INGRESS_DOMAIN fallback never triggers because requests never reach the proxy

### Why It Wasn't Caught
The proxy interceptor at line 67 already includes correlationid injection. Line 91 was likely added later without awareness that it clobbers line 67. Both interceptors inject correlationid, so the only lost behavior is the proxy-specific URL rewriting and host header encoding — which only matters in local development when container-proxy is running.

## Fix

Merge both behaviors into a single interceptor. When `config.proxy` is set, the interceptor must do ALL of:
1. Inject correlationid (always needed)
2. Encode `protocol.hostname.port` into Host header (proxy routing)
3. Set `source` header to service name (proxy logging)
4. Rewrite URL to point at proxy server (proxy routing)

When `config.proxy` is NOT set, only inject correlationid (current line 91 behavior).

### Proposed Code

```typescript
// Build the correlation ID injection (always needed)
const injectCorrelationId = (params: FetchRequest) => {
  params.headers = params.headers || {};
  if (!params.headers.correlationid) {
    params.headers.correlationid = service.locals.traceId
      || currentTelemetryInfo()?.traceId
      || crypto.randomBytes(16).toString('hex');
  }
};

if (config?.proxy) {
  const proxyUrl = new URL(config.proxy);
  const proxyPort = proxyUrl.protocol === 'https:' ? '8443' : '8000';

  fetchConfig.requestInterceptor = (params: FetchRequest) => {
    injectCorrelationId(params);

    const parsedUrl = new URL(params.url);
    const proto = parsedUrl.protocol.replace(/:$/, '');
    const defaultPort = proto === 'https' ? 8443 : 8000;

    params.headers!.host = `${proto}.${parsedUrl.hostname}.${port || defaultPort}`;
    params.headers!.source = service.locals.name;

    parsedUrl.hostname = proxyUrl.hostname;
    parsedUrl.protocol = proxyUrl.protocol;
    parsedUrl.port = proxyUrl.port || proxyPort;
    params.url = parsedUrl.href;
  };
} else {
  fetchConfig.requestInterceptor = (params: FetchRequest) => {
    injectCorrelationId(params);
  };
}
```

## Acceptance Criteria

1. When `connections.default.proxy` is set to `"http://localhost:9990"`:
   - `fetchConfig.requestInterceptor` encodes `protocol.hostname.port` into Host header
   - `fetchConfig.requestInterceptor` rewrites URL to point at proxy
   - `fetchConfig.requestInterceptor` sets `source` header to service name
   - `fetchConfig.requestInterceptor` injects correlationid
2. When `connections.default.proxy` is NOT set:
   - `fetchConfig.requestInterceptor` only injects correlationid
   - No proxy-related headers or URL rewriting applied
3. Per-request `apiAuthProxy()` interceptor (via `FetchPerRequestOptions.requestInterceptor`) continues to work — it runs AFTER the config-level interceptor per `rest-api-support/src/fetchHelper.ts` lines 39-43
4. Existing tests pass
5. New test: mock fetch, set `connections.default.proxy`, verify outbound request has correct Host header and URL

## Files to Modify

| File | Change |
|------|--------|
| `src/service-calls/index.ts` | Merge proxy + correlationid interceptors (lines 63-102) |
| `__tests__/service-calls.spec.ts` (new or existing) | Test proxy interceptor encoding and correlationid injection |

## Test Scenarios

1. **No proxy config**: `createServiceInterface()` with no `connections.default.proxy` → interceptor injects correlationid only
2. **With proxy config**: `createServiceInterface()` with `proxy: "http://localhost:9990"` → interceptor encodes `http.identity-serv.8000` in Host, rewrites URL to `http://localhost:9990/...`, injects correlationid
3. **Per-request interceptor chaining**: With proxy config, call service method with `apiAuthProxy(req, 123)` → both config interceptor (proxy+correlationid) and per-request interceptor (auth headers) run
4. **HTTPS protocol**: With proxy config, service configured with `protocol: 'https'` → Host header encodes `https.service-name.8443`

## Risk Assessment

**Low risk**: The fix only changes local development behavior (`connections.default.proxy` is only set in `config/development.json`). Production, staging, and test configs do not set `proxy`, so the `else` branch (correlationid-only) runs — identical to current broken behavior.

## Related

- container-proxy modernization PRD: `tasks/modernization.md` US-006 (registerService)
- EXT-002: gb-services registration implementation (depends on this fix)
