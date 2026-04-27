# container-proxy

## Overview

Reverse HTTP/HTTPS proxy for GasBuddy local microservice development. Enables Docker containers and native host services to discover and communicate with each other dynamically.

**Packages:**
- `@gasbuddy/container-proxy` (v3.1.0) — proxy server
- `@gasbuddy/container-proxy-client` (v3.0.0) — client that monkey-patches Node http/https, exports `registerService()`

## Tech Stack

- Node.js 18 (`.nvmrc`: 18, engines: >=18.0.0)
- TypeScript 6 — type-safe implementation
- Express 4 — registration API
- http-proxy 1.18 — HTTP reverse proxy engine
- Jest — unit testing
- Docker — containerized deployment (base image: node:18-alpine → ghcr.io/gas-buddy/container-proxy)
- Yarn 3 — package manager

## Project Structure

```
src/server.ts           # Main proxy server (port 9990, registration, http-proxy resolver, logging)
src/print.ts            # Request/response pretty-printing (JSON, XML, gzip handling)
client/src/index.ts     # Client proxy class (monkey-patches http/https, registerService() export)
client/src/portFinder.ts # Available port scanner (Node 18+ built-ins only)
Dockerfile              # Docker image (node:18-alpine, Yarn 3, TypeScript compile)
tsconfig.json           # TypeScript configuration
```

## Commands

```bash
yarn build            # tsc -p tsconfig.build.json (TS → build/)
yarn lint             # eslint src/ (GasBuddy ESLint config)
yarn start            # node build/server.js
yarn test             # jest (unit tests, ts-jest)
yarn build-docker     # docker build -t ghcr.io/gas-buddy/container-proxy .
yarn publish-docker   # docker push ghcr.io/gas-buddy/container-proxy
```

## Key Architecture

- **Header mangling**: routing encoded in host header as `proto.servicename.port[-privatePort]`
- **Dynamic registration**: services POST to `/register` (JSON with services array) or call `registerService()`
- **Monkey patching**: client patches `http.request`/`https.request` to intercept outbound calls
- **Port finder**: allocates available ports for multiple services on same host (Node 18+ built-ins only)
- **Environment detection**: adapts behavior for Docker vs native; defaults to 127.0.0.1 (Rancher Desktop compat)

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROXY_PORT` | Proxy listen port | 9990 |
| `CONTAINER_TO_HOST_IP` | Override host IP for container→host routing | auto-detect (Darwin/Windows: host.docker.internal, Linux: first non-internal IPv4) |

## Conventions

- Conventional commits: `feat|fix|refactor|test|docs|chore(scope): subject`
- GasBuddy ESLint config (`eslint-config-gasbuddy`)
- MIT license
- Separate client/server packages in single repo

## GasBuddy AI Constitution

See https://github.com/gas-buddy/gb-services/blob/main/ai-framework/knowledge/GASBUDDY_PRINCIPLES.md for:
- Core development principles
- Sensitive data protection rules (MANDATORY)
- Code standards (TypeScript, Pino logging, error handling)
- Commit standards
- Human-in-the-loop classifications
- Model selection & session cost hygiene
