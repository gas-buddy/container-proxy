import os from 'os';
import url from 'url';
import http from 'http';
import https from 'https';

const originalRequest = http.request;
const originalHttps = https.request;

export default class Proxy {
  constructor(context, config) {
    this.name = context.service ? context.service.name : os.hostname();
    this.hostname = config.hostname || 'container-proxy';
    this.port = config.port || 9990;
  }

  start(context) {
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
      options.headers.source = this.name;
      options.host = this.hostname;
      options.port = this.port;
      options.protocol = 'http:';
      return true;
    }
    return false;
  }
}
