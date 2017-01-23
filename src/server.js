import stream from 'stream';
import redbird from 'redbird';
import express from 'express';
import bodyParser from 'body-parser';
import { center, prettyPrint } from './print';

const SOURCE = Symbol('Request source');
const protoHostPortPattern = /^(http|https)\.(.*)\.(\d+)(?:-(\d+))?$/;

const app = express();
app.use(bodyParser.json());

const registrations = {};

function mainResolver(host) {
  if (registrations[host]) {
    return registrations[host];
  }
  const match = host.match(protoHostPortPattern);
  if (match) {
    const final = `${match[1]}://${match[2]}:${match[4] || match[3]}`;
    return final;
  }
  return null;
}

mainResolver.priority = -1;

// Setup the redbird proxy over http
const proxy = redbird({
  port: process.env.PROXY_PORT || 9990,
  secure: false,
  resolvers: [mainResolver],
  bunyan: false,
});

// Log proxy requests and clean up the headers
proxy.proxy.on('proxyReq', (p, req) => {
  try {
    // Source is passed by clients to identify the originating container
    if (req.headers) {
      req[SOURCE] = req.headers.source;
      delete req.headers.source;
      delete req.headers['x-forwarded-for'];
      delete req.headers['x-forwarded-port'];
      delete req.headers['x-forwarded-proto'];
      delete req.headers['x-forwarded-host'];

      // We mangle the host because it's the easiest way to transmit port/protocol
      // for the custom resolver, which only gets host and url. Could stick it on the
      // path too, but same diff - a plain client and a plain proxy wouldn't work.
      // So this essentially binds this proxy to our client. Maybe there's a better way...
      if (req.headers.host) {
        const match = req.headers.host.match(protoHostPortPattern);
        if (match) {
          req.headers.host = `${match[2]}:${match[4] || match[3]}`;
        }
      }
    }

    const targetProto = p.connection.encrypted ? 'https' : 'http';
    const fullUrl = `${targetProto}://${req.headers.host}${req.url}`;

    const parts = [];
    if (req.method.toLowerCase() === 'get') {
      center('>', req[SOURCE], 'requests', req.method, fullUrl);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(req.headers, null, '\t'));
    } else {
      const pt = new stream.PassThrough();
      req.pipe(pt);
      pt.on('data', d => parts.push(d));
      pt.on('end', () => {
        center('>', req[SOURCE], 'requests', req.method, fullUrl);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(req.headers, null, '\t'));
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
  for (const hostPattern of req.body.services) {
    const match = hostPattern.match(protoHostPortPattern);
    if (!match) {
      // eslint-disable-next-line no-console
      console.error('ERROR - bad service pattern', hostPattern);
    } else {
      const [, proto, host, publicPort, privatePort] = match;
      const ip = req.headers.hostip || `[${req.headers['x-forwarded-for']}]`;
      const url = `${proto}://${ip}:${privatePort || publicPort}`;
      const registerPattern = `${proto}.${host}.${publicPort}`;
      registrations[registerPattern] = registered[registerPattern] = url;
    }
  }
  // eslint-disable-next-line no-console
  console.log('Registered services', JSON.stringify(registered, null, '\t'));
  res.json(registered);
});

const server = app.listen(0, () => { });

proxy.register('container-proxy', `http://localhost:${server.address().port}`);

