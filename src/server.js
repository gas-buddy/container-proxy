import stream from 'stream';
import redbird from 'redbird';
import tls from 'tls';
import express from 'express';
import bodyParser from 'body-parser';
import { center, prettyPrint } from './print';

// Until https://github.com/nodejs/node/issues/16196 rolls into node...
tls.DEFAULT_ECDH_CURVE = 'auto';

const SOURCE = Symbol('Request source');
const protoHostPortPattern = /^(http|https)\.(.*)\.(\d+)(?:-(\d+))?$/;

const app = express();
app.use(bodyParser.json());

const registrations = {};

function portPart(proto, port) {
  if ((proto === 'http' && String(port) === '80') ||
    (proto === 'https' && String(port) === '443')) {
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
  if (process.env.INGRESS_DOMAIN && match[2].indexOf('.') < 0) {
    return `https://${match[2]}.${process.env.INGRESS_DOMAIN}`;
  }
  if (match) {
    return `${match[1]}://${match[2]}${portPart(match[1], match[4] || match[3])}`;
  }
  return null;
}

mainResolver.priority = -1;

// Setup the redbird proxy over http
const proxy = redbird({
  port: process.env.PROXY_PORT || 9990,
  secure: false,
  resolvers: [mainResolver],
  xfwd: false,
  bunyan: false,
});

// Otherwise the outbound host headers get messed up
proxy.proxy.options.changeOrigin = true;

// Log proxy requests and clean up the headers
proxy.proxy.on('proxyReq', (p, req) => {
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
      // eslint-disable-next-line no-console, no-underscore-dangle
      console.log(JSON.stringify(p._headers, null, '\t'));
    } else {
      const pt = new stream.PassThrough();
      req.pipe(pt);
      pt.on('data', d => parts.push(d));
      pt.on('end', () => {
        center('>', req[SOURCE], 'requests', req.method, fullUrl);
        // eslint-disable-next-line no-console, no-underscore-dangle
        console.log(JSON.stringify(p._headers, null, '\t'));
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
proxy.proxy.on('proxyRes', (p, req, res) => {
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

app.post('/register', (req, res) => {
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

const server = app.listen(0, () => { });
if (process.env.INGRESS_DOMAIN) {
  console.log(`Forwarding unregistered services to ${process.env.INGRESS_DOMAIN}`);
}
proxy.register('container-proxy', `http://localhost:${server.address().port}`);

