import os from 'os';
import dns from 'dns';
import http from 'http';
import https from 'https';
import isDocker from 'is-docker';
import portFinder from './portFinder';

const originalRequest = http.request;
const originalHttps = https.request;

function isContainer() {
  try {
    return isDocker();
  } catch (e) {
    return false;
  }
}

function hostIp() {
  if (process.env.CONTAINER_TO_HOST_IP) {
    return process.env.CONTAINER_TO_HOST_IP;
  }
  if (os.platform() === 'darwin') {
    return 'docker.for.mac.localhost';
  }
  if (os.platform() === 'win32') {
    return 'docker.for.win.localhost';
  }
  for (const [, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces) {
      // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
      if (iface.family === 'IPv4' && iface.internal === false) {
        return iface.address;
      }
    }
  }
  throw new Error('No suitable interface found');
}

function checkMatch(host, item) {
  if (item instanceof RegExp) {
    return item.test(host);
  }
  if (typeof item === 'function') {
    return item(host);
  }
  return item.toString().toLowerCase() === host;
}

export default class Proxy {
  constructor(context, config) {
    this.service = context.service;
    this.hostname = config.hostname;
    this.port = config.port || 9990;
    this.doNotProxy = config.doNotProxy || {};
    this.registerIn = config.registerIn ? config.registerIn.split(',') : null;
    this.proxyIn = config.proxyIn ? config.proxyIn.split(',') : null;
  }

  async start(context) {
    if (!this.hostname) {
      // See if container-proxy resolves, else assume localhost
      const resolves = await new Promise(accept => dns
        .lookup('container-proxy', error => accept(!error)));
      this.hostname = resolves ? 'container-proxy' : 'localhost';
    }
    const inDocker = isContainer();
    if (!this.registerIn || this.registerIn.includes(inDocker ? 'docker' : 'native')) {
      await this.registerWithProxy(context);
    }
    if (!this.proxyIn || this.proxyIn.includes(inDocker ? 'docker' : 'native')) {
      this.proxyRequests(context);
    }
  }

  shouldNotProxy(host) {
    if (!host) {
      return false;
    }
    // Because this is intended to be used with confit, it's generally
    // a better idea for doNotProxy to be an object. But if you pass us
    // an array, we can handle it.
    if (Array.isArray(this.doNotProxy)) {
      for (const a of this.doNotProxy) {
        if (checkMatch(host, a)) {
          return true;
        }
      }
    } else if (this.doNotProxy) {
      for (const [, pattern] of Object.entries(this.doNotProxy)) {
        if (checkMatch(host, pattern)) {
          return true;
        }
      }
    }
    return false;
  }

  async registerWithProxy(context) {
    try {
      // If no port is explicitly set, defaults are used. BUT, this
      // means you can't run more than one service on the box.
      // SO, we will muck with the config to assign a random port
      // (blah, I know).
      const tlsInfo = this.service.config.get('tls');
      const httpPort = this.service.config.get('port');
      const services = [];
      if (tlsInfo) {
        if (tlsInfo.port) {
          services.push(`https.${this.service.name}.${tlsInfo.port}`);
        } else {
          const tlsPort = await portFinder(8444);
          context.logger.info('https server will listen on', tlsPort);
          this.service.config.set('tls:port', tlsPort);
          services.push(`https.${this.service.name}.8443-${tlsPort}`);
        }
      }
      if (!tlsInfo || httpPort === 0 || httpPort) {
        if (!httpPort) {
          // If 0 or not set, we need to come up with the port here
          const finalPort = await portFinder(8002);
          context.logger.info('http server will listen on', finalPort);
          this.service.config.set('port', finalPort);
          services.push(`http.${this.service.name}.8000-${finalPort}`);
        } else {
          services.push(`http.${this.service.name}.${httpPort}`);
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
          HostIp: hostIp(),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      }, (res) => {
        res.on('end', () => {
          context.logger.info('Registered with proxy', { services });
        });
        res.on('error', (e) => {
          context.logger.error('Failed to register with proxy', { error: e });
        });
      });
      regReq.write(data);
      regReq.end();
    } catch (failure) {
      context.logger.error('Failed to register with proxy', { error: failure });
    }
  }

  proxyRequests(context) {
    context.logger.info(`Global proxy configured for http://${this.hostname}:${this.port}`);
    http.request = (options, callback) => {
      this.rewire(options, 'http', 80);
      return originalRequest.call(http, options, callback);
    };
    https.request = (options, callback) => {
      if (this.rewire(options, 'https', 443)) {
        return originalRequest.call(http, options, callback);
      }
      return originalHttps.call(https, options, callback);
    };
  }

  rewire(options, protocol, defPort) {
    // Seems that some folks do it this way (Dwolla)
    if (!options.host && options.hostname) {
      options.host = options.hostname;
      delete options.hostname;
    } else if (!options.host && !options.hostname) {
      return false;
    } else if (this.shouldNotProxy(options.host || options.hostname)) {
      return false;
    }
    if (options.host.match(/[^0-9.]/)) {
      options.headers = options.headers || {};
      options.headers.host = `${protocol}.${options.hostname || options.host}.${options.port || defPort}`;
      options.headers.source = this.service.name;
      options.host = this.hostname;
      if (options.hostname) {
        options.hostname = this.hostname;
      }
      if (options.href) {
        options.href = `http://${this.hostname}:${this.port}${options.path}${options.search || ''}`;
      }
      options.port = this.port;
      options.protocol = 'http:';
      return true;
    }
    return false;
  }
}
