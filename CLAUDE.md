# container-proxy

## Overview

Reverse HTTP/HTTPS proxy for GasBuddy local microservice development. Enables Docker containers and native host services to discover and communicate with each other dynamically.

**Packages:**
- `@gasbuddy/container-proxy` (v3.1.0) — proxy server
- `@gasbuddy/container-proxy-client` (v2.2.0) — client that monkey-patches Node http/https

## Tech Stack

- Node.js (currently targets >8.9; `.nvmrc` set to 18 as upgrade target)
- Babel (babel-preset-gasbuddy) — ES6+ transpilation
- Express 4 — registration API
- Redbird — HTTP reverse proxy engine (custom GitHub fork)
- Docker — containerized deployment (base image: node 10)

## Project Structure

```
src/server.js       # Main proxy server (port 9990, registration, resolver, logging)
src/print.js        # Request/response pretty-printing (JSON, XML, gzip handling)
client/src/index.js # Client proxy class (monkey-patches http/https, auto-registers)
client/src/portFinder.js # Available port scanner
Dockerfile          # Docker image (gasbuddy/node-app:10-production base)
```

## Commands

```bash
# Server
npm run build          # Babel transpile src/ → build/
npm run lint           # ESLint
npm start              # Run compiled server
npm run start-dev      # Run with babel-register (dev)
npm run build-docker   # Build Docker image
npm run publish-docker # Push Docker image

# Client
cd client && npm run build  # Babel transpile client
```

## Key Architecture

- **Header mangling**: routing encoded in host header as `proto.servicename.port`
- **Dynamic registration**: services POST to `/register` with name, port, protocol
- **Monkey patching**: client patches `http.request`/`https.request` to intercept outbound calls
- **Port finder**: allocates available ports for multiple services on same host
- **Environment detection**: adapts behavior for Docker vs native execution

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROXY_PORT` | Proxy listen port | 9990 |
| `INGRESS_DOMAIN` | Forward unregistered services to external domain | — |
| `CONTAINER_TO_HOST_IP` | Override host IP for container→host routing | auto-detect |

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
