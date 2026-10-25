// SVC-INF-03 Portal: the Infinity sign-in homepage.
// Ory Hydra sends the browser here with a login, consent or logout challenge. Portal checks
// the password with One (SVC-INF-02), then tells Hydra's admin API to accept or reject.
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { page, esc } = require('./ui');

const PORT = Number(process.env.PORT || 8042);
const HYDRA_ADMIN = (process.env.HYDRA_ADMIN_URL || 'http://hydra:4445').replace(/\/$/, '');
const ONE_URL = (process.env.ONE_URL || 'http://one:8043').replace(/\/$/, '');
const TOKEN = process.env.INTERNAL_TOKEN || '';
const GATE_URL = process.env.GATE_PUBLIC_URL || '/';
const SECURE_COOKIES = process.env.COOKIE_SECURE !== 'false';
const REMEMBER_FOR = Number(process.env.REMEMBER_FOR_SECONDS || 30 * 24 * 3600);

if (TOKEN.length < 32) {
  console.error('INTERNAL_TOKEN must be set to at least 32 characters');
  process.exit(1);
}

// ---- small helpers -------------------------------------------------------

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
}

async function readForm(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 16 * 1024) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

function securityHeaders(nonce) {
  return {
    'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  };
}

function html(res, status, nonce, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...securityHeaders(nonce), ...extraHeaders });
  res.end(body);
}

function redirect(res, to) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' });
  res.end();
}

async function hydra(method, path, body) {
  const r = await fetch(`${HYDRA_ADMIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`hydra ${method} ${path.split('?')[0]} -> ${r.status}`), { status: 502, detail: data });
  return data;
}

async function one(method, path, body) {
  const r = await fetch(`${ONE_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'x-actor': 'SVC-INF-03' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Object.assign(new Error(`one ${path} -> ${r.status}`), { status: 502 });
  return r.json();
}

// Simple in-memory limiter: 20 password attempts per IP per 10 minutes.
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 20;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of attempts) if (list.every((t) => now - t >= 10 * 60 * 1000)) attempts.delete(ip);
}, 60 * 1000).unref();

// CSRF: a random token in a SameSite=Strict cookie that the form must echo back.
function csrfPair(req) {
  const existing = cookies(req).inf_csrf;
  const token = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : crypto.randomBytes(32).toString('base64url');
  const cookie = `inf_csrf=${token}; Path=/; HttpOnly; SameSite=Strict${SECURE_COOKIES ? '; Secure' : ''}`;
  return { token, cookie };
}

function csrfOk(req, form) {
  const a = Buffer.from(String(cookies(req).inf_csrf || ''));
  const b = Buffer.from(String(form._csrf || ''));
  return a.length === 43 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Scope -> which One claims go into tokens.
function claimsFor(scopes, c) {
  const id = {};
  if (scopes.includes('email')) Object.assign(id, { email: c.email, email_verified: c.email_verified });
  if (scopes.includes('profile')) Object.assign(id, { name: c.name });
  if (scopes.includes('infinity')) Object.assign(id, { roles: c.roles, rights: c.rights, platform_admin: c.platform_admin });
  const access = scopes.includes('infinity') ? { roles: c.roles, rights: c.rights, platform_admin: c.platform_admin } : {};
  return { id_token: id, access_token: access };
}

const SCOPE_TEXT = {
  openid: 'Confirm who you are',
  email: 'See your email address',
  profile: 'See your name',
  infinity: 'See which Locations you can use, and at what level',
  offline_access: 'Stay signed in on this device',
};

// ---- pages ----------------------------------------------------------------

function loginPage({ challenge, csrf, email = '', error = '', clientName = '', nonce }) {
  return page({
    title: 'Sign in',
    nonce,
    body: `<div class="card">
<h1>Sign in to Infinity</h1>
<p class="lead">${clientName ? `Continue to <strong>${esc(clientName)}</strong>.` : 'One account for every Trancendos Location.'}</p>
<form method="post" action="/login" novalidate>
<input type="hidden" name="challenge" value="${esc(challenge)}">
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="username" required value="${esc(email)}" ${error ? 'aria-describedby="err"' : 'autofocus'}>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required ${error ? 'aria-describedby="err" autofocus' : ''}>
<div class="row"><input id="remember" name="remember" type="checkbox" value="1"><label for="remember">Keep me signed in on this device</label></div>
<div id="err" class="error" role="alert" aria-live="assertive">${esc(error)}</div>
<button type="submit">Sign in</button>
</form></div>`,
  });
}

function consentPage({ challenge, csrf, clientName, scopes, nonce }) {
  const items = scopes.map((s) => `<li>${esc(SCOPE_TEXT[s] || s)}</li>`).join('');
  return page({
    title: 'Allow access',
    nonce,
    body: `<div class="card">
<h1>Allow ${esc(clientName)}?</h1>
<p class="lead">${esc(clientName)} is asking to:</p>
<ul class="scopes">${items}</ul>
<form method="post" action="/consent">
<input type="hidden" name="challenge" value="${esc(challenge)}">
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<div class="row"><input id="remember" name="remember" type="checkbox" value="1" checked><label for="remember">Remember my choice</label></div>
<button type="submit" name="decision" value="allow">Allow</button>
<button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form></div>`,
  });
}

function messagePage(title, text, nonce, link) {
  return page({
    title,
    nonce,
    body: `<div class="card"><h1>${esc(title)}</h1><p class="lead">${esc(text)}</p>${link ? `<a class="button" href="${esc(link)}">Continue</a>` : ''}</div>`,
  });
}

// ---- routes ---------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url, 'http://portal');
  const p = url.pathname;
  const nonce = crypto.randomBytes(16).toString('base64');

  if (p === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'SVC-INF-03' }));
  }

  if (req.method === 'GET' && p === '/') return redirect(res, GATE_URL);

  if (req.method === 'GET' && p === '/login') {
    const challenge = url.searchParams.get('login_challenge');
    if (!challenge) return html(res, 400, nonce, messagePage('Nothing to sign in to', 'Open the app you want to use and sign in from there.', nonce, GATE_URL));
    const lr = await hydra('GET', `/admin/oauth2/auth/requests/login?login_challenge=${encodeURIComponent(challenge)}`);
    if (lr.skip) {
      const ok = await hydra('PUT', `/admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(challenge)}`, { subject: lr.subject });
      return redirect(res, ok.redirect_to);
    }
    const { token, cookie } = csrfPair(req);
    return html(res, 200, nonce, loginPage({ challenge, csrf: token, clientName: lr.client?.client_name, nonce }), { 'set-cookie': cookie });
  }

  if (req.method === 'POST' && p === '/login') {
    const form = await readForm(req);
    const challenge = String(form.challenge || '');
    const { token, cookie } = csrfPair(req);
    if (!csrfOk(req, form)) return html(res, 403, nonce, messagePage('Session expired', 'Please go back and try again.', nonce), { 'set-cookie': cookie });
    if (limited(clientIp(req))) {
      return html(res, 429, nonce, loginPage({ challenge, csrf: token, email: form.email, error: 'Too many attempts. Wait 10 minutes and try again.', nonce }), { 'set-cookie': cookie });
    }
    const result = await one('POST', '/v1/verify', { email: form.email, password: form.password });
    if (!result.ok) {
      const error = result.reason === 'locked'
        ? 'This account is locked for 15 minutes after too many attempts.'
        : 'That email and password do not match an active account.';
      return html(res, 401, nonce, loginPage({ challenge, csrf: token, email: form.email, error, nonce }), { 'set-cookie': cookie });
    }
    const ok = await hydra('PUT', `/admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(challenge)}`, {
      subject: result.user.id,
      remember: form.remember === '1',
      remember_for: REMEMBER_FOR,
      acr: '1',
      amr: ['pwd'],
    });
    return redirect(res, ok.redirect_to);
  }

  if (req.method === 'GET' && p === '/consent') {
    const challenge = url.searchParams.get('consent_challenge');
    if (!challenge) return html(res, 400, nonce, messagePage('Missing request', 'Start again from the app you want to use.', nonce, GATE_URL));
    const cr = await hydra('GET', `/admin/oauth2/auth/requests/consent?consent_challenge=${encodeURIComponent(challenge)}`);
    const firstParty = cr.client?.metadata?.first_party === true;
    if (cr.skip || firstParty) return acceptConsent(res, challenge, cr, true);
    const { token, cookie } = csrfPair(req);
    return html(res, 200, nonce, consentPage({ challenge, csrf: token, clientName: cr.client?.client_name || cr.client?.client_id, scopes: cr.requested_scope || [], nonce }), { 'set-cookie': cookie });
  }

  if (req.method === 'POST' && p === '/consent') {
    const form = await readForm(req);
    const challenge = String(form.challenge || '');
    if (!csrfOk(req, form)) return html(res, 403, nonce, messagePage('Session expired', 'Please go back and try again.', nonce));
    if (form.decision !== 'allow') {
      const r = await hydra('PUT', `/admin/oauth2/auth/requests/consent/reject?consent_challenge=${encodeURIComponent(challenge)}`, {
        error: 'access_denied', error_description: 'The user denied the request',
      });
      return redirect(res, r.redirect_to);
    }
    const cr = await hydra('GET', `/admin/oauth2/auth/requests/consent?consent_challenge=${encodeURIComponent(challenge)}`);
    return acceptConsent(res, challenge, cr, form.remember === '1');
  }

  if (req.method === 'GET' && p === '/logout') {
    const challenge = url.searchParams.get('logout_challenge');
    if (!challenge) return html(res, 200, nonce, messagePage('Signed out', 'You can close this window.', nonce, GATE_URL));
    const r = await hydra('PUT', `/admin/oauth2/auth/requests/logout/accept?logout_challenge=${encodeURIComponent(challenge)}`);
    return redirect(res, r.redirect_to);
  }

  if (req.method === 'GET' && p === '/error') {
    const desc = url.searchParams.get('error_description') || url.searchParams.get('error') || 'Something went wrong.';
    return html(res, 400, nonce, messagePage('Sign-in problem', desc, nonce, GATE_URL));
  }

  return html(res, 404, nonce, messagePage('Not found', 'That page does not exist.', nonce, GATE_URL));
}

async function acceptConsent(res, challenge, cr, remember) {
  const scopes = cr.requested_scope || [];
  const claims = await one('GET', `/v1/users/${encodeURIComponent(cr.subject)}/claims`);
  const r = await hydra('PUT', `/admin/oauth2/auth/requests/consent/accept?consent_challenge=${encodeURIComponent(challenge)}`, {
    grant_scope: scopes,
    grant_access_token_audience: cr.requested_access_token_audience || [],
    remember,
    remember_for: REMEMBER_FOR,
    session: claimsFor(scopes, claims),
  });
  return redirect(res, r.redirect_to);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(err.message, err.detail ? JSON.stringify(err.detail) : '');
    const nonce = crypto.randomBytes(16).toString('base64');
    if (!res.headersSent) html(res, err.status || 500, nonce, messagePage('Sign-in problem', 'The sign-in service had a problem. Please try again.', nonce, GATE_URL));
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`SVC-INF-03 Portal listening on :${PORT}`));
}

module.exports = { server, claimsFor };
