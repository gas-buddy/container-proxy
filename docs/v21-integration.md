# v21 Integration Smoke Test Guide

This guide explains how to verify that `@gasbuddy/container-proxy-client` works
correctly when hydrated by gb-services v21.

## Background

gb-services v21 instantiates service plugins via:

```js
new Plugin(context, config, tree)  // three arguments
```

The `Proxy` class only consumes the first two arguments, so the third (`tree`) is
silently ignored by the JavaScript runtime. The tests in
`client/__tests__/v21-compat.spec.ts` codify this guarantee.

## Running the dedicated v21 compat tests

```bash
cd client
yarn test --testPathPattern v21-compat
```

Expected output (all passing):

```
PASS __tests__/v21-compat.spec.ts
  v21 hydration compat (US-013)
    ✓ require().default is a function (class constructor)
    ✓ new Proxy(context, config, tree) — 3 args works without throwing
    ✓ http.request is patched after start()
    ✓ patched http.request sets host header for domain requests
    ✓ registerIn: "native" skips registration when not running in Docker
```

## Manual smoke test in a real v21 service

1. Add the client as a dependency:

   ```bash
   yarn add @gasbuddy/container-proxy-client
   ```

2. In `config/default.json` (or confit equivalent) add:

   ```json
   "containerProxy": {
     "hostname": "container-proxy",
     "port": 9990
   }
   ```

3. In the gb-services v21 plugin list (e.g. `plugins.js`):

   ```js
   const Proxy = require('@gasbuddy/container-proxy-client').default;
   module.exports = [Proxy];
   ```

4. Start the service and look for a log line like:

   ```
   Global proxy configured for http://container-proxy:9990
   ```

5. Make an outbound HTTP call to another registered service. Observe that the
   `host` header is rewritten to `http.<service-name>.<port>` and the request
   is routed through the proxy.

## Key behaviour differences by environment

| Config                  | Docker container    | Native (laptop)        |
|-------------------------|---------------------|------------------------|
| No `registerIn`         | Registers + proxies | Registers + proxies    |
| `registerIn: 'docker'`  | Registers + proxies | Skips registration     |
| `registerIn: 'native'`  | Skips registration  | Registers + proxies    |
| No `proxyIn`            | Proxies requests    | Proxies requests       |
| `proxyIn: 'docker'`     | Proxies requests    | Does NOT proxy requests|
