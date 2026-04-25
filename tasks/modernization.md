# container-proxy Modernization

## Description

`container-proxy` is a two-package repo providing local development infrastructure for GasBuddy microservices. The server (`@gasbuddy/container-proxy`) is a Redbird-based reverse proxy running on port 9990 that routes inter-service HTTP traffic during local development. The client (`@gasbuddy/container-proxy-client`) monkey-patches Node's `http`/`https` globals so any service process transparently routes its outbound calls through the proxy.

The packages have accumulated severe technical debt: the server runs on Node 10 (with a Node 10 Docker base image), uses Redbird -- a proxy library last updated in 2014 pinned to a specific GitHub commit -- and depends on multiple abandoned npm packages (`pretty-data`, `window-size`, `zlib` npm shim). Neither package has any tests. The build system uses Babel with `babel-preset-gasbuddy` instead of TypeScript. This modernization effort brings both packages into alignment with current GasBuddy standards, as exemplified by `@gasbuddy/client-sqs`.

## Goals

1. Both packages must build and run under Node 18, matching the `.nvmrc` already in the repo.
2. Both packages must be fully rewritten in TypeScript, exporting correct `.d.ts` type declarations.
3. All dead or abandoned runtime dependencies must be replaced with maintained alternatives or Node built-ins.
4. The server Docker image must be rebuilt on a Node 18 base image so `tooling/docker-compose.yml` can pull and run a working container.
5. Both packages must have Jest test suites (zero tests currently exist).
6. CI/CD must be established via GitHub Actions, matching the `client-sqs` workflow pattern (build + lint + test on push; npm publish on main).
7. All existing consumer contracts must be preserved: the `protocol.hostname.port` header-mangling protocol, the `POST /register` API, the `INGRESS_DOMAIN` staging fallback, the `PROXY_PORT` env override, and the Envoy `x-envoy-original-path` stripping logic.
8. The `@gasbuddy/gb-services` v21 integration (monkey-patching via `connections.proxy` config key) must continue to work unchanged after the client package upgrade.

## Features

### F1: Node 18 Runtime Upgrade
Upgrade the runtime, tooling, and Docker base image to Node 18.

### F2: TypeScript Rewrite -- Server
Rewrite `@gasbuddy/container-proxy` server source in TypeScript.

### F3: TypeScript Rewrite -- Client
Rewrite `@gasbuddy/container-proxy-client` in TypeScript.

### F4: Dependency Modernization -- Server
Replace all abandoned/deprecated server dependencies.

### F5: Dependency Modernization -- Client
Replace or remove client dependencies that need attention.

### F6: Test Infrastructure
Add Jest + ts-jest test suites for both packages.

### F7: Docker Image Rebuild
Update the Dockerfile to use a Node 18 base image.

### F8: CI/CD Pipeline
Add GitHub Actions workflows matching `client-sqs` patterns.

### F9: v21 Backward Compatibility Verification
Verify the client still satisfies the gb-services v21 integration contract.

### F10: v23 Integration Verification
Verify the proxy still works correctly with the gb-services v23 `requestInterceptor` pattern.

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
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

Update `package.json` `engines` fields in both the server (`package.json`) and client (`client/package.json`) from `>8.9` to `>=18.0.0`. Switch both packages to Yarn 3 by adding `.yarnrc.yml` at the repo root with `nodeLinker: node-modules`. Remove `package-lock.json` from the repo root. The `.nvmrc` is already `18` and does not need to change.

**Acceptance Criteria**:
- `package.json` engines set to `>=18.0.0` for both server and client packages
- `.yarnrc.yml` present at repo root with `nodeLinker: node-modules`
- `yarn set version self` runs successfully
- `yarn install` succeeds for both packages under Node 18
- `package-lock.json` removed from repo root (replaced by `yarn.lock`)

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

Remove the GitHub-commit-pinned `redbird` dependency and replace with `http-proxy` (actively maintained npm package). The replacement must reproduce all behaviors Redbird currently provides: HTTP reverse proxying on `PROXY_PORT` (default 9990), the `mainResolver` logic for routing decisions, `changeOrigin: true`, a `proxyReq` event handler for request logging and host header unmangling, and a `proxyRes` event handler for response logging. The `proxy.register('container-proxy', ...)` self-routing call must be replaced by routing `/register` requests to the Express app before passing anything else to http-proxy. The Express app can listen on an ephemeral internal port, with http-proxy forwarding to it; or `/register` can be matched by URL prefix before the proxy intercepts the request.

**Acceptance Criteria**:
- `redbird` removed from `package.json` dependencies
- `http-proxy` added as a runtime dependency
- Proxy HTTP server listens on `process.env.PROXY_PORT || 9990`
- `mainResolver` logic preserved: registered services return their stored URL; unregistered single-label hosts with `INGRESS_DOMAIN` set return `https://{host}.{INGRESS_DOMAIN}`; matched `protocol.hostname.port` patterns return `protocol://hostname:port`; no match returns `null`
- `proxyReq` event fires: strips `source` header, unmanges host header from `protocol.hostname.port` format, logs method + full URL
- `proxyRes` event fires: logs response status code, response headers, and body
- `POST /register` endpoint accepts `{ services: string[] }` with `HostIp` header and returns the registration map as JSON
- Server startup logs port and `INGRESS_DOMAIN` if set

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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
- `pretty-data` (last updated 2013): replace with native `JSON.stringify(JSON.parse(s), null, 2)` for JSON; for XML use `fast-xml-parser` or a simple indentation function
- `window-size` (last updated 2016): replace with `process.stdout.columns ?? 120`
- `zlib` npm shim (deprecated wrapper of Node built-in): remove and import `node:zlib` directly

**Acceptance Criteria**:
- `body-parser`, `pretty-data`, `window-size`, `zlib` (npm) all removed from `package.json`
- `express.json()` middleware used in place of `bodyParser.json()`
- `center()` function uses `process.stdout.columns ?? 120` for terminal width
- `prettyPrint()` formats JSON content with `JSON.stringify(JSON.parse(raw), null, 2)`
- `prettyPrint()` imports `unzipSync` from `node:zlib`
- Gzip magic byte detection (`0x1f 0x8b`) preserved and decompression occurs before pretty-printing

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

Convert `src/server.js` and `src/print.js` to TypeScript. Add `tsconfig.json` and `tsconfig.build.json` at the server root matching the `client-sqs` pattern: `strict: true`, `target: ES2022`, `module: CommonJS`, `outDir: ./build`, `moduleResolution: NodeNext`. Update `package.json` build script to `tsc -p tsconfig.build.json`. Remove all Babel devDependencies. Upgrade `eslint-config-gasbuddy` from `^5` to `^7`. Export a named `ProxyConfig` interface. All types must be explicit -- no untyped `any`.

**Acceptance Criteria**:
- `src/server.ts` and `src/print.ts` exist; corresponding `.js` source files removed
- `tsconfig.json` and `tsconfig.build.json` exist at repo root
- `tsc --noEmit` passes with zero errors
- `yarn build` produces `build/server.js` with accompanying `.d.ts` declarations
- `babel-preset-gasbuddy`, `@babel/cli`, `@babel/register` removed from devDependencies
- `typescript` and `eslint-config-gasbuddy@^7` in devDependencies
- `yarn lint` passes with zero errors

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

Convert `client/src/index.js` and `client/src/portFinder.js` to TypeScript. Add `client/tsconfig.json` and `client/tsconfig.build.json` with the same compiler options as the server. The public API surface -- the default-exported `Proxy` class with `constructor(context, config)` and `async start(context)` -- must remain identical for v21 backward compatibility. Export a named `ProxyClientConfig` interface. Remove all Babel devDependencies; add `typescript` and `eslint-config-gasbuddy@^7`.

**Acceptance Criteria**:
- `client/src/index.ts` and `client/src/portFinder.ts` exist; `.js` source files removed
- `client/tsconfig.json` and `client/tsconfig.build.json` exist inside `client/`
- `tsc --noEmit` inside `client/` passes with zero errors
- `yarn build` in `client/` produces `client/build/index.js` and `client/build/index.d.ts`
- `client/package.json` `main` field points to `build/index.js` and `types` field points to `build/index.d.ts`
- `babel-preset-gasbuddy`, `@babel/cli`, `@babel/register` removed from client devDependencies
- `typescript` and `eslint-config-gasbuddy@^7` added to client devDependencies

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-013: Remove is-docker from client and modernize client runtime dependencies
**Feature**: F5
**Priority**: 2
**Depends On**: US-005

The client currently depends on `is-docker` as its only runtime dependency. Replace it with an inline Docker detection check: on Linux, read `/proc/1/cgroup` and check for the string `docker`; on other platforms return `false`. This removes the sole external runtime dependency from the client package. Also remove `cross-env` from devDependencies in both packages as it is no longer needed with Yarn 3 and Node 18.

**Acceptance Criteria**:
- `is-docker` removed from `client/package.json` `dependencies`
- Docker detection logic inlined in `client/src/index.ts` using filesystem check
- Detection returns `true` inside a Docker container on Linux and `false` otherwise
- `cross-env` removed from devDependencies of both server and client packages
- `client/package.json` has zero runtime dependencies after this change
- Existing `isContainer()` function behavior is unchanged from the caller's perspective

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-006: Add Jest test suite for the server
**Feature**: F6
**Priority**: 2
**Depends On**: US-004

Add Jest + ts-jest testing for `@gasbuddy/container-proxy`. Tests must cover core behaviors without requiring a running Docker environment or live network. Add `jest`, `ts-jest`, `@types/jest`, `@types/express`, `@types/http-proxy`, and `supertest` to server devDependencies.

Tests must cover:
1. `mainResolver` -- returns the registered target URL when a service is registered
2. `mainResolver` -- returns the INGRESS_DOMAIN staging fallback URL when service is not registered and `INGRESS_DOMAIN` is set
3. `mainResolver` -- strips `x-envoy-original-path` header, rewrites URL and host, sets source to `ambassador`
4. `mainResolver` -- returns `null` when no pattern match and no fallback
5. `POST /register` -- registers services correctly and returns the registration map
6. `POST /register` -- logs an error (does not crash) when service pattern is malformed
7. `prettyPrint` -- formats JSON content with proper indentation
8. `prettyPrint` -- decompresses gzip-encoded content before printing
9. `center` -- outputs centered text using terminal width

**Acceptance Criteria**:
- `jest.config.ts` exists at server root configured with ts-jest preset
- `yarn test` runs and all 9 test cases pass
- Coverage report generated; at least 70% line coverage on `src/`
- No test requires network access, Docker, or live port binding

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-007: Add Jest test suite for the client
**Feature**: F6
**Priority**: 2
**Depends On**: US-005, US-013

Add Jest + ts-jest testing for `@gasbuddy/container-proxy-client`. Tests mock `http` and `https` Node modules -- no live network calls. Add `jest`, `ts-jest`, and `@types/jest` to client devDependencies.

Tests must cover:
1. `rewire()` -- rewrites host options for a non-IP hostname: sets proxy host, sets mangled `Host` header as `protocol.original-host.port`
2. `rewire()` -- returns `false` and does not modify options when target is a numeric IP address
3. `rewire()` -- returns `false` for hosts matched by a string entry in `doNotProxy`
4. `rewire()` -- returns `false` for hosts matched by a RegExp entry in `doNotProxy`
5. `registerWithProxy()` -- builds the correct `services` array and fires POST to `/register` with `HostIp` header
6. `findPort()` -- returns the first available port starting from `start`
7. `findPort()` -- skips a port that is in use and returns the next available one
8. `isContainer()` -- returns `false` when `/proc/1/cgroup` is absent (non-Linux / not Docker)

**Acceptance Criteria**:
- `client/jest.config.ts` exists configured with ts-jest preset
- `yarn test` inside `client/` runs and all 8 test cases pass
- `http.request` and `https.request` are mocked -- no live network calls
- No test requires actual port binding or file system access beyond mocks

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-008: Rebuild Docker image on Node 18 base
**Feature**: F7
**Priority**: 1
**Depends On**: US-004

Update `Dockerfile` to use a Node 18 base image. Replace `FROM gasbuddy/node-app:10-production` with `FROM node:18-alpine` (or the GasBuddy internal equivalent for Node 18 if one exists). Update the build step from `npm install && npm run build && npm prune --production` to `yarn install --immutable && yarn build`. The entrypoint must remain `node build/server.js` and port 9990 must be exposed.

**Acceptance Criteria**:
- `Dockerfile` `FROM` line references a Node 18 base image
- `docker build -t gasbuddy/container-proxy .` completes successfully
- Container starts and logs to stdout indicating it is listening on port 9990
- `INGRESS_DOMAIN` environment variable is read and logged at startup when present
- `PROXY_PORT` environment variable overrides the default port at startup
- `docker run -p 9990:9990 gasbuddy/container-proxy` starts without error

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-009: Add GitHub Actions CI/CD workflows
**Feature**: F8
**Priority**: 2
**Depends On**: US-004, US-005, US-006, US-007

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
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-010: Verify gb-services v21 integration contract
**Feature**: F9
**Priority**: 1
**Depends On**: US-005, US-013

The `@gasbuddy/gb-services` v21 loads `container-proxy-client` via CommonJS `require` using shortstop `"module": "require:@gasbuddy/container-proxy-client"`. The loaded module is instantiated as `new Proxy(context, config)` with `config.registerIn: 'native'`. This story verifies the TypeScript-compiled CommonJS output satisfies this contract without requiring changes to any v21 service.

The key invariants: `require('@gasbuddy/container-proxy-client')` must return an object whose `.default` property is a class constructor. The constructor must accept `(context, config)` and expose `async start(context)`. After `start()` is called, `http.request` and `https.request` must be monkey-patched to route through the proxy.

**Acceptance Criteria**:
- `require('@gasbuddy/container-proxy-client').default` is a class constructor function (not `undefined`)
- `new Proxy(mockContext, { registerIn: 'native' })` constructs without throwing
- `await proxy.start(mockContext)` calls `registerWithProxy` (mocked) and `proxyRequests` when `registerIn` includes `'native'`
- After `start()`, `http.request` is no longer the original Node `http.request`
- Smoke test steps documented in `docs/v21-integration.md`

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-011: Verify gb-services v23 proxy routing
**Feature**: F10
**Priority**: 2
**Depends On**: US-002, US-004

The gb-services v23 `requestInterceptor` encodes `protocol.hostname.port` into the Host header and routes all outbound calls to `http://localhost:9990`. This story verifies the modernized server correctly resolves these requests in all three relevant scenarios.

Test scenarios (using `supertest` or direct HTTP against a live test server):
1. `Host: http.some-service-api.8000` with service registered -- server forwards to `http://localhost:$registeredPort`
2. `Host: http.some-service-api.8000` with no registration and `INGRESS_DOMAIN` set -- server forwards to `https://some-service-api.$INGRESS_DOMAIN`
3. `Host: http.some-service-api.8000` with no registration and no `INGRESS_DOMAIN` -- server returns 502 without crashing

**Acceptance Criteria**:
- Integration test covers all 3 scenarios above using a test instance of the server
- Server returns 502 (not an uncaught exception/500) when the resolver returns `null`
- v23 `requestInterceptor` header format `protocol.hostname.port` is correctly decoded by `mainResolver`
- Smoke test steps documented in `docs/v23-integration.md`

**Agent Implementation Instructions**:
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

### US-012: Update package metadata and add Prettier and lint-staged
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
1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
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

## Quality Gates

- All new code passes `tsc --noEmit` with `strict: true`
- `yarn lint` exits 0 for both packages
- `yarn test` exits 0 for both packages with no skipped tests
- No new untyped `any` without an explicit `// eslint-disable-next-line` comment and justification
- Docker image builds and container starts without error
- All existing behaviors preserved: `protocol.hostname.port` header mangling, `INGRESS_DOMAIN` staging fallback, `PROXY_PORT` override, Envoy `x-envoy-original-path` stripping, `POST /register` API contract

## Agent Implementation Instructions

1. CRITICAL: Read progress/state file FIRST -- it has IDs, queries, and decisions from previous iterations. Do not re-discover what is already known.
2. DO NOT read large files raw -- if a file is >5K tokens, use a summary/reference doc or read specific line ranges instead.
3. Use lightweight tool modes -- fetch metadata/structure before full content; use minimal validation before comprehensive checks.
4. Before finishing: Update the progress/state file with what you built, resource IDs, and remaining work.
5. Before marking any user story as complete, run `/code-review` and resolve all Critical and High severity issues reported. The story is NOT done until the code review passes.
6. Use claude-pilot skill agents during story implementation.
7. Use engg-skills-generic skill agent for autonomous-agent-loop to iterate each user story before marking as done.

## Required Skills

- gasbuddy-engineer
- claude-pilot
- engg-skills-generic
