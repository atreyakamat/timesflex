import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createStore } from './db.js';
import { aiConfig, aiStatus } from './llm.js';
import { parseRequirements } from './parser.js';
import { solveWithSolver } from './solverClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = await createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? path.resolve(here, '../data/timesflex.json'),
});

const app = createApp({ store, solve: solveWithSolver, parse: parseRequirements, aiConfig, aiStatus });
const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  const ai = aiConfig();
  console.log(`TimeFlex API listening on http://localhost:${port}`);
  console.log(`  storage: ${store.kind}${store.kind === 'file' ? ' (set DATABASE_URL to use PostgreSQL)' : ''}`);
  console.log(`  ai:      ${ai.provider} ${ai.provider === 'off' ? '' : `${ai.model} @ ${ai.baseUrl}`}`);
});
