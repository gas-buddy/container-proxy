# AI Context: container-proxy

## Architecture Decision Records

### ADR-001: Header Mangling for Proxy Routing
- **Decision**: Encode protocol, hostname, port in HTTP host header
- **Rationale**: Redbird proxy resolver only receives host/url, no custom metadata channel
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

## Component Map

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Proxy Server | `src/server.js` | Accept registrations, resolve routes, proxy requests, log traffic |
| Log Formatter | `src/print.js` | Pretty-print JSON/XML bodies, handle gzip, terminal-aware |
| Client Library | `client/src/index.js` | Monkey-patch http/https, register with proxy, intercept outbound |
| Port Finder | `client/src/portFinder.js` | Scan for available ports in range |

## Data Flow

```
1. Service boots → client.register() → POST /register to proxy
2. Service A calls Service B → http.request intercepted by client
3. Client rewrites request → proto.serviceB.port header → proxy:9990
4. Proxy resolver decodes header → looks up registration → forwards to actual IP:port
5. Response streamed back through proxy → logged → returned to caller
```
