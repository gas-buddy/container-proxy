import redbird from 'redbird';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

const registrations = {};

const proxy = redbird({
  port: 9990,
  secure: false,
  resolvers: [(host, url) => {
  }],
});

redbird.docker(proxy);

proxy.proxy.on('end', (req, res, response) => {
  console.log(req.method, req.url);
  console.log(req.headers);
  console.error(response.headers);
  console.error(Object.getOwnPropertyNames(req));
  console.error(Object.getOwnPropertyNames(res));
  console.error(Object.getOwnPropertyNames(response));
});

app.post('/register', (req, res) => {
  const url = `${req.body.protocol}://[${req.headers['x-forwarded-for']}]:${req.body.port}`;
  proxy.register(req.body.host, url);
  res.json({ url });
});

const server = app.listen(0, () => { });

proxy.register('container-proxy', `http://localhost:${server.address().port}`);

