container-proxy
===============

[![Greenkeeper badge](https://badges.greenkeeper.io/gas-buddy/container-proxy.svg)](https://greenkeeper.io/)

GasBuddy has a microservice architecture based on Docker, node.js and Swagger. As such, we have a large number of services that talk to each other over
http/https as well as talk to core services like Postgres, etcd, redis, rabbitmq, etc. For public facing APIs, we use Kong to do authentication
and client identification. Development in a system like this can be a challenge for a host of reasons:

1. Platform differences (this should probably be 1-99) - while node isolates a number of differences, services like postgres or rabbitmq can be a challenge to get configured in various cases. Docker provides excellent isolation for these components.
2. DNS - all these services need to discover each other and sometimes you may be developing against multiple services at the same time. Some may be local to your machine, some may be on a shared team. Docker has its own DNS infra that lets containers find each other (or can, especially with docker-compose), but that doesn't extend to processes running natively, in either direction.
3. Tracing and Logging - it can be very useful to see the traffic back and forth in a central place. Logstash is a piece of that, but sometimes it's easier to see network requests formatted and pretty printed in once place.

container-proxy is a node.js HTTP/S proxy with some custom dynamic registration behavior. The container-proxy-client module runs in each service (in development only) and registers the service with container-proxy and then sends all outbound network requests through it. It does this by (gasp) monkey patching http.request and https.request and modifying the headers to tell container-proxy what to do. Since redbird (the node proxy module we use) only passes the host to the function that is in charge of finding the destination, we encode three things in the "fake" host header - the protocol, the host and the port. So a request to https://my-serv:8443/foobar would end up with a host header of https.my-serv.8443 when it arrives at container-proxy.

container-proxy-client also does another piece of trickery - since you may be running multiple services on a single host (i.e. your native OS), they can't share port 8000 or 8443 or whatever. But, our service infrastructure assumes (in absence of explicit config) that http services are on 8000 and https services are on 8443. So foo-serv might be configured to talk to my-serv at https://my-serv:8443, but container-proxy-client may need to put it on 8444 instead. Therefore the container-proxy-client embedded in my-serv tells the container-proxy that "when someone asks for my-serv:8443, send them to <my ip>:8444." Note that the IP address used for this connection is typically the NATIVE subnet address for the machine, because the source address of the request to container-proxy is not useful when connecting FROM docker back to native.