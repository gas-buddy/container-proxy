import { unzipSync } from 'zlib';
import type { IncomingHttpHeaders } from 'http';

export function center(char: string, ...args: unknown[]): void {
  let sz = 1; // space before the start of the first
  args.forEach((a) => {
    if (a) {
      sz += a.toString().length + 1;
    } else {
      sz += 1;
    }
  });

  const w = process.stdout.columns ?? 120;
  if (sz <= 2) {
    // eslint-disable-next-line no-console
    console.log(Array(w).join(char));
    return;
  }

  let left: string;
  let right: string;
  if (sz > w) {
    left = '=';
    right = '=';
  } else {
    const leftSet = Math.ceil((w - sz) / 2);
    left = Array(1 + leftSet).join(char);
    right = Array(1 + (w - leftSet - sz)).join(char);
  }
  // eslint-disable-next-line no-console
  console.log(`${left} ${args.join(' ')} ${right}`);
}

export function prettyPrint(bufArr: Buffer[], headers?: IncomingHttpHeaders): void {
  if (bufArr) {
    let final: string;
    const raw = Buffer.concat(bufArr);
    if (raw.length > 2 && (raw[0] === 0x1f && raw[1] === 0x8b)) {
      final = unzipSync(raw).toString('utf8');
    } else {
      final = raw.toString('utf8');
    }
    if (!headers || !headers['content-type']) {
      // eslint-disable-next-line no-console
      console.log(final);
      return;
    }
    try {
      const ct = headers['content-type'];
      if (ct.startsWith('application/json') || ct.startsWith('text/json')) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(JSON.parse(final), null, 2));
      } else if (ct.startsWith('application/xml') || ct.startsWith('text/xml')) {
        // eslint-disable-next-line no-console
        console.log(final);
      } else {
        // eslint-disable-next-line no-console
        console.log(final);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(final);
    }
  }
}
