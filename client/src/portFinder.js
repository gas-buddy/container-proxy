import net from 'net';

// Inspired by https://github.com/kessler/find-port/blob/master/lib/findPort.js
async function isAvailable(port) {
  return await new Promise((accept, reject) => {
    const server = net.createServer().listen(port);

    const timeoutRef = setTimeout(() => {
      accept(false);
    }, 2000);

    timeoutRef.unref();

    server.once('listening', () => {
      clearTimeout(timeoutRef);
      server.close();
      accept(true);
    });
    server.once('error', (err) => {
      clearTimeout(timeoutRef);

      if (err.code === 'EADDRINUSE') {
        accept(false);
        return;
      }

      reject(err);
    });
  });
}

export default async function findPort(start) {
  for (let p = start; p < start + 1000; p += 1) {
    if (await isAvailable(p)) {
      return p;
    }
  }
  return null;
}