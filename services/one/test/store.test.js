'use strict';
// Run with: node --test services/one/test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../store');

// Throwaway passwords made at run time, so no credential-looking strings live in the repo.
const PW = crypto.randomBytes(18).toString('base64url');
const WRONG = crypto.randomBytes(18).toString('base64url');
const SHORT = 'x'.repeat(5);

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-'));
  return new Store(dir, path.join(__dirname, '..', 'locations.json'));
}

test('create, verify and claims', () => {
  const s = freshStore();
  const u = s.createUser({ email: 'Drew@Example.com', name: 'Drew', password: PW, rights: { 'management-center': 'admin' } }, 'test');
  assert.match(u.id, /^INF-USR-/);
  assert.equal(u.password, undefined);
  assert.equal(s.verify('drew@example.com', PW).ok, true);
  assert.equal(s.verify('drew@example.com', WRONG).ok, false);
  const c = s.claims(u.id);
  assert.deepEqual(c.rights, { 'management-center': 'admin' });
  assert.equal(c.platform_admin, false);
});

test('locks after five misses', () => {
  const s = freshStore();
  s.createUser({ email: 'a@b.co', password: PW }, 'test');
  for (let i = 0; i < 5; i++) s.verify('a@b.co', WRONG);
  assert.equal(s.verify('a@b.co', PW).reason, 'locked');
});

test('rejects bad input', () => {
  const s = freshStore();
  assert.throws(() => s.createUser({ email: 'x', password: PW }));
  assert.throws(() => s.createUser({ email: 'a@b.co', password: SHORT }));
  const u = s.createUser({ email: 'a@b.co', password: PW });
  assert.throws(() => s.setRights(u.id, { townhall: 'god' }));
  assert.throws(() => s.setRights(u.id, { 'Bad Id': 'user' }));
});

test('disabled user cannot sign in, data survives reload', () => {
  const s = freshStore();
  const u = s.createUser({ email: 'a@b.co', password: PW });
  s.updateUser(u.id, { status: 'disabled' });
  assert.equal(s.verify('a@b.co', PW).reason, 'disabled');
  const again = new Store(s.dataDir);
  assert.equal(again.get(u.id).status, 'disabled');
});

test('sees changes written by another process (the CLI)', () => {
  const a = freshStore();
  const b = new Store(a.dataDir);
  b.createUser({ email: 'cli@b.co', password: PW });
  assert.equal(a.verify('cli@b.co', PW).ok, true);
});
