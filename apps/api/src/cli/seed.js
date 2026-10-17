// Add the demo department (a fictional college) so there is something to generate on day one.
// Usage: npm run seed -w @timesflex/api
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from '../db.js';
import { seedDemo } from '../demo/demoDepartment.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, '../../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const store = await createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? path.resolve(here, '../../data/timesflex.json'),
});
try {
  const { created, institution } = await seedDemo(store);
  console.log(created ? `Added "${institution.name}". Sign in and open it from the dashboard.` : `"${institution.name}" is already there; nothing changed.`);
} finally {
  await store.pool?.end();
}
