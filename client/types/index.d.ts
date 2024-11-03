export default class Proxy {
    constructor(context: any, config: any);
    service: any;
    hostname: any;
    port: any;
    doNotProxy: any;
    registerIn: any;
    proxyIn: any;
    start(context: any): Promise<void>;
    shouldNotProxy(host: any): boolean;
    registerWithProxy(context: any): Promise<void>;
    proxyRequests(context: any): void;
    rewire(options: any, protocol: any, defPort: any): boolean;
}
