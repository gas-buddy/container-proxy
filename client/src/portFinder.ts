import net from 'net';

// Inspired by https://github.com/kessler/find-port/blob/master/lib/findPort.js
function isAvailable(port: number): Promise<boolean> {
  return new Promise((accept, reject) => {
    const server: net.Server = net.createServer().listen(port);

    const timeoutRef = setTimeout(() => {
      accept(false);
    }, 2000);

    timeoutRef.unref();

    server.once('listening', () => {
      clearTimeout(timeoutRef);
      server.close();
      accept(true);
    });
    server.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeoutRef);

      if (err.code === 'EADDRINUSE') {
        accept(false);
        return;
      }

      reject(err);
    });
  });
}

export default async function findPort(start: number): Promise<number | null> {
  for (let p = start; p < start + 1000; p += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isAvailable(p)) {
      return p;
    }
  }
  return null;
}
