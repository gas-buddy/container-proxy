# container-proxy Modernization

## Description

`container-proxy` is a two-package repo providing local development infrastructure for GasBuddy microservices. The server (`@gasbuddy/container-proxy`) is a Redbird-based reverse proxy running on port 9990 that routes inter-service HTTP traffic during local development. The client (`@gasbuddy/container-proxy-client`) monkey-patches Node's `http`/`https` globals so any service process transparently routes its outbound calls through the proxy.

This modernization is two-fold:

**Part 1 — Technical debt cleanup**: The packages have accumulated severe technical debt: the server runs on Node 10 (with a Node 10 Docker base image), uses Redbird — a proxy library last updated in 2014 pinned to a specific GitHub commit — and depends on multiple abandoned npm packages (`pretty-data`, `window-size`, `zlib` npm shim). Neither package has any tests. The build system uses Babel with `babel-preset-gasbuddy` instead of TypeScript. This work brings both packages into alignment with current GasBuddy standards, as exemplified by `@gasbuddy/client-sqs`.

**Part 2 — v23 proxy support (NEW capability)**: Source code cross-referencing reveals that v23 services currently cannot use container-proxy at all. Three independent bugs block it: (1) `@gasbuddy/service/src/service-calls/index.ts` line 91 unconditionally overwrites the proxy `requestInterceptor` set at line 67, making all proxy URL rewriting and host header encoding dead code; (2) `@gasbuddy/gb-services/src/service.ts` line 113 contains `// TODO Register the service with container proxy if necessary` — this was never implemented, so no v23 service ever calls `POST /register`; (3) `registerProxy: "http://localhost:9990"` in `gb-services/config/development.json` is present but is never read by any code path. The v21 path works correctly through `@gasbuddy/hydration`'s shortstop `require:` mechanism, which loads the client as a module and monkey-patches `http`/`https` globally. This modernization adds a new `registerService()` named export to `container-proxy-client` (bumping it to v3) so that v23 services have a working registration path, and documents the companion fixes required in `@gasbuddy/service` and `@gasbuddy/gb-services` as separate work items.

## Goals

1. Both packages must build and run under Node 18, matching the `.nvmrc` already in the repo.
2. Both packages must be fully rewritten in TypeScript, exporting correct `.d.ts` type declarations.
3. All dead or abandoned runtime dependencies must be replaced with maintained alternatives or Node built-ins.
4. The server Docker image must be rebuilt on a Node 18 base image so `tooling/docker-compose.yml` can pull and run a working container.
5. Both packages must have Jest test suites (zero tests currently exist).
6. CI/CD must be established via GitHub Actions, matching the `client-sqs` workflow pattern (build + lint + test on push; npm publish on main).
7. **NEW**: `container-proxy-client` v3 must export a standalone `registerService()` function usable by v23 services without monkey-patching or a context/service object.
8. The v21 backward compatibility contract must be preserved: `require('@gasbuddy/container-proxy-client').default` must remain a class constructor that `@gasbuddy/hydration` can instantiate and call `.start()` on.
9. All existing server contracts must be preserved: the `protocol.hostname.port` header-mangling protocol, the `POST /register` API, the `INGRESS_DOMAIN` staging fallback, the `PROXY_PORT` env override, and the Envoy `x-envoy-original-path` stripping logic.

## Features

### F1: Node 18 Runtime Upgrade
Upgrade the runtime, tooling, and Docker base image to Node 18.

### F2: TypeScript Rewrite — Server
Rewrite `@gasbuddy/container-proxy` server source in TypeScript. Fix the `"main": "src/index.js"` entry point bug (that file does not exist; the real entry is `src/server.js`, which after the rewrite becomes `build/server.js`).

### F3: TypeScript Rewrite — Client (with v21 compat)
Rewrite `@gasbuddy/container-proxy-client` in TypeScript. Default export must remain the `Proxy` class for v21 hydration compat. New named export `registerService()` added for v23.

### F4: Dependency Modernization — Server
Replace all abandoned/deprecated server dependencies: Redbird → `http-proxy`, `body-parser` → `express.json()`, `pretty-data` → `JSON.stringify`, `window-size` → `process.stdout.columns`, `zlib` npm shim → `node:zlib`. Remove the `tls.DEFAULT_ECDH_CURVE = 'auto'` workaround (Node <10 only). Fix `p._headers` internal API usage (lines 98 and 106) → `p.getHeaders()`.

### F5: Dependency Modernization — Client
Replace `is-docker` with an inline check that stat-tests `/.dockerenv` AND checks `/proc/self/cgroup` for the string `docker` (with memoization, matching the actual `is-docker@2` behavior). Update `hostIp()` to use `host.docker.internal` for macOS/Windows (replacing deprecated `docker.for.mac.localhost` / `docker.for.win.localhost`). Remove `cross-env` from both packages.

### F6: v23 Service Registration Support (NEW)
Add a named export `registerService()` to `container-proxy-client` v3. This standalone async function POSTs to the proxy's `/register` endpoint without monkey-patching anything and without requiring a context/service object. Bump client package from `2.2.0` → `3.0.0`.

### F7: Test Infrastructure
Add Jest + ts-jest test suites for both packages.

### F8: Docker Image Rebuild
Update the Dockerfile to use a Node 18 base image.

### F9: CI/CD Pipeline
Add GitHub Actions workflows matching `client-sqs` patterns.

### F10: v21 Backward Compatibility Verification
Verify the upgraded client still satisfies the gb-services v21 integration contract (hydration shortstop `require:` pattern, monkey-patching, registration).

### F11: v23 Integration Verification
Verify that after the companion fixes to `@gasbuddy/service` and `@gasbuddy/gb-services` (tracked as EXT-001 and EXT-002), the full v23 proxy flow works end-to-end.

## User Stories

### US-000: Verify required skills are installed
**Feature**: prerequisite
**Priority**: 1

Verify that all required skills referenced by this PRD are available in the local Claude environment before any other story executes.

**Acceptance Criteria**:
- Check for `gasbuddy-engineer` agent skill in `~/.claude/skills/`, `.claude/skills/`, or `~/.claude/plugins/cache/*/skills/`
- Output `PREREQUISITE_PASSED` if all required skills are found
- Output `PREREQUISITE_FAILED: missing [skill list]` if any are absent

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-001: Upgrade server and client engines fields and package manager to Node 18
**Feature**: F1
**Priority**: 1
**Depends On**: US-000

Update `package.json` `engines` fields in both the server (`package.json`) and client (`client/package.json`) from `>8.9` to `>=18.0.0`. Switch both packages to Yarn 3 by adding `.yarnrc.yml` at the repo root with `nodeLinker: node-modules`. Remove `package-lock.json` from the repo root. The `.nvmrc` is already `18` and does not need to change. Remove `.babelrc` files from both packages if present.

**Acceptance Criteria**:
- `package.json` engines set to `>=18.0.0` for both server and client packages
- `.yarnrc.yml` present at repo root with `nodeLinker: node-modules`
- `yarn set version self` runs successfully
- `yarn install` succeeds for both packages under Node 18
- `package-lock.json` removed from repo root (replaced by `yarn.lock`)
- Any `.babelrc` files removed from both packages

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-002: Replace Redbird with http-proxy in the server
**Feature**: F4
**Priority**: 1
**Depends On**: US-001

Remove the GitHub-commit-pinned `redbird` dependency and replace with `http-proxy` (actively maintained npm package). The replacement must reproduce all behaviors Redbird currently provides: HTTP reverse proxying on `PROXY_PORT` (default 9990), the `mainResolver` logic for routing decisions, `changeOrigin: true`, a `proxyReq` event handler for request logging and host header unmangling, and a `proxyRes` event handler for response logging.

The current server routes `/register` by calling `proxy.register('container-proxy', 'http://localhost:${server.address().port}')` — this self-routing trick must be replaced. The Express app must intercept `/register` before http-proxy processes the request (either by URL prefix matching before the proxy intercepts, or by running Express on an internal port with http-proxy forwarding only non-register traffic).

Two internal API usages must be fixed in the same story:
- `p._headers` at lines 98 and 106 of `server.js` is a Node internal API removed in Node 18. Replace with `p.getHeaders()`.
- `tls.DEFAULT_ECDH_CURVE = 'auto'` at line 9 was a workaround for a Node <10 bug (nodejs/node#16196). Remove it entirely.

Null resolver returns must be handled explicitly: when `mainResolver` returns `null`, respond with HTTP 502 rather than letting http-proxy crash or hang.

**Acceptance Criteria**:
- `redbird` removed from `package.json` dependencies
- `http-proxy` added as a runtime dependency
- Proxy HTTP server listens on `process.env.PROXY_PORT || 9990`
- `mainResolver` logic preserved: registered services return their stored URL; unregistered single-label hosts with `INGRESS_DOMAIN` set return `https://{host}.{INGRESS_DOMAIN}`; matched `protocol.hostname.port` patterns return `protocol://hostname:port`; null returned when no match and no fallback
- `proxyReq` event fires: strips `source` header, unmanges host header from `protocol.hostname.port` format, logs method + full URL using `p.getHeaders()` (not `p._headers`)
- `proxyRes` event fires: logs response status code, response headers, and body
- `POST /register` endpoint accepts `{ services: string[] }` with `HostIp` header and returns the registration map as JSON
- Server responds with 502 (not an uncaught exception) when `mainResolver` returns `null`
- `tls.DEFAULT_ECDH_CURVE` line removed
- Server startup logs port and `INGRESS_DOMAIN` if set

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-003: Remove deprecated server dependencies and replace with Node built-ins or maintained alternatives
**Feature**: F4
**Priority**: 2
**Depends On**: US-002

Replace the four dead or deprecated server dependencies:
- `body-parser` (deprecated): replace with `express.json()` middleware inline
- `pretty-data` (last updated 2013): `prettyPrint()` currently calls `pretty.pd.json(final)` for JSON and `pretty.pd.xml(final)` for XML. Replace JSON path with `JSON.stringify(JSON.parse(final), null, 2)`. For XML, use a simple indentation function or drop XML pretty-printing (plain output is acceptable).
- `window-size` (last updated 2016): `center()` currently reads `window.width`. Replace with `process.stdout.columns ?? 120`.
- `zlib` npm shim (deprecated wrapper of Node built-in): `print.js` imports `zlib` from npm. Replace with `import { unzipSync } from 'node:zlib'`.

Also fix the `"main": "src/index.js"` field in the server `package.json` — that file does not exist. After the TypeScript rewrite (US-004) it should be `"main": "build/server.js"`. Set it correctly here so it is not left as a dangling reference.

**Acceptance Criteria**:
- `body-parser`, `pretty-data`, `window-size`, `zlib` (npm) all removed from `package.json`
- `express.json()` middleware used in place of `bodyParser.json()`
- `center()` function uses `process.stdout.columns ?? 120` for terminal width
- `prettyPrint()` formats JSON content with `JSON.stringify(JSON.parse(raw), null, 2)`
- `prettyPrint()` imports `unzipSync` from `node:zlib`
- Gzip magic byte detection (`0x1f 0x8b`) preserved and decompression occurs before pretty-printing
- `"main"` field in server `package.json` updated to `"build/server.js"`

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-004: Rewrite server source in TypeScript
**Feature**: F2
**Priority**: 2
**Depends On**: US-002, US-003

Convert `src/server.js` and `src/print.js` to TypeScript. Add `tsconfig.json` and `tsconfig.build.json` at the server root matching the `client-sqs` pattern: `strict: true`, `target: ES2022`, `module: CommonJS`, `outDir: ./build`, `moduleResolution: NodeNext`. Update `package.json` build script to `tsc -p tsconfig.build.json`. Remove all Babel devDependencies (`@babel/cli`, `@babel/register`, `babel-preset-gasbuddy`). Upgrade `eslint-config-gasbuddy` from `^5` to `^7`. Export named `ProxyConfig` and `Registration` types. All types must be explicit — no untyped `any`.

**Acceptance Criteria**:
- `src/server.ts` and `src/print.ts` exist; corresponding `.js` source files removed
- `tsconfig.json` and `tsconfig.build.json` exist at repo root
- `tsc --noEmit` passes with zero errors under `strict: true`
- `yarn build` produces `build/server.js` with accompanying `.d.ts` declarations
- `babel-preset-gasbuddy`, `@babel/cli`, `@babel/register` removed from devDependencies
- `typescript` and `eslint-config-gasbuddy@^7` in devDependencies
- `yarn lint` passes with zero errors

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-005: Rewrite client source in TypeScript
**Feature**: F3
**Priority**: 2
**Depends On**: US-001

Convert `client/src/index.js` and `client/src/portFinder.js` to TypeScript. Add `client/tsconfig.json` and `client/tsconfig.build.json` with the same compiler options as the server. The public API surface — the default-exported `Proxy` class with `constructor(context, config)` and `async start(context)` — must remain identical for v21 backward compatibility. `@gasbuddy/hydration` instantiates this via `new (module.default || module)(context, config, tree)` so the default export shape is load-bearing. Export a named `ProxyClientConfig` interface. Remove all Babel devDependencies; add `typescript` and `eslint-config-gasbuddy@^7`.

Fix the latent `res.on('end')` bug in `registerWithProxy()`: at line 144 of `client/src/index.js`, the `res.on('end', ...)` callback never fires because the response body is never consumed. Add `res.resume()` inside the response callback to drain the response stream and allow the `'end'` event to fire.

**Acceptance Criteria**:
- `client/src/index.ts` and `client/src/portFinder.ts` exist; `.js` source files removed
- `client/tsconfig.json` and `client/tsconfig.build.json` exist inside `client/`
- `tsc --noEmit` inside `client/` passes with zero errors under `strict: true`
- `yarn build` in `client/` produces `client/build/index.js` and `client/build/index.d.ts`
- `client/package.json` `main` field points to `build/index.js` and `types` field points to `build/index.d.ts`
- `babel-preset-gasbuddy`, `@babel/cli`, `@babel/register` removed from client devDependencies
- `typescript` and `eslint-config-gasbuddy@^7` added to client devDependencies
- `res.resume()` called inside the `registerWithProxy` response callback so `'end'` fires

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-006: Add registerService() named export for v23 services
**Feature**: F6
**Priority**: 1
**Depends On**: US-005

This is the key new capability. Add a named export `registerService()` to `client/src/index.ts`. This function is a standalone async utility — it does NOT monkey-patch anything, does NOT require a `context` or service object, and is safe to call from any v23 lifecycle hook.

```typescript
export async function registerService(options: {
  name: string;           // service name (e.g. 'identity-serv')
  port: number;           // port this service is listening on
  proxyUrl?: string;      // default 'http://localhost:9990'
  protocol?: 'http' | 'https'; // default 'http'
  publicPort?: number;    // default 8000 for http, 8443 for https
}): Promise<void>
```

Implementation: POSTs to `${proxyUrl}/register` with `{ services: ["${protocol}.${name}.${publicPort}-${port}"] }` and sets the `HostIp` header using the updated `hostIp()` function. Consumes the response body (calls `res.resume()`) so the `'end'` event fires and the Promise resolves cleanly.

Bump client package version from `2.2.0` to `3.0.0` as part of this story (major version bump due to new named export + v21 API preserved as default export).

**Acceptance Criteria**:
- `registerService` is a named export from `client/build/index.js` and declared in `client/build/index.d.ts`
- Calling `registerService({ name: 'foo-serv', port: 3000 })` POSTs `{ services: ['http.foo-serv.8000-3000'] }` to `http://localhost:9990/register` with `HostIp` header set
- `proxyUrl`, `protocol`, and `publicPort` options work correctly
- Default export `Proxy` class is unchanged (v21 compat)
- `client/package.json` version is `3.0.0`
- Function is callable without any GasBuddy context/service object
- Promise resolves after server acknowledges registration (response `'end'` fires)

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-007: Replace is-docker and modernize client runtime dependencies
**Feature**: F5
**Priority**: 2
**Depends On**: US-005

The client currently depends on `is-docker@2` as its only runtime dependency. `is-docker@2` checks BOTH `/.dockerenv` (via `fs.statSync`) AND `/proc/self/cgroup` for the string `docker`, with memoization. Replace the import with an inline implementation that replicates this exact behavior (checking both conditions, memoizing the result). This removes the sole external runtime dependency.

Update `hostIp()`: replace the deprecated `docker.for.mac.localhost` (macOS) and `docker.for.win.localhost` (Windows) magic DNS names with `host.docker.internal`, which is the current supported name for both platforms. Keep the old names as a fallback comment for reference but do not use them as the primary value.

Remove `cross-env` from devDependencies of both packages — it is not needed under Node 18 + Yarn 3.

**Acceptance Criteria**:
- `is-docker` removed from `client/package.json` `dependencies`
- Inline Docker detection checks `/.dockerenv` existence AND `/proc/self/cgroup` content, with memoization
- Detection returns `true` inside a Docker container (on both Linux `/proc/self/cgroup` path and presence of `/.dockerenv`) and `false` otherwise
- `hostIp()` returns `host.docker.internal` for `darwin` and `win32` platforms
- `cross-env` removed from devDependencies of both server and client packages
- `client/package.json` has zero runtime dependencies after this change

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-008: Add Jest test suite for the server
**Feature**: F7
**Priority**: 2
**Depends On**: US-004

Add Jest + ts-jest testing for `@gasbuddy/container-proxy`. Tests must cover core behaviors without requiring a running Docker environment or live network. Add `jest`, `ts-jest`, `@types/jest`, `@types/express`, `@types/http-proxy`, and `supertest` to server devDependencies.

Tests must cover:
1. `mainResolver` — returns the registered target URL when a service is registered
2. `mainResolver` — returns the INGRESS_DOMAIN staging fallback URL when service is not registered and `INGRESS_DOMAIN` is set
3. `mainResolver` — strips `x-envoy-original-path` header, rewrites URL and host, sets source to `ambassador`
4. `mainResolver` — returns `null` when no pattern match and no fallback
5. `POST /register` — registers services correctly and returns the registration map
6. `POST /register` — logs an error (does not crash) when service pattern is malformed
7. `prettyPrint` — formats JSON content with proper indentation
8. `prettyPrint` — decompresses gzip-encoded content before printing
9. `center` — outputs centered text using terminal width

**Acceptance Criteria**:
- `jest.config.ts` exists at server root configured with ts-jest preset
- `yarn test` runs and all 9 test cases pass
- Coverage report generated; at least 70% line coverage on `src/`
- No test requires network access, Docker, or live port binding

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-009: Add Jest test suite for the client
**Feature**: F7
**Priority**: 2
**Depends On**: US-005, US-006, US-007

Add Jest + ts-jest testing for `@gasbuddy/container-proxy-client`. Tests mock `http` and `https` Node modules — no live network calls. Add `jest`, `ts-jest`, and `@types/jest` to client devDependencies.

Tests must cover:
1. `rewire()` — rewrites host options for a non-IP hostname: sets proxy host, sets mangled `Host` header as `protocol.original-host.port`
2. `rewire()` — returns `false` and does not modify options when target is a numeric IP address
3. `rewire()` — returns `false` for hosts matched by a string entry in `doNotProxy`
4. `rewire()` — returns `false` for hosts matched by a RegExp entry in `doNotProxy`
5. `registerWithProxy()` — builds the correct `services` array and fires POST to `/register` with `HostIp` header; `'end'` event fires because `res.resume()` is called
6. `findPort()` — returns the first available port starting from `start`
7. `findPort()` — skips a port that is in use and returns the next available one
8. `isContainer()` — returns `false` when neither `/.dockerenv` exists nor `/proc/self/cgroup` contains `docker`
9. **NEW** `registerService()` — POSTs correct registration payload to proxy URL, resolves Promise cleanly, works without a context/service object

**Acceptance Criteria**:
- `client/jest.config.ts` exists configured with ts-jest preset
- `yarn test` inside `client/` runs and all 9 test cases pass
- `http.request` and `https.request` are mocked — no live network calls
- No test requires actual port binding or file system access beyond mocks

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-010: Rebuild Docker image on Node 18 base
**Feature**: F8
**Priority**: 1
**Depends On**: US-004

Update `Dockerfile` to use a Node 18 base image. Replace `FROM gasbuddy/node-app:10-production` with `FROM node:18-alpine` (or the GasBuddy internal equivalent for Node 18 if one exists). Update the build step from `npm install && npm run build && npm prune --production` to `yarn install --immutable && yarn build`. The entrypoint must be `node build/server.js` and port 9990 must be exposed.

**Acceptance Criteria**:
- `Dockerfile` `FROM` line references a Node 18 base image
- `docker build -t gasbuddy/container-proxy .` completes successfully
- Container starts and logs to stdout indicating it is listening on port 9990
- `INGRESS_DOMAIN` environment variable is read and logged at startup when present
- `PROXY_PORT` environment variable overrides the default port at startup
- `docker run -p 9990:9990 gasbuddy/container-proxy` starts without error

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-011: Add GitHub Actions CI/CD workflows
**Feature**: F9
**Priority**: 2
**Depends On**: US-004, US-005, US-008, US-009

Create `.github/workflows/nodejs.yml` and `.github/workflows/npmpublish.yml` matching the `client-sqs` workflow pattern. `nodejs.yml` triggers on every push. `npmpublish.yml` triggers on push to `master`, calls `nodejs.yml` as a reusable workflow, then publishes `@gasbuddy/container-proxy-client` to npm and builds + pushes the `gasbuddy/container-proxy` Docker image.

`nodejs.yml` steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` with `node-version-file: .nvmrc`
3. `yarn install --immutable`
4. `yarn build` (server)
5. `cd client && yarn install --immutable && yarn build`
6. `yarn lint` (server)
7. `cd client && yarn lint`
8. `yarn test` (server)
9. `cd client && yarn test`

**Acceptance Criteria**:
- `.github/workflows/nodejs.yml` exists and triggers on push, executing all 9 steps
- `.github/workflows/npmpublish.yml` exists and triggers on push to `master`
- Publish workflow calls `nodejs.yml` as a reusable workflow before publishing
- npm publish step uses `NODE_AUTH_TOKEN` from `secrets.npm_token`
- Docker build + push step uses `docker/build-push-action` and `docker/login-action` with Docker Hub secrets

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-012: Verify gb-services v21 integration contract
**Feature**: F10
**Priority**: 1
**Depends On**: US-005, US-007

The `@gasbuddy/gb-services` v21 loads `container-proxy-client` via CommonJS `require` through the shortstop handler `"module": "require:@gasbuddy/container-proxy-client"`. Hydration then calls `new (module.default || module)(context, config, tree)` — passing three arguments, where the third is ignored by the constructor — and subsequently calls `obj.start(context, tree)`. This story verifies the TypeScript-compiled CommonJS output satisfies this contract without requiring changes to any v21 service or to `@gasbuddy/hydration`.

The key invariants: `require('@gasbuddy/container-proxy-client')` must return an object whose `.default` property is a class constructor. The constructor must accept `(context, config)` (third arg silently ignored). `async start(context)` must be present. After `start()` is called with `registerIn: 'native'`, `http.request` and `https.request` must be monkey-patched to route through the proxy.

**Acceptance Criteria**:
- `require('@gasbuddy/container-proxy-client').default` is a class constructor function (not `undefined`)
- `new Proxy(mockContext, { registerIn: 'native' }, undefined)` constructs without throwing (three-arg call)
- `await proxy.start(mockContext)` calls `registerWithProxy` (mocked) and `proxyRequests` when `registerIn` includes `'native'`
- After `start()`, `http.request` is no longer the original Node `http.request`
- Smoke test steps documented in `docs/v21-integration.md`

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-013: Verify v23 proxy registration and routing
**Feature**: F11
**Priority**: 1
**Depends On**: US-006

Verify that `registerService()` produces registrations the server decodes correctly, and that subsequent requests using the `protocol.hostname.port` host header encoding are routed to the registered target. Note: end-to-end v23 proxy routing also requires EXT-001 (fix requestInterceptor overwrite in `@gasbuddy/service`) and EXT-002 (implement registration call in `@gasbuddy/gb-services`) — those are tracked as separate work items and are NOT part of this repo. This story verifies the container-proxy side of the contract only.

Test scenarios (using supertest or a live test server instance):
1. `registerService({ name: 'some-service-api', port: 3001 })` followed by a request with `Host: http.some-service-api.8000` — server forwards to `http://{hostIp}:3001`
2. Request with `Host: http.some-service-api.8000` with no registration and `INGRESS_DOMAIN` set — server forwards to `https://some-service-api.$INGRESS_DOMAIN`
3. Request with `Host: http.some-service-api.8000` with no registration and no `INGRESS_DOMAIN` — server returns 502 without crashing
4. Verify the `protocol.hostname.port` header format that `@gasbuddy/service` requestInterceptor would encode matches what `mainResolver` decodes (cross-reference `@gasbuddy/service/src/service-calls/index.ts` line 78: `headers.host = \`${proto}.${parsedUrl.hostname}.${port || defaultPort}\``)

**Acceptance Criteria**:
- Integration test covers all 4 scenarios above
- Server returns 502 (not uncaught exception) when resolver returns `null`
- `registerService()` POST format `{ services: ["protocol.name.publicPort-port"] }` is correctly decoded by `/register` endpoint
- Smoke test steps documented in `docs/v23-integration.md`

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

### US-014: Update package metadata and add Prettier and lint-staged
**Feature**: F2, F3
**Priority**: 3
**Depends On**: US-001

Bring both `package.json` files up to current GasBuddy standards. Add Prettier configuration and Husky pre-commit hooks matching the `client-sqs` pattern.

**Acceptance Criteria**:
- Both `package.json` files have a `repository` field pointing to the GitHub repo URL
- Both `package.json` files have `engines: { node: ">=18.0.0" }`
- Client `package.json` has `types: "build/index.d.ts"`
- `.prettierrc` exists at repo root
- `lint-staged` config in server `package.json` runs `eslint --cache --fix` on staged `*.ts` files
- Husky `pre-commit` hook runs `lint-staged` and is installed via `yarn prepare`
- `packageManager` field set to current Yarn 3 version in both `package.json` files

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking this story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

**Quality Gates**:
- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

---

## Separate Work Items

These items are required for end-to-end v23 proxy support but are changes to other repositories. They are documented here so the team can track the dependency chain. Neither item is a deliverable of this repo's PR.

### EXT-001: Fix requestInterceptor overwrite in @gasbuddy/service
**Package**: `@gasbuddy/service`
**Priority**: CRITICAL for v23 proxy to work end-to-end
**Depends On**: container-proxy-client v3 published (US-006)

**Bug**: `@gasbuddy/service/src/service-calls/index.ts` line 91 unconditionally overwrites `fetchConfig.requestInterceptor` with a correlationid-only interceptor. The proxy interceptor set at line 67 (which encodes `protocol.hostname.port` into the Host header and rewrites the URL to point at `localhost:9990`) is completely discarded. No v23 service call ever goes through the proxy as a result.

**Fix**: When `config.proxy` is set, merge the proxy URL rewriting logic into the single interceptor rather than assigning two separate interceptors. The merged interceptor must: (1) inject correlationid, (2) encode `protocol.hostname.port` into the Host header, (3) rewrite the URL to point at the proxy. All three behaviors are required and none should be conditional on the other.

**Separate PR to**: `@gasbuddy/service` repo

### EXT-002: Implement service registration in gb-services start()
**Package**: `@gasbuddy/gb-services`
**Priority**: CRITICAL for v23 proxy to work end-to-end
**Depends On**: EXT-001, container-proxy-client v3 published (US-006)

**Bug**: `@gasbuddy/gb-services/src/service.ts` line 113 contains `// TODO Register the service with container proxy if necessary`. This was never implemented. The `registerProxy` key in `config/development.json` (`"registerProxy": "http://localhost:9990"`) is present but is never read by any code path.

**Fix**: In the `start(app)` lifecycle hook, after `setupDefaultServices(app)`, read `app.locals.config.get('registerProxy')`. If set, import `registerService` from `@gasbuddy/container-proxy-client` (v3) and call it with `{ name: app.locals.name, port: <actual bound port>, proxyUrl: registerProxy }`. Read the actual bound port from `app.locals.config.get('server:port')` or from the server's bound address after listen.

**Separate PR to**: `@gasbuddy/gb-services` repo

---

## Quality Gates

- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

## Agent Implementation Instructions

1. CRITICAL: Read progress/state file FIRST — it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw — if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes — fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking any user story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

## Required Skills

- gasbuddy-engineer
- claude-pilot
- engg-skills-generic
