#!/usr/bin/env node
// SVC-INF-02 One admin CLI. Runs inside the container against the same data directory:
//   docker compose exec one node cli.js create-user --email you@example.com --name "Drew" --admin
//   docker compose exec one node cli.js set-right --email you@example.com --location townhall --level user
//   docker compose exec one node cli.js list
// Passwords are read from the ONE_PASSWORD env var, or prompted for, never from arguments.
'use strict';

const path = require('node:path');
const readline = require('node:readline');
const { Store, LEVELS } = require('./store');

const store = new Store(process.env.DATA_DIR || '/data', process.env.LOCATIONS_FILE || path.join(__dirname, 'locations.json'));
const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
}

function askHidden(question) {
  if (process.env.ONE_PASSWORD) return Promise.resolve(process.env.ONE_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

function need(user) {
  if (!user) { console.error('No user with that email'); process.exit(1); }
  return user;
}

(async () => {
  const actor = `cli:${process.env.USER || 'admin'}`;
  switch (cmd) {
    case 'create-user': {
      const password = await askHidden('Password (min 12 chars): ');
      const rights = args.admin
        ? Object.fromEntries(store.locations().map((l) => [l.id, 'admin']))
        : {};
      const u = store.createUser({ email: args.email, name: args.name, password, rights }, actor);
      console.log(JSON.stringify(u, null, 2));
      break;
    }
    case 'set-password': {
      const u = need(store.findByEmail(args.email));
      const password = await askHidden('New password (min 12 chars): ');
      store.updateUser(u.id, { password }, actor);
      console.log('Password updated');
      break;
    }
    case 'set-right': {
      const u = need(store.findByEmail(args.email));
      if (!LEVELS.includes(args.level)) { console.error(`--level must be one of ${LEVELS.join(', ')}`); process.exit(1); }
      console.log(JSON.stringify(store.setRights(u.id, { [args.location]: args.level }, actor).rights, null, 2));
      break;
    }
    case 'disable':
    case 'enable': {
      const u = need(store.findByEmail(args.email));
      store.updateUser(u.id, { status: cmd === 'disable' ? 'disabled' : 'active' }, actor);
      console.log(`User ${cmd}d`);
      break;
    }
    case 'list':
      console.table(store.list().map((u) => ({ id: u.id, email: u.email, status: u.status, rights: Object.keys(u.rights).length })));
      break;
    case 'locations':
      console.table(store.locations());
      break;
    default:
      console.log('Commands: create-user [--admin], set-password, set-right, disable, enable, list, locations');
      process.exit(cmd ? 1 : 0);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
