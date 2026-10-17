import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createStore } from './db.js';
import { aiConfig, aiStatus } from './llm.js';
import { parseRequirements } from './parser.js';
import { solveWithSolver } from './solverClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Settings from the repo-root .env, if present. Real environment variables win.
const envFile = path.resolve(here, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const store = await createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? path.resolve(here, '../data/timesflex.json'),
});

const app = createApp({
  store,
  solve: solveWithSolver,
  parse: parseRequirements,
  aiConfig,
  aiStatus,
  webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  allowedOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
  log: process.env.LOG_REQUESTS === 'false' ? undefined : console.log,
});
const port = process.env.PORT ?? 3001;

const server = app.listen(port, () => {
  const ai = aiConfig();
  console.log(`TimeFlex API listening on http://localhost:${port}`);
  console.log(`  storage: ${store.kind}${store.kind === 'file' ? ' (set DATABASE_URL to use PostgreSQL)' : ''}`);
  console.log(`  ai:      ${ai.provider} ${ai.provider === 'off' ? '' : `${ai.model} @ ${ai.baseUrl}`}`);
});

// Finish in-flight requests and close the database cleanly on Ctrl+C or a container stop.
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await store.pool?.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
