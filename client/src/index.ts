import os from 'os';
import fs from 'fs';
import dns from 'dns';
import http from 'http';
import https from 'https';
import findPort from './portFinder';

let _isDocker: boolean | undefined;

/** Reset the cached isContainer result — used by tests only. */
export function resetIsContainerCache(): void {
  _isDocker = undefined;
}

export function isContainer(): boolean {
  if (_isDocker !== undefined) return _isDocker;
  try {
    fs.statSync('/.dockerenv');
    _isDocker = true;
    return true;
  } catch {
    // not definitive, check cgroup
  }
  try {
    _isDocker = fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
  } catch {
    _isDocker = false;
  }
  return _isDocker;
}

const originalRequest = http.request.bind(http) as typeof http.request;
const originalHttps = https.request.bind(https) as typeof https.request;

export interface ProxyContext {
  logger: {
    info(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };
  service: {
    name: string;
    config: {
      get(key: string): unknown;
      set(key: string, value: unknown): void;
    };
  };
}

export interface ProxyClientConfig {
  hostname?: string;
  port?: number;
  doNotProxy?: Record<string, unknown> | Array<unknown>;
  registerIn?: string;
  proxyIn?: string;
}

function hostIp(): string {
  if (process.env.CONTAINER_TO_HOST_IP) {
    return process.env.CONTAINER_TO_HOST_IP;
  }
  if (os.platform() === 'darwin' || os.platform() === 'win32') {
    return 'host.docker.internal';
  }
  // Linux: find first non-internal IPv4
  for (const [, ifaces] of Object.entries(os.networkInterfaces())) {
    if (ifaces) {
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  }
  throw new Error('No suitable interface found');
}

function checkMatch(host: string, item: unknown): boolean {
  if (item instanceof RegExp) {
    return item.test(host);
  }
  if (typeof item === 'function') {
    return (item as (h: string) => boolean)(host);
  }
  return String(item).toLowerCase() === host;
}

export interface RegisterServiceOptions {
  /** Service name (e.g. 'identity-serv') */
  name: string;
  /** Port this service is actually listening on */
  port: number;
  /** Proxy URL, default 'http://127.0.0.1:9990' */
  proxyUrl?: string;
  /** Protocol, default 'http' */
  protocol?: 'http' | 'https';
  /** Public port (what other services call), default 8000 for http, 8443 for https */
  publicPort?: number;
}

export async function registerService(options: RegisterServiceOptions): Promise<void> {
  const {
    name,
    port,
    proxyUrl = 'http://127.0.0.1:9990',
    protocol = 'http',
    publicPort = protocol === 'https' ? 8443 : 8000,
  } = options;

  const serviceString = port === publicPort
    ? `${protocol}.${name}.${publicPort}`
    : `${protocol}.${name}.${publicPort}-${port}`;

  const data = JSON.stringify({ services: [serviceString] });
  const proxyUrlParsed = new URL(proxyUrl);

  return new Promise<void>((resolve, reject) => {
    const req = originalRequest({
      hostname: proxyUrlParsed.hostname,
      port: proxyUrlParsed.port || 9990,
      path: '/register',
      method: 'POST',
      headers: {
        Host: 'container-proxy',
        HostIp: hostIp(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      res.resume(); // Drain response so 'end' fires
      res.on('end', () => resolve());
      res.on('error', (err) => reject(err));
    });

    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

export default class Proxy {
  private service: ProxyContext['service'];
  private hostname: string | undefined;
  private port: number;
  private doNotProxy: Record<string, unknown> | Array<unknown>;
  private registerIn: string[] | null;
  private proxyIn: string[] | null;

  constructor(context: ProxyContext, config: ProxyClientConfig) {
    this.service = context.service;
    this.hostname = config.hostname;
    this.port = config.port ?? 9990;
    this.doNotProxy = config.doNotProxy ?? {};
    this.registerIn = config.registerIn ? config.registerIn.split(',') : null;
    this.proxyIn = config.proxyIn ? config.proxyIn.split(',') : null;
  }

  async start(context: ProxyContext): Promise<void> {
    if (!this.hostname) {
      // See if container-proxy resolves, else assume 127.0.0.1
      // (127.0.0.1 instead of localhost for Rancher Desktop compat)
      const resolves = await new Promise<boolean>(accept => dns
        .lookup('container-proxy', error => accept(!error)));
      this.hostname = resolves ? 'container-proxy' : '127.0.0.1';
    }
    const inDocker = isContainer();
    if (!this.registerIn || this.registerIn.includes(inDocker ? 'docker' : 'native')) {
      await this.registerWithProxy(context);
    }
    if (!this.proxyIn || this.proxyIn.includes(inDocker ? 'docker' : 'native')) {
      this.proxyRequests(context);
    }
  }

  shouldNotProxy(host: string): boolean {
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

  async registerWithProxy(context: ProxyContext): Promise<void> {
    try {
      // If no port is explicitly set, defaults are used. BUT, this
      // means you can't run more than one service on the box.
      // SO, we will muck with the config to assign a random port
      // (blah, I know).
      const tlsInfo = this.service.config.get('tls');
      const httpPort = this.service.config.get('port');
      const services: string[] = [];
      if (tlsInfo) {
        if ((tlsInfo as Record<string, unknown>).port) {
          services.push(`https.${this.service.name}.${(tlsInfo as Record<string, unknown>).port}`);
        } else {
          const tlsPort = await findPort(8444);
          context.logger.info('https server will listen on', tlsPort);
          this.service.config.set('tls:port', tlsPort);
          services.push(`https.${this.service.name}.8443-${tlsPort}`);
        }
      }
      if (!tlsInfo || httpPort === 0 || httpPort) {
        if (!httpPort) {
          // If 0 or not set, we need to come up with the port here
          const finalPort = await findPort(8002);
          context.logger.info('http server will listen on', finalPort);
          this.service.config.set('port', finalPort);
          services.push(`http.${this.service.name}.8000-${finalPort}`);
        } else {
          services.push(`http.${this.service.name}.${httpPort}`);
        }
      }

      const data = JSON.stringify({ services });
      const regReq = originalRequest({
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
        // Drain the response stream so 'end' fires and the socket is freed.
        res.resume();
        res.on('end', () => {
          context.logger.info('Registered with proxy', { services });
        });
        res.on('error', (e: Error) => {
          context.logger.error('Failed to register with proxy', { error: e });
        });
      });
      regReq.write(data);
      regReq.end();
    } catch (failure) {
      context.logger.error('Failed to register with proxy', { error: failure });
    }
  }

  proxyRequests(context: ProxyContext): void {
    context.logger.info(`Global proxy configured for http://${this.hostname}:${this.port}`);
    // options is typed as `any` because Node's http.request accepts a wide variety
    // of overloaded call signatures (string | URL | RequestOptions) and callers
    // may pass additional non-standard fields (e.g. href, search).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    http.request = (options: any, callback?: any) => {
      this.rewire(options, 'http', 80);
      return originalRequest(options, callback);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    https.request = (options: any, callback?: any) => {
      if (this.rewire(options, 'https', 443)) {
        return originalRequest(options, callback);
      }
      return originalHttps(options, callback);
    };
  }

  // options is typed as `any` because http.request options come in many forms
  // (string, URL, RequestOptions) and this method mutates them in-place.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rewire(options: any, protocol: string, defPort: number): boolean {
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
