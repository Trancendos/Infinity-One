// Checks the Management Center desktop flow: public client, PKCE, loopback redirect on any port.
//   node deploy/test/mc-pkce.mjs http://localhost:4444 drew@example.com 'password'
import crypto from 'node:crypto';
import assert from 'node:assert';
const [issuer, email, password] = process.argv.slice(2);
const jar = new Map();
const keep = (u, r) => { const c = jar.get(new URL(u).host) || new Map(); for (const l of r.headers.getSetCookie()) { const [p] = l.split(';'); const i = p.indexOf('='); c.set(p.slice(0, i), p.slice(i + 1)); } jar.set(new URL(u).host, c); };
const ck = (u) => [...(jar.get(new URL(u).host) || [])].map(([k, v]) => `${k}=${v}`).join('; ');
async function go(u, o = {}) {
  for (let i = 0; i < 15; i++) {
    if (u.startsWith('http://127.0.0.1:53123/')) return u; // the desktop app's loopback listener
    const r = await fetch(u, { ...o, redirect: 'manual', headers: { ...(o.headers || {}), cookie: ck(u) } });
    keep(u, r);
    if (r.status < 300 || r.status >= 400) return { u, body: await r.text() };
    u = new URL(r.headers.get('location'), u).toString(); o = {};
  }
}
const verifier = crypto.randomBytes(48).toString('base64url');
const redirect = 'http://127.0.0.1:53123/callback';
const auth = `${issuer}/oauth2/auth?` + new URLSearchParams({ response_type: 'code', client_id: 'management-center', redirect_uri: redirect, scope: 'openid email profile infinity offline_access', state: 'abcdefghij', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
let r = await go(auth);
const ch = r.body.match(/name="challenge" value="([^"]+)"/)[1];
const csrf = r.body.match(/name="_csrf" value="([^"]+)"/)[1];
const back = await go(new URL('/login', r.u).toString(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ challenge: ch, _csrf: csrf, email, password }).toString() });
assert.equal(typeof back, 'string', 'expected a redirect to the loopback port');
const code = new URL(back).searchParams.get('code');
const tok = await (await fetch(`${issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: 'management-center', code_verifier: verifier }) })).json();
assert.ok(tok.access_token && tok.id_token && tok.refresh_token, JSON.stringify(tok));
const at = JSON.parse(Buffer.from(tok.access_token.split('.')[1], 'base64url').toString());
console.log('ok  MC desktop PKCE flow; access token is a JWT, ext.rights[management-center] =', at.ext?.rights?.['management-center']);
