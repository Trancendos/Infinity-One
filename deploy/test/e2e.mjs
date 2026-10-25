// End-to-end sign-in check that acts like a browser (cookies + redirects), no dependencies.
// Usage (stack running in local dev mode, see docs/TESTING.md):
//   node deploy/test/e2e.mjs http://localhost:8046 drew@example.com 'password'
import assert from 'node:assert';

const [gate = 'http://localhost:8046', email, password] = process.argv.slice(2);
if (!email || !password) { console.error('usage: e2e.mjs <gate-url> <email> <password>'); process.exit(2); }

const jar = new Map(); // host -> Map(name -> value)
function store(url, res) {
  const host = new URL(url).host;
  const c = jar.get(host) || new Map();
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    c.set(pair.slice(0, i), pair.slice(i + 1));
  }
  jar.set(host, c);
}
function header(url) {
  const c = jar.get(new URL(url).host);
  return c ? [...c].filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
async function go(url, opts = {}, hops = 0) {
  const res = await fetch(url, { ...opts, redirect: 'manual', headers: { ...(opts.headers || {}), cookie: header(url) } });
  store(url, res);
  if (res.status >= 300 && res.status < 400 && hops < 15) {
    return go(new URL(res.headers.get('location'), url).toString(), {}, hops + 1);
  }
  return { url, res, body: await res.text() };
}

// 1. Visiting Gate unsigned ends on the Portal sign-in form.
let r = await go(`${gate}/`);
assert.match(r.body, /Sign in to Infinity/, 'expected the Portal sign-in page');
const challenge = r.body.match(/name="challenge" value="([^"]+)"/)[1];
const csrf = r.body.match(/name="_csrf" value="([^"]+)"/)[1];
console.log('ok  Gate redirects to Portal sign-in');

// 2. Wrong password stays on the form with an error.
const loginUrl = new URL('/login', r.url).toString();
const post = (pw) => go(loginUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ challenge, _csrf: csrf, email, password: pw }).toString(),
});
r = await post('definitely-not-it');
assert.equal(r.res.status, 401);
assert.match(r.body, /do not match/);
console.log('ok  wrong password is refused');

// 3. Missing CSRF token is refused.
const bad = await fetch(loginUrl, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `challenge=${challenge}&email=${email}&password=x` });
assert.equal(bad.status, 403);
console.log('ok  form without CSRF token is refused');

// 4. Right password goes through Hydra, consent (first party, skipped) and back to Gate.
r = await post(password);
assert.equal(r.res.status, 200, `final status ${r.res.status} at ${r.url}: ${r.body.slice(0, 200)}`);
assert.match(r.body, /Welcome,/, 'expected the Gate navigator');
console.log('ok  signed in and landed on Gate');
const tiles = [...r.body.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
console.log('    Locations shown:', tiles.join(', ') || '(none)');

// 5. Gate APIs reflect the rights in the ID token.
const me = JSON.parse((await go(`${gate}/api/me`)).body);
console.log('    /api/me:', JSON.stringify({ sub: me.sub, email: me.email, platform_admin: me.platform_admin }));
const mc = await go(`${gate}/api/check?location=management-center&level=admin`);
console.log(`    /api/check management-center admin -> ${mc.res.status}`);

// 6. Sign out clears the session.
r = await go(`${gate}/logout`, { method: 'POST' });
assert.match(r.body, /Signed out/);
assert.equal((await go(`${gate}/api/me`)).res.status, 401);
console.log('ok  sign out works');
