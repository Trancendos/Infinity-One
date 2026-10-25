// SVC-INF-04 Gate: the Infinity navigator.
// Gate is an ordinary OpenID Connect client of Infinity-One (Hydra). After sign-in it shows each
// person the Locations they have rights to, and at what level. Management Center appears only
// for Admins, matching the rule that MC accepts Admin only.
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { page, esc } = require('./ui');

const PORT = Number(process.env.PORT || 8046);
const ISSUER = (process.env.HYDRA_PUBLIC_URL || 'https://auth.trancendos.com').replace(/\/$/, '');
const HYDRA_INTERNAL = (process.env.HYDRA_INTERNAL_URL || 'http://hydra:4444').replace(/\/$/, '');
const ONE_URL = (process.env.ONE_URL || 'http://one:8043').replace(/\/$/, '');
const TOKEN = process.env.INTERNAL_TOKEN || '';
const CLIENT_ID = process.env.GATE_CLIENT_ID || 'infinity-gate';
const CLIENT_SECRET = process.env.GATE_CLIENT_SECRET || '';
const SELF = (process.env.GATE_PUBLIC_URL || 'https://gate.trancendos.com').replace(/\/$/, '');
const SESSION_SECRET = process.env.GATE_SESSION_SECRET || '';
const SECURE_COOKIES = process.env.COOKIE_SECURE !== 'false';
const SESSION_HOURS = Number(process.env.GATE_SESSION_HOURS || 8);
const LEVELS = ['none', 'viewer', 'user', 'admin'];

for (const [k, v] of Object.entries({ INTERNAL_TOKEN: TOKEN, GATE_SESSION_SECRET: SESSION_SECRET, GATE_CLIENT_SECRET: CLIENT_SECRET })) {
  if (v.length < 32) { console.error(`${k} must be set to at least 32 characters`); process.exit(1); }
}

// ---- signed cookies --------------------------------------------------------

function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(value) {
  if (!value) return null;
  const [body, mac] = String(value).split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (obj.exp && obj.exp < Date.now() / 1000) return null;
  return obj;
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIES ? '; Secure' : ''}`;
}

// ---- OIDC -----------------------------------------------------------------

let discovery = null;
let jwks = { at: 0, keys: [] };

// Hydra is reached on the internal network; it must be told the outside hop was HTTPS.
async function hydraFetch(url, opts = {}) {
  const internal = url.replace(ISSUER, HYDRA_INTERNAL);
  return fetch(internal, { ...opts, headers: { ...(opts.headers || {}), 'x-forwarded-proto': 'https' } });
}

async function getDiscovery() {
  if (discovery) return discovery;
  const r = await hydraFetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`discovery failed: ${r.status}`);
  discovery = await r.json();
  return discovery;
}

async function getKey(kid) {
  if (Date.now() - jwks.at > 10 * 60 * 1000 || !jwks.keys.some((k) => k.kid === kid)) {
    const d = await getDiscovery();
    const r = await hydraFetch(d.jwks_uri);
    jwks = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) throw new Error('signing key not found');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

async function verifyIdToken(idToken, nonce) {
  const [h, p, s] = idToken.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);
  const key = await getKey(header.kid);
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('bad id_token signature');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Date.now() / 1000;
  if (claims.iss !== ISSUER && claims.iss !== `${ISSUER}/`) throw new Error('wrong issuer');
  if (!aud.includes(CLIENT_ID)) throw new Error('wrong audience');
  if (claims.exp < now - 60) throw new Error('id_token expired');
  if (claims.nonce !== nonce) throw new Error('nonce mismatch');
  return claims;
}

// ---- data -------------------------------------------------------------------

let locCache = { at: 0, list: [] };
async function locations() {
  if (Date.now() - locCache.at < 60 * 1000) return locCache.list;
  const r = await fetch(`${ONE_URL}/v1/locations`, { headers: { authorization: `Bearer ${TOKEN}`, 'x-actor': 'SVC-INF-04' } });
  locCache = { at: Date.now(), list: r.ok ? await r.json() : [] };
  return locCache.list;
}

function rank(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

// ---- responses --------------------------------------------------------------

function headers(nonce, extra = {}) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    ...extra,
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function redirect(res, to, setCookie) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store', ...(setCookie ? { 'set-cookie': setCookie } : {}) });
  res.end();
}

function navigator(session, locs, nonce) {
  const rights = session.rights || {};
  const mine = locs
    .map((l) => ({ ...l, level: rights[l.id] || 'none' }))
    .filter((l) => rank(l.level) >= rank(l.min_level || 'viewer'));
  const cards = mine.map((l) => {
    const target = l.url ? `<a class="button" href="${esc(l.url)}">Open ${esc(l.name)}</a>` : '<p class="lead">Not online yet.</p>';
    return `<li class="card tile"><h2>${esc(l.name)}</h2>
<p class="meta"><span class="badge level-${esc(l.level)}">${esc(l.level)}</span> ${esc(l.pillar || '')}</p>
${l.note ? `<p class="lead">${esc(l.note)}</p>` : ''}${target}</li>`;
  }).join('');
  const empty = '<div class="card"><p class="lead">Your account has no Location rights yet. Ask an Infinity admin to grant them.</p></div>';
  return page({
    title: 'Gate',
    nonce,
    wide: true,
    body: `<div class="who"><h1>Welcome, ${esc(session.name || session.email || 'there')}</h1>
<p class="lead">These are the Locations your Infinity-One account can open.${session.platform_admin ? ' You are a platform admin.' : ''}</p>
<form method="post" action="/logout"><button type="submit" class="secondary">Sign out</button></form></div>
${mine.length ? `<ul class="grid" aria-label="Your Locations">${cards}</ul>` : empty}`,
  });
}

// ---- routes -----------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url, 'http://gate');
  const p = url.pathname;
  const nonce = crypto.randomBytes(16).toString('base64');
  const session = unsign(cookies(req).inf_gate);

  if (p === '/healthz') return json(res, 200, { ok: true, service: 'SVC-INF-04' });

  if (req.method === 'GET' && p === '/') {
    if (!session) return redirect(res, '/login');
    res.writeHead(200, headers(nonce));
    return res.end(navigator(session, await locations(), nonce));
  }

  if (req.method === 'GET' && p === '/login') {
    const d = await getDiscovery();
    const tx = {
      state: crypto.randomBytes(24).toString('base64url'),
      nonce: crypto.randomBytes(24).toString('base64url'),
      verifier: crypto.randomBytes(48).toString('base64url'),
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const challenge = crypto.createHash('sha256').update(tx.verifier).digest('base64url');
    const auth = new URL(d.authorization_endpoint);
    auth.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `${SELF}/callback`,
      scope: 'openid email profile infinity',
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return redirect(res, auth.toString(), cookie('inf_gate_tx', sign(tx), 600));
  }

  if (req.method === 'GET' && p === '/callback') {
    const tx = unsign(cookies(req).inf_gate_tx);
    if (url.searchParams.get('error')) {
      res.writeHead(400, headers(nonce));
      return res.end(page({ title: 'Not signed in', nonce, body: `<div class="card"><h1>Not signed in</h1><p class="lead">${esc(url.searchParams.get('error_description') || url.searchParams.get('error'))}</p><a class="button" href="/login">Try again</a></div>` }));
    }
    if (!tx || tx.state !== url.searchParams.get('state')) return redirect(res, '/login');
    const d = await getDiscovery();
    const r = await hydraFetch(d.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: url.searchParams.get('code') || '',
        redirect_uri: `${SELF}/callback`,
        code_verifier: tx.verifier,
      }).toString(),
    });
    const tokens = await r.json();
    if (!r.ok) throw new Error(`token exchange failed: ${tokens.error || r.status}`);
    const c = await verifyIdToken(tokens.id_token, tx.nonce);
    const s = {
      sub: c.sub, email: c.email, name: c.name, rights: c.rights || {}, platform_admin: !!c.platform_admin,
      idt: tokens.id_token, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600,
    };
    return redirect(res, '/', [cookie('inf_gate', sign(s), SESSION_HOURS * 3600), cookie('inf_gate_tx', '', 0)]);
  }

  if (req.method === 'POST' && p === '/logout') {
    const d = await getDiscovery();
    const clear = cookie('inf_gate', '', 0);
    if (!session?.idt || !d.end_session_endpoint) return redirect(res, '/login', clear);
    const out = new URL(d.end_session_endpoint);
    out.search = new URLSearchParams({ id_token_hint: session.idt, post_logout_redirect_uri: `${SELF}/signed-out` }).toString();
    return redirect(res, out.toString(), clear);
  }

  if (req.method === 'GET' && p === '/signed-out') {
    res.writeHead(200, headers(nonce));
    return res.end(page({ title: 'Signed out', nonce, body: '<div class="card"><h1>Signed out</h1><p class="lead">You are signed out of Infinity.</p><a class="button" href="/login">Sign in again</a></div>' }));
  }

  // JSON for other Locations: who is signed in here, and may they use a Location?
  if (req.method === 'GET' && p === '/api/me') {
    if (!session) return json(res, 401, { error: 'not signed in' });
    const { idt, ...pub } = session;
    return json(res, 200, pub);
  }
  if (req.method === 'GET' && p === '/api/check') {
    if (!session) return json(res, 401, { allowed: false, reason: 'not signed in' });
    const loc = url.searchParams.get('location') || '';
    const need = url.searchParams.get('level') || 'viewer';
    const have = session.rights?.[loc] || 'none';
    const allowed = rank(have) >= rank(need) && rank(have) > 0;
    return json(res, allowed ? 200 : 403, { allowed, location: loc, have, need });
  }

  res.writeHead(404, headers(nonce));
  return res.end(page({ title: 'Not found', nonce, body: '<div class="card"><h1>Not found</h1><a class="button" href="/">Back to Gate</a></div>' }));
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(err.message);
    if (res.headersSent) return;
    const nonce = crypto.randomBytes(16).toString('base64');
    res.writeHead(502, headers(nonce));
    res.end(page({ title: 'Gate problem', nonce, body: '<div class="card"><h1>Gate could not finish sign-in</h1><p class="lead">Please try again.</p><a class="button" href="/login">Try again</a></div>' }));
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`SVC-INF-04 Gate listening on :${PORT}`));
}

module.exports = { server, sign, unsign, rank };
