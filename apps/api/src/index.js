import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { DEMO_DOMAIN } from './auth.js';
import { createStore } from './db.js';
import { aiConfig } from './llm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = await createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? path.resolve(here, '../data/timesflex.json'),
});

const app = createApp({ store });
const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  const ai = aiConfig();
  console.log(`TimeFlex API listening on http://localhost:${port}`);
  console.log(`  storage: ${store.kind}${store.kind === 'file' ? ' (set DATABASE_URL to use PostgreSQL)' : ''}`);
  console.log(`  ai:      ${ai.provider} ${ai.provider === 'off' ? '' : `${ai.model} @ ${ai.baseUrl}`}`);
});

/** Hourly: drop expired sessions, and demo accounts older than a day. */
const tidyUp = async () => {
  try {
    await store.deleteExpiredSessions();
    const before = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (const id of await store.listDemoAccountIds(DEMO_DOMAIN, before)) await store.deleteAccount(id);
  } catch (error) {
    console.error('Tidy-up failed:', error.message);
  }
};
tidyUp();
setInterval(tidyUp, 60 * 60 * 1000).unref();
