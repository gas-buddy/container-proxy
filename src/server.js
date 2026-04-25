import http from 'http';
import stream from 'stream';
import httpProxy from 'http-proxy';
import express from 'express';
import { center, prettyPrint } from './print';

const SOURCE = Symbol('Request source');
const protoHostPortPattern = /^(http|https)\.(.*)\.(\d+)(?:-(\d+))?$/;

const registrations = {};

function portPart(proto, port) {
  if ((proto === 'http' && String(port) === '80')
    || (proto === 'https' && String(port) === '443')) {
    return '';
  }
  return `:${port}`;
}

function mainResolver(host, url, req) {
  let finalHost = host;
  if (req.headers['x-envoy-original-path']) {
    // This request is coming from envoy, which means the service name
    // is still on the URL, so we need to strip it off, reform the
    // host header and url
    const [, api, ...restUrl] = req.url.split('/');
    req.url = `/${restUrl.join('/')}`;
    // This means all APIs must be http in dev, which is where
    // we're going (so that all comms are HTTPS in prod, and no app layer code
    // cares about it)
    req.headers.host = `http.${api}-api.8000`;
    req[SOURCE] = 'ambassador';
    finalHost = req.headers.host;
  }

  if (req && registrations[req.headers.host]) {
    return registrations[req.headers.host];
  }
  const match = finalHost.match(protoHostPortPattern);
  if (process.env.INGRESS_DOMAIN && match?.[2]?.indexOf('.') < 0) {
    return `https://${match[2]}.${process.env.INGRESS_DOMAIN}`;
  }
  if (match) {
    return `${match[1]}://${match[2]}${portPart(match[1], match[4] || match[3])}`;
  }
  return null;
}

const proxy = httpProxy.createProxyServer({ changeOrigin: true });

// Log proxy requests and clean up the headers
proxy.on('proxyReq', (p, req) => {
  try {
    const targetProto = p.connection.encrypted ? 'https' : 'http';

    // Source is passed by clients to identify the originating container
    if (req.headers) {
      req[SOURCE] = req.headers.source || req[SOURCE];
      p.removeHeader('source');

      // We mangle the host because it's the easiest way to transmit port/protocol
      // for the custom resolver, which only gets host and url. Could stick it on the
      // path too, but same diff - a plain client and a plain proxy wouldn't work.
      // So this essentially binds this proxy to our client. Maybe there's a better way...
      if (req.headers.host) {
        const match = req.headers.host.match(protoHostPortPattern);
        if (match) {
          req.headers.host = `${match[2]}${portPart(targetProto, match[4] || match[3])}`;
        }
      }
    }

    const fullUrl = `${targetProto}://${req.headers.host}${req.url}`;

    const parts = [];
    if (req.method.toLowerCase() === 'get') {
      center('>', req[SOURCE], 'requests', req.method, fullUrl);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(p.getHeaders(), null, '\t'));
    } else {
      const pt = new stream.PassThrough();
      req.pipe(pt);
      pt.on('data', d => parts.push(d));
      pt.on('end', () => {
        center('>', req[SOURCE], 'requests', req.method, fullUrl);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(p.getHeaders(), null, '\t'));
        center('>', req.headers['content-type'] || 'empty');
        if (parts.length) {
          prettyPrint(parts, req.headers);
        }
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Request logging failed', error);
  }
});

// Log the response
proxy.on('proxyRes', (p, req, res) => {
  try {
    const parts = [];
    const pt = new stream.PassThrough();
    p.pipe(pt);
    pt.on('data', d => parts.push(d));
    pt.on('end', () => {
      const targetProto = p.connection.encrypted ? 'https' : 'http';
      const fullUrl = `${targetProto}://${req.headers.host}${req.url}`;
      center('<', req[SOURCE], res.statusCode, 'response', req.method, fullUrl);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(p.headers, null, '\t'));
      if (parts.length) {
        prettyPrint(parts, p.headers);
      }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Response logging failed', error);
  }
});

// Express app handles /register only; used to parse JSON bodies inline
const app = express();

app.post('/register', express.json(), (req, res) => {
  const registered = {};
  try {
    for (const hostPattern of req.body.services) {
      const match = hostPattern.match(protoHostPortPattern);
      if (!match) {
        // eslint-disable-next-line no-console
        console.error('ERROR - bad service pattern', hostPattern);
      } else if (!req.headers.hostip) {
        // eslint-disable-next-line no-console
        console.error('ERROR - missing HostIp header');
      } else {
        const [, proto, host, publicPort, privatePort] = match;
        const ip = req.headers.hostip;
        const url = `${proto}://${ip}:${privatePort || publicPort}`;
        const registerPattern = `${proto}.${host}.${publicPort}`;
        registrations[registerPattern] = url;
        registered[registerPattern] = url;
      }
    }
    // eslint-disable-next-line no-console
    console.log('Registered services', JSON.stringify(registered, null, '\t'));
    res.json(registered);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to register service', JSON.stringify(registered, null, '\t'));
    try {
      res.sendStatus(500);
    } catch (ss) {
      // Nothing to do
    }
  }
});

// Single HTTP server: intercepts POST /register, proxies everything else
const server = http.createServer((req, res) => {
  // Route /register to the Express app
  if (req.method === 'POST' && req.url === '/register') {
    app(req, res);
    return;
  }

  const target = mainResolver(req.headers.host, req.url, req);
  if (!target) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway: no route for ' + req.headers.host);
    return;
  }

  proxy.web(req, res, { target }, (err) => {
    // eslint-disable-next-line no-console
    console.error('Proxy error', err);
    try {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    } catch (e) {
      // Response may already be partially sent
    }
  });
});

const PROXY_PORT = process.env.PROXY_PORT || 9990;
server.listen(PROXY_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`container-proxy listening on port ${PROXY_PORT}`);
  if (process.env.INGRESS_DOMAIN) {
    // eslint-disable-next-line no-console
    console.log(`Forwarding unregistered services to ${process.env.INGRESS_DOMAIN}`);
  }
});
