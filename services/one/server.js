// SVC-INF-02 One: the Infinity-One user directory.
// Internal only. Portal calls it to check passwords and fetch claims; admins call it to
// manage users and rights. Every call needs the shared INTERNAL_TOKEN as a bearer token.
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { Store, HttpError } = require('./store');

const PORT = Number(process.env.PORT || 8043);
const DATA_DIR = process.env.DATA_DIR || '/data';
const TOKEN = process.env.INTERNAL_TOKEN || '';
const SEED = process.env.LOCATIONS_FILE || path.join(__dirname, 'locations.json');

if (TOKEN.length < 32) {
  console.error('INTERNAL_TOKEN must be set to at least 32 characters');
  process.exit(1);
}

const store = new Store(DATA_DIR, SEED);

function authorized(req) {
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://one');
  const p = url.pathname;
  const actor = String(req.headers['x-actor'] || 'internal');

  if (p === '/healthz') return send(res, 200, { ok: true, service: 'SVC-INF-02', users: store.list().length });
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'POST' && p === '/v1/verify') {
    const { email, password } = await readJson(req);
    const result = store.verify(email, password);
    store.audit(actor, result.ok ? 'login.ok' : 'login.fail', { email: String(email || '').toLowerCase(), reason: result.reason });
    return send(res, 200, result);
  }
  if (req.method === 'GET' && p === '/v1/locations') return send(res, 200, store.locations());
  if (req.method === 'GET' && p === '/v1/users') return send(res, 200, store.list());
  if (req.method === 'POST' && p === '/v1/users') return send(res, 201, store.createUser(await readJson(req), actor));

  const m = p.match(/^\/v1\/users\/([A-Za-z0-9-]+)(\/claims|\/rights)?$/);
  if (m) {
    const [, id, sub] = m;
    if (req.method === 'GET' && !sub) {
      const u = store.get(id);
      return u ? send(res, 200, store.list().find((x) => x.id === id)) : send(res, 404, { error: 'user not found' });
    }
    if (req.method === 'GET' && sub === '/claims') {
      const c = store.claims(id);
      return c ? send(res, 200, c) : send(res, 404, { error: 'user not found' });
    }
    if (req.method === 'PATCH' && !sub) return send(res, 200, store.updateUser(id, await readJson(req), actor));
    if (req.method === 'PUT' && sub === '/rights') return send(res, 200, store.setRights(id, await readJson(req), actor));
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'internal error' : err.message });
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`SVC-INF-02 One listening on :${PORT}`));
}

module.exports = { server, store };
