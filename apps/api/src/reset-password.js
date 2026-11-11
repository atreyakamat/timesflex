// For a locked-out user: sets a temporary password and signs them out everywhere.
// In Docker: docker compose exec api node src/reset-password.js someone@college.edu
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPassword, normalizeEmail } from './auth.js';
import { createStore } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const email = normalizeEmail(process.argv[2]);
if (!email) {
  console.error('Usage: node src/reset-password.js someone@college.edu');
  process.exit(1);
}
const store = await createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? path.resolve(here, '../data/timesflex.json'),
});
const account = await store.getAccountByEmail(email);
if (!account) {
  console.error(`No account found for ${email}.`);
  process.exit(1);
}
const temporary = crypto.randomBytes(9).toString('base64url');
await store.updateAccountPassword(account.id, await hashPassword(temporary));
await store.deleteAccountSessions(account.id);
console.log(`Temporary password for ${email}: ${temporary}`);
console.log('Ask them to change it under More, Account after signing in.');
process.exit(0);
