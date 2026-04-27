# container-proxy

GasBuddy local development reverse proxy for microservice-to-microservice communication.

## What it does

GasBuddy has a microservice architecture based on Docker, Node.js, and OpenAPI. Services discover each other through container-proxy, which solves three problems in local development:

1. **Network transparency** — Docker containers and native host processes can talk to each other seamlessly. Services register with the proxy on startup, and all outbound HTTP is routed through it.
2. **Port management** — Multiple services on the same host can't all listen on port 8000. The client allocates unique ports and registers port mappings (e.g., "when someone asks for my-serv:8000, send them to 192.168.1.5:8002").
3. **Request tracing** — All proxied traffic is logged with pretty-printed JSON bodies, making it easy to debug service-to-service calls in one terminal.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| `@gasbuddy/container-proxy` | 3.1.0 | Reverse proxy server (runs in Docker via tooling) |
| `@gasbuddy/container-proxy-client` | 3.0.0 | Client library (runs in each service process) |

## How it works

The client encodes routing info in the HTTP `Host` header as `protocol.hostname.port`:

```
https://my-serv:8443/foobar
  → Host: https.my-serv.8443
  → routed to container-proxy:9990
  → proxy decodes header, looks up registration
  → forwards to actual IP:port where my-serv is listening
```

### v21 services (gb-services ≤21)

The client is loaded via hydration (`connections.proxy.module` in `config/development.json`). It monkey-patches `http.request` and `https.request` globally so all outbound calls are transparently proxied. Registration happens automatically during `start()`.

### v23 services (gb-services ≥23)

v23 services use `createServiceInterface()` with `requestInterceptor` for header encoding. For registration, call `registerService()` directly:

```typescript
import { registerService } from '@gasbuddy/container-proxy-client';

// In your service's start() hook:
await registerService({
  name: 'my-serv',
  port: 3000,              // port your service is listening on
  proxyUrl: 'http://127.0.0.1:9990',  // default
  protocol: 'http',        // default
  publicPort: 8000,        // default for http (8443 for https)
});
```

### Staging fallback

When `INGRESS_DOMAIN` is set (e.g., `stage.internal.gasbuddy.engineering`), requests for unregistered services are forwarded to `https://{service-name}.{INGRESS_DOMAIN}`. This lets you run a subset of services locally while the rest route to staging.

## Setup

container-proxy runs as a Docker container via [tooling](https://github.com/gas-buddy/tooling):

```yaml
# tooling/docker-compose.yml
container-proxy:
  image: ghcr.io/gas-buddy/container-proxy
  ports:
    - "9990:9990"
  environment:
    - INGRESS_DOMAIN=stage.internal.gasbuddy.engineering
```

Requires the `tooling_gb_internal` Docker network:

```bash
docker network create tooling_gb_internal
```

## Development

```bash
nvm use                    # Node 18
yarn install               # server deps
cd client && yarn install  # client deps

# Server
yarn build                 # tsc → build/
yarn test                  # Jest (18 tests)
yarn lint                  # ESLint

# Client
cd client
yarn build                 # tsc → build/
yarn test                  # Jest (27 tests)
yarn lint                  # ESLint

# Docker
yarn build-docker          # docker build → ghcr.io/gas-buddy/container-proxy
```

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PROXY_PORT` | Proxy listen port | `9990` |
| `INGRESS_DOMAIN` | Forward unregistered services to this domain | — |
| `CONTAINER_TO_HOST_IP` | Override host IP for container→host routing | auto-detect |

## Tech stack

- Node.js 18, TypeScript (strict)
- `http-proxy` — reverse proxy engine
- `express` — registration API
- Jest + ts-jest — testing
- Yarn 3, `@gasbuddy/coconfig` — build tooling
- GitHub Actions — CI/CD
- Docker (node:18-alpine) → `ghcr.io/gas-buddy/container-proxy`

## Related

- [tooling](https://github.com/gas-buddy/tooling) — Docker Compose setup that runs container-proxy
- [gb-services](https://github.com/gas-buddy/gb-services) — Service framework (v21 hydration, v23 `createServiceInterface`)
- [service](https://github.com/gas-buddy/service) — Core service library (`createServiceInterface`, `requestInterceptor`)

### Companion work for full v23 support

- **EXT-001**: Fix `requestInterceptor` overwrite in `@gasbuddy/service` ([spec](tasks/ext-001-gasbuddy-service-fix.md))
- **EXT-002**: Implement registration in `@gasbuddy/gb-services` `start()` ([spec](tasks/ext-002-gb-services-registration.md))
