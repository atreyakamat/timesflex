#!/usr/bin/env node
// Runs on the college's network, next to the machines, and forwards punches to TimeFlex.
//
//   TIMEFLEX_URL=http://server:8080 TIMEFLEX_DEVICE_KEY=tfd_... node main.mjs
//   BRIDGE_CONFIG=bridge.config.json node main.mjs     (several machines, folders or webhooks)
//   node main.mjs import punches.csv                   (send one exported file now)
import { readFileSync } from 'node:fs';
import http from 'node:http';

import { SOURCES } from './adapters/index.mjs';
import { createBridge, deviceLineToScan } from './bridge.mjs';
import { loadConfig } from './config.mjs';
import { parsePunches } from './punchfile.mjs';

const log = (message) => console.log(`${new Date().toISOString()} ${message}`);
let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const bridge = createBridge({ url: config.url, key: config.key, offset: config.offset, queueFile: config.queueFile, log });
const flush = async () => {
  if (!bridge.pending()) return;
  const { sent, unmatched, rejected, error } = await bridge.flush();
  if (sent) log(`Sent ${sent} scan(s).`);
  if (unmatched?.length) log(`Not matched to a student: ${[...new Set(unmatched)].join(', ')}. Link these IDs in TimeFlex: More > Fingerprint machines.`);
  if (rejected) log(`${rejected} refused and set aside.`);
  if (error) log(`${error}. ${bridge.pending()} waiting, will retry.`);
};
// Several sources can ask at once. One send, reported once.
let sending = null;
const soon = () => {
  sending ??= flush()
    .catch((error) => log(error.message))
    .finally(() => {
      sending = null;
    });
  return sending;
};

if (process.argv[2] === 'import') {
  const file = process.argv[3];
  if (!file) {
    console.error('Usage: node main.mjs import punches.csv');
    process.exit(1);
  }
  const { punches, skipped } = parsePunches(readFileSync(file, 'utf8'));
  bridge.enqueue(punches.map((punch) => deviceLineToScan({ pin: punch.id, time: punch.time }, process.env.SOURCE_NAME ?? 'file', config.offset)));
  log(`Read ${punches.length} punch(es) from ${file}${skipped ? `, and couldn't read ${skipped} line(s)` : ''}.`);
  await flush();
  process.exit(bridge.pending() ? 1 : 0);
}

const running = [];
for (const [index, options] of config.sources.entries()) {
  try {
    const source = SOURCES[options.type](options, { enqueue: bridge.enqueue, log, offset: config.offset, stateFile: `${config.queueFile}.${options.type}-${index}.state`, onReceived: soon });
    await source.start();
    running.push(source);
  } catch (error) {
    log(`Source ${index + 1} (${options.type}) didn't start: ${error.message}`);
  }
}
if (!running.length) {
  log('Nothing to listen to. Check the sources in your settings.');
  process.exit(1);
}

// For Docker and monitoring: is it alive, and is anything stuck?
const healthPort = Number(process.env.HEALTH_PORT ?? 8090);
http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'ok', waiting: bridge.pending(), sources: config.sources.map((source) => source.type) }));
}).listen(healthPort, '127.0.0.1');
setInterval(soon, config.flushSeconds * 1000);
