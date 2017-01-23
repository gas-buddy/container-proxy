import dns from 'dns';
import http from 'http';
import https from 'https';
import containerized from 'containerized';

const originalRequest = http.request;
const originalHttps = https.request;

function isContainer() {
  try {
    return containerized();
  } catch (e) {
    return false;
  }
}

export default class Proxy {
  constructor(context, config) {
    this.service = context.service;
    this.hostname = config.hostname;
    this.port = config.port || 9990;
    this.registerIn = (config.registerIn || '').split(',');
    this.proxyIn = (config.proxyIn || '').split(',');
  }

  async start(context) {
    if (!this.hostname) {
      // See if container-proxy resolves, else assume localhost
      const resolves =
        await new Promise(accept => dns.lookup('container-proxy', error => accept(!error)));
      this.hostname = resolves ? 'container-proxy' : 'localhost';
    }
    const inDocker = isContainer();
    if (this.registerIn.length === 0 || this.registerIn.includes(inDocker ? 'docker' : 'native')) {
      context.service.on('listening', async (servers) => {
        this.registerWithProxy(context, servers);
      });
    }
    if (this.proxyIn.length === 0 || this.proxyIn.includes(inDocker ? 'docker' : 'native')) {
      this.proxyRequests(context);
    }
  }

  registerWithProxy(context, servers) {
    try {
      const services = [];
      for (const s of servers) {
        if (s instanceof http.Server) {
          services.push(`http.${this.service.name}.${s.address().port}`);
        } else if (s instanceof https.Server) {
          services.push(`https.${this.service.name}.${s.address().port}`);
        }
      }
      const data = JSON.stringify({ services });
      const regReq = originalRequest.call(http, {
        path: '/register',
        host: this.hostname,
        port: this.port,
        method: 'POST',
        headers: {
          Host: 'container-proxy',
          Source: this.service.name,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      }, (res) => {
        res.on('end', () => {
          if (context.logger && context.logger.info) {
            context.logger.info('Registered with proxy', { services });
          }
        });
        res.on('error', (e) => {
          if (context.logger && context.logger.error) {
            context.logger.error('Failed to register with proxy', { error: e });
          }
        });
      });
      regReq.write(data);
      regReq.end();
    } catch (failure) {
      if (context.logger && context.logger.error) {
        context.logger.error('Failed to register with proxy', { error: failure });
      }
    }
  }

  proxyRequests(context) {
    if (context.logger && context.logger.info) {
      context.logger.info(`Global proxy configured for http://${this.hostname}:${this.port}`);
    }
    http.request = (options, callback) => {
      this.rewire(options, 'http', 80);
      return originalRequest.call(http, options, callback);
    };
    https.request = (options, callback) => {
      if (this.rewire(options, 'https', 443)) {
        return originalRequest.call(http, options, callback);
      }
      return originalHttps.call(https, callback);
    };
  }

  rewire(options, protocol, defPort) {
    if (options.host.match(/[^0-9.]/)) {
      options.headers = options.headers || {};
      options.headers.host = `${protocol}.${options.host}.${options.port || defPort}`;
      options.headers.source = this.service.name;
      options.host = this.hostname;
      options.port = this.port;
      options.protocol = 'http:';
      return true;
    }
    return false;
  }
}
