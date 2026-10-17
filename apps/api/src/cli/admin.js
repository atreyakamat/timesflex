// Create an admin, or reset a user's password and re-enable them as admin.
// Usage: npm run admin -w @timesflex/api -- <username>
// The password is read from the TIMESFLEX_PASSWORD env var, or prompted for.
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { hashPassword, validatePassword, validateUsername } from '../auth.js';
import { createStore } from '../db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, '../../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const askPassword = async () => {
  if (process.env.TIMESFLEX_PASSWORD) return process.env.TIMESFLEX_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Hide typed characters.
  rl._writeToOutput = (text) => rl.output.write(text.includes('Password') ? text : '');
  const password = await rl.question('Password (min 8 chars): ');
  rl.close();
  process.stdout.write('\n');
  return password;
};

try {
  const username = validateUsername(process.argv[2]);
  const password = validatePassword(await askPassword());
  const store = await createStore({
    databaseUrl: process.env.DATABASE_URL,
    dataFile: process.env.DATA_FILE ?? path.resolve(here, '../../data/timesflex.json'),
  });
  const passwordHash = await hashPassword(password);
  const existing = await store.getUserByUsername(username);
  if (existing) {
    await store.updateUser(existing.id, { passwordHash, role: 'admin', disabled: false });
    await store.deleteUserSessions(existing.id);
    console.log(`Reset password for ${username} and made them an active admin.`);
  } else {
    await store.createUser({ username, passwordHash, role: 'admin' });
    console.log(`Created admin ${username}.`);
  }
  await store.pool?.end();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
