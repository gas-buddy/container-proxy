import zlib from 'zlib';
import pretty from 'pretty-data';
import window from 'window-size';

export function center(char, ...args) {
  let sz = 1; // space before the start of the first
  for (const a of args) {
    if (a) {
      sz += a.toString().length + 1;
    } else {
      sz += 1;
    }
  }

  const w = (window && window.width) ? window.width : 120;
  if (sz <= 2) {
    // eslint-disable-next-line no-console
    console.log(Array(w).join(char));
    return;
  }

  let left;
  let right;
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

export function prettyPrint(bufArr, headers) {
  if (bufArr) {
    let final = Buffer.concat(bufArr);
    if (final.length > 2 && (final[0] === 0x1f && final[1] === 0x8b)) {
      final = zlib.unzipSync(final).toString('utf8');
    } else {
      final = final.toString('utf8');
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
        console.log(pretty.pd.json(final));
      } else if (ct.startsWith('application/xml') || ct.startsWith('text/xml')) {
        // eslint-disable-next-line no-console
        console.log(pretty.pd.xml(final));
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
