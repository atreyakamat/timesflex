// Makes an account the central admin, who can onboard and pause colleges. It can only be done from
// the server itself, so no request can ever grant it.
// In Docker: docker compose exec api node src/make-central-admin.js you@example.com
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeEmail } from './auth.js';
import { createStore } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const email = normalizeEmail(process.argv[2]);
const remove = process.argv[3] === '--remove';
if (!email) {
  console.error('Usage: node src/make-central-admin.js you@example.com [--remove]');
  process.exit(1);
}
const store = await createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? path.resolve(here, '../data/timesflex.json'),
});
const account = await store.getAccountByEmail(email);
if (!account) {
  console.error(`No account found for ${email}. Sign up first.`);
  process.exit(1);
}
await store.setPlatformAdmin(account.id, !remove);
console.log(`${email} is ${remove ? 'no longer' : 'now'} a central admin.`);
process.exit(0);
