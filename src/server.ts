import http from 'http';
import stream from 'stream';
import httpProxy from 'http-proxy';
import express from 'express';
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { center, prettyPrint } from './print';

// Exported interfaces
export interface ProxyConfig {
  port?: number | string;
  ingressDomain?: string;
}

export interface Registration {
  [hostPattern: string]: string;
}

const SOURCE = Symbol('Request source');
const protoHostPortPattern = /^(http|https)\.(.*)\.(\d+)(?:-(\d+))?$/;

// Extend IncomingMessage to carry our SOURCE symbol
export interface AnnotatedRequest extends IncomingMessage {
  [SOURCE]?: string;
}

export const registrations: Record<string, string> = {};

function portPart(proto: string, port: string | number): string {
  if (
    (proto === 'http' && String(port) === '80') ||
    (proto === 'https' && String(port) === '443')
  ) {
    return '';
  }
  return `:${port}`;
}

export function mainResolver(
  host: string | undefined,
  url: string | undefined,
  req: AnnotatedRequest,
): string | null {
  let finalHost = host ?? '';
  if (req.headers['x-envoy-original-path']) {
    // This request is coming from envoy, which means the service name
    // is still on the URL, so we need to strip it off, reform the
    // host header and url
    const [, api, ...restUrl] = (req.url ?? '').split('/');
    req.url = `/${restUrl.join('/')}`;
    // This means all APIs must be http in dev, which is where
    // we're going (so that all comms are HTTPS in prod, and no app layer code
    // cares about it)
    req.headers.host = `http.${api}-api.8000`;
    req[SOURCE] = 'ambassador';
    finalHost = req.headers.host;
  }

  if (registrations[req.headers.host ?? '']) {
    return registrations[req.headers.host ?? ''];
  }
  const match = finalHost.match(protoHostPortPattern);
  if (process.env.INGRESS_DOMAIN && match?.[2] && match[2].indexOf('.') < 0) {
    return `https://${match[2]}.${process.env.INGRESS_DOMAIN}`;
  }
  if (match) {
    return `${match[1]}://${match[2]}${portPart(match[1], match[4] ?? match[3])}`;
  }
  return null;
}

const proxy = httpProxy.createProxyServer({ changeOrigin: true });

// Log proxy requests and clean up the headers
proxy.on('proxyReq', (p, req) => {
  const annotatedReq = req as AnnotatedRequest;
  try {
    // http-proxy does not expose `connection` in its types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, max-len
    const targetProto = (p as any).connection?.encrypted ? 'https' : 'http'; // eslint-disable-line max-len

    // Source is passed by clients to identify the originating container
    if (annotatedReq.headers) {
      const srcHeader = annotatedReq.headers.source as string | undefined;
      annotatedReq[SOURCE] = srcHeader ?? annotatedReq[SOURCE];
      p.removeHeader('source');

      // We mangle the host because it's the easiest way to transmit port/protocol
      // for the custom resolver, which only gets host and url. Could stick it on the
      // path too, but same diff - a plain client and a plain proxy wouldn't work.
      // So this essentially binds this proxy to our client. Maybe there's a better way...
      if (annotatedReq.headers.host) {
        const match = annotatedReq.headers.host.match(protoHostPortPattern);
        if (match) {
          annotatedReq.headers.host = `${match[2]}${portPart(targetProto, match[4] ?? match[3])}`;
        }
      }
    }

    const fullUrl = `${targetProto}://${annotatedReq.headers.host}${annotatedReq.url}`;

    const parts: Buffer[] = [];
    if (annotatedReq.method?.toLowerCase() === 'get') {
      center('>', annotatedReq[SOURCE], 'requests', annotatedReq.method, fullUrl);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(p.getHeaders(), null, '\t'));
    } else {
      const pt = new stream.PassThrough();
      annotatedReq.pipe(pt);
      pt.on('data', (d: Buffer) => parts.push(d));
      pt.on('end', () => {
        center('>', annotatedReq[SOURCE], 'requests', annotatedReq.method, fullUrl);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(p.getHeaders(), null, '\t'));
        center('>', annotatedReq.headers['content-type'] ?? 'empty');
        if (parts.length) {
          prettyPrint(parts, annotatedReq.headers);
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
  const annotatedReq = req as AnnotatedRequest;
  try {
    const parts: Buffer[] = [];
    const pt = new stream.PassThrough();
    p.pipe(pt);
    pt.on('data', (d: Buffer) => parts.push(d));
    pt.on('end', () => {
      // http-proxy does not expose `connection` in its types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, max-len
      const targetProto = (p as any).connection?.encrypted ? 'https' : 'http';
      const fullUrl = `${targetProto}://${annotatedReq.headers.host}${annotatedReq.url}`;
      const httpRes = res as ServerResponse;
      center(
        '<',
        annotatedReq[SOURCE],
        httpRes.statusCode,
        'response',
        annotatedReq.method,
        fullUrl,
      );
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
export const app = express();

app.post('/register', express.json(), (req: Request, res: Response) => {
  const registered: Record<string, string> = {};
  try {
    (req.body as { services: string[] }).services.forEach((hostPattern) => {
      const match = hostPattern.match(protoHostPortPattern);
      if (!match) {
        // eslint-disable-next-line no-console
        console.error('ERROR - bad service pattern', hostPattern);
      } else if (!req.headers.hostip) {
        // eslint-disable-next-line no-console
        console.error('ERROR - missing HostIp header');
      } else {
        const [, proto, host, publicPort, privatePort] = match;
        const ip = req.headers.hostip as string;
        const url = `${proto}://${ip}:${privatePort ?? publicPort}`;
        const registerPattern = `${proto}.${host}.${publicPort}`;
        registrations[registerPattern] = url;
        registered[registerPattern] = url;
      }
    });
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
const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  // Route /register to the Express app
  if (req.method === 'POST' && req.url === '/register') {
    app(req as Request, res as Response);
    return;
  }

  const target = mainResolver(req.headers.host, req.url, req as AnnotatedRequest);
  if (!target) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Bad Gateway: no route for ${req.headers.host}`);
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

const PROXY_PORT = process.env.PROXY_PORT ?? 9990;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PROXY_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`container-proxy listening on port ${PROXY_PORT}`);
    if (process.env.INGRESS_DOMAIN) {
      // eslint-disable-next-line no-console
      console.log(`Forwarding unregistered services to ${process.env.INGRESS_DOMAIN}`);
    }
  });
}
