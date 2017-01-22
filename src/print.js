import pretty from 'pretty-data';
import window from 'window-size';

export function center(...args) {
  let sz = 1; // space before the start of the first
  for (const a of args) {
    if (a) {
      sz += a.toString().length + 1;
    }
  }

  if (sz === 1) {
    console.log(Array(window.width).join('='));
    return;
  }

  let fins;
  if (sz > window.width) {
    fins = '=';
  } else {
    fins = Array(Math.floor((window.width - sz) / 2)).join('=');
  }
  console.log(`${fins} ${args.join(' ')} ${fins}`);
}

export function prettyPrint(bufArr, headers) {
  if (bufArr) {
    const final = Buffer.concat(bufArr).toString('utf8');
    if (!headers || !headers['content-type']) {
      console.log(final);
      return;
    }
    const ct = headers['content-type'];
    if (ct.startsWith('application/json') || ct.startsWith('text/json')) {
      console.log(pretty.pd.json(final));
    } else if (ct.startsWith('application/xml')) {
      console.log(pretty.pd.xml(final));
    } else {
      console.log(final);
    }
  }
}
