# AI Context: container-proxy

## Architecture Decision Records

### ADR-001: Header Mangling for Proxy Routing
- **Decision**: Encode protocol, hostname, port in HTTP host header
- **Rationale**: http-proxy resolver receives host/url; routing metadata encoded here
- **Format**: `protocol.hostname.publicPort[-privatePort]`
- **Trade-off**: Non-standard headers vs simplicity of single proxy resolver

### ADR-002: HTTP Module Monkey Patching (Client)
- **Decision**: Client library globally patches `http.request` and `https.request`
- **Rationale**: Transparent proxying without requiring service code changes
- **Risk**: Side effects on other libraries; must be loaded early in process
- **Mitigation**: `doNotProxy` option for bypass patterns

### ADR-003: Dynamic Registration Over Static Config
- **Decision**: Services register at startup via POST /register instead of static config
- **Rationale**: Supports variable service sets, dynamic port allocation, dev flexibility
- **Trade-off**: In-memory only (lost on restart) vs persistent service mesh

### ADR-004: registerService() as Explicit Alternative
- **Decision**: Export async `registerService(options)` for direct invocation
- **Rationale**: Offer simpler one-off registration without client proxy setup
- **Format**: `{ name, port, proxyUrl?, protocol?, publicPort? }` → POST to /register
- **Use case**: v2.3+ services that prefer explicit over implicit monkey-patching

### ADR-005: TypeScript + http-proxy Modernization
- **Decision**: Migrate from Babel + Redbird to TypeScript + http-proxy
- **Rationale**: Type safety, standard http-proxy ecosystem, Node 18 LTS
- **Trade-off**: Breaking changes (Redbird → http-proxy API) vs maintainability gain

## Component Map

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Proxy Server | `src/server.ts` | Accept registrations, http-proxy resolver, log traffic, handle /register POST |
| Log Formatter | `src/print.ts` | Pretty-print JSON/XML bodies, handle gzip, terminal-aware |
| Client Library | `client/src/index.ts` | Monkey-patch http/https, register with proxy, intercept outbound, registerService() export |
| Port Finder | `client/src/portFinder.ts` | Scan for available ports in range (Node 18+ built-ins) |

## Data Flow

```
1. Service boots → new Proxy(context, config).start()
   → DNS lookup container-proxy (fallback 127.0.0.1 for Rancher Desktop)
   → POST /register to proxy:9990 with encoded service string

2. Alt: Service calls registerService({ name, port, proxyUrl, protocol, publicPort })
   → Same POST /register, uses originalRequest (bypasses client monkey-patch)

3. Service A calls Service B → http.request intercepted by client
4. Client rewire() checks doNotProxy → rewrite host header
   → proto.serviceB.publicPort[-privatePort] header → proxy:9990
5. Proxy http-proxy resolver decodes header → looks up registration → forwards to actual IP:port
6. Response streamed back through proxy → logged → returned to caller
```

