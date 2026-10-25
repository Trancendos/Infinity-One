// SVC-INF-02 One directory store.
// Users, password hashes and per-Location rights, kept in one JSON file.
// Writes go to a temp file and are renamed into place, so a crash never
// leaves a half-written file. Every change is appended to an audit log.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEVELS = ['none', 'viewer', 'user', 'admin'];
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function levelRank(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function checkPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, got);
}

// A fixed hash used when the email is unknown, so a miss costs the same time as a hit.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

class Store {
  constructor(dataDir, seedLocationsFile) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'one.json');
    this.auditFile = path.join(dataDir, 'audit.log');
    fs.mkdirSync(dataDir, { recursive: true });
    this.mtime = 0;
    if (fs.existsSync(this.file)) {
      this.refresh();
    } else {
      const locations = seedLocationsFile && fs.existsSync(seedLocationsFile)
        ? JSON.parse(fs.readFileSync(seedLocationsFile, 'utf8'))
        : [];
      this.db = { version: 1, users: {}, locations };
      this.save();
    }
  }

  // The CLI and the server share one file, so re-read it whenever another process changed it.
  refresh() {
    const m = fs.statSync(this.file).mtimeMs;
    if (m !== this.mtime) {
      this.db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.mtime = m;
    }
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
    this.mtime = fs.statSync(this.file).mtimeMs;
  }

  audit(actor, action, detail) {
    const line = JSON.stringify({ at: new Date().toISOString(), actor, action, ...detail });
    fs.appendFileSync(this.auditFile, line + '\n');
  }

  findByEmail(email) {
    this.refresh();
    const e = String(email || '').trim().toLowerCase();
    return Object.values(this.db.users).find((u) => u.email === e) || null;
  }

  get(id) {
    this.refresh();
    return this.db.users[id] || null;
  }

  list() {
    this.refresh();
    return Object.values(this.db.users).map(publicUser);
  }

  locations() {
    this.refresh();
    return this.db.locations;
  }

  createUser({ email, name, password, rights }, actor) {
    this.refresh();
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'invalid email');
    if (!password || String(password).length < 12) throw new HttpError(400, 'password must be at least 12 characters');
    if (this.findByEmail(e)) throw new HttpError(409, 'email already registered');
    const id = `INF-USR-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db.users[id] = {
      id, email: e, name: String(name || e), status: 'active',
      password: hashPassword(String(password)),
      rights: sanitizeRights(rights || {}),
      failed: 0, locked_until: null, created_at: now, updated_at: now,
    };
    this.save();
    this.audit(actor, 'user.create', { user: id, email: e });
    return publicUser(this.db.users[id]);
  }

  updateUser(id, patch, actor) {
    this.refresh();
    const u = this.get(id);
    if (!u) throw new HttpError(404, 'user not found');
    if (patch.name !== undefined) u.name = String(patch.name);
    if (patch.status !== undefined) {
      if (!['active', 'disabled'].includes(patch.status)) throw new HttpError(400, 'status must be active or disabled');
      u.status = patch.status;
    }
    if (patch.password !== undefined) {
      if (String(patch.password).length < 12) throw new HttpError(400, 'password must be at least 12 characters');
      u.password = hashPassword(String(patch.password));
      u.failed = 0;
      u.locked_until = null;
    }
    u.updated_at = new Date().toISOString();
    this.save();
    this.audit(actor, 'user.update', { user: id, fields: Object.keys(patch).filter((k) => k !== 'password').concat(patch.password ? ['password'] : []) });
    return publicUser(u);
  }

  setRights(id, rights, actor) {
    this.refresh();
    const u = this.get(id);
    if (!u) throw new HttpError(404, 'user not found');
    u.rights = { ...u.rights, ...sanitizeRights(rights) };
    for (const [k, v] of Object.entries(u.rights)) if (v === 'none') delete u.rights[k];
    u.updated_at = new Date().toISOString();
    this.save();
    this.audit(actor, 'user.rights', { user: id, rights: u.rights });
    return publicUser(u);
  }

  // Returns the user on success, or null. Locks the account for 15 minutes after 5 misses.
  verify(email, password) {
    this.refresh();
    const u = this.findByEmail(email);
    if (!u) {
      checkPassword(String(password || ''), DUMMY_HASH);
      return { ok: false, reason: 'invalid' };
    }
    if (u.locked_until && Date.parse(u.locked_until) > Date.now()) {
      return { ok: false, reason: 'locked' };
    }
    const good = checkPassword(String(password || ''), u.password);
    if (!good) {
      u.failed = (u.failed || 0) + 1;
      if (u.failed >= 5) {
        u.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        u.failed = 0;
        this.audit('system', 'user.locked', { user: u.id });
      }
      this.save();
      return { ok: false, reason: 'invalid' };
    }
    if (u.status !== 'active') return { ok: false, reason: 'disabled' };
    if (u.failed || u.locked_until) {
      u.failed = 0;
      u.locked_until = null;
      this.save();
    }
    return { ok: true, user: publicUser(u) };
  }

  // The claims Portal puts into tokens. Kept small: rights per Location plus an admin flag.
  claims(id) {
    this.refresh();
    const u = this.get(id);
    if (!u) return null;
    const roles = [...new Set(Object.values(u.rights))].filter((r) => r !== 'none');
    return {
      email: u.email,
      email_verified: false,
      name: u.name,
      roles,
      rights: u.rights,
      platform_admin: u.rights.platform === 'admin',
    };
  }
}

function sanitizeRights(rights) {
  const out = {};
  for (const [loc, level] of Object.entries(rights || {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(loc)) throw new HttpError(400, `bad location id: ${loc}`);
    if (!LEVELS.includes(level)) throw new HttpError(400, `bad level for ${loc}: ${level}`);
    out[loc] = level;
  }
  return out;
}

function publicUser(u) {
  const { password, failed, ...rest } = u;
  return rest;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { Store, HttpError, LEVELS, levelRank, hashPassword, checkPassword };
