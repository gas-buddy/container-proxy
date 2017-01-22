import http from 'http';
import https from 'https';

function monkeyPatch(module, functionName, newFunction) {
  module[functionName] = newFunction.bind(undefined, module[functionName]);
}

export default class Proxy {
  constructor(context, config) {

  }

  start(context) {
    monkeyPatch(http, 'request', function (originalRequest, options, callback) {
      console.error(options);
      return originalRequest(options, callback);
    });
  }

  stop(context) {

  }
}