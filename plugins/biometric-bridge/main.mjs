#!/usr/bin/env node
// Runs on the college's network, next to the machines. They report here, and this forwards to TimeFlex.
//
//   TIMEFLEX_URL=http://server:8080 TIMEFLEX_DEVICE_KEY=tfd_... node main.mjs
//   node main.mjs import punches.csv     (for readers that only export a file)
import { readFileSync } from 'node:fs';
import http from 'node:http';

import { createBridge, deviceLineToScan, handleIclock, parseCsv } from './bridge.mjs';

const MAX_BODY = 2 * 1024 * 1024;
const env = process.env;
const url = env.TIMEFLEX_URL;
const key = env.TIMEFLEX_DEVICE_KEY;
const offset = env.COLLEGE_UTC_OFFSET ?? '+05:30';
const port = Number(env.PORT ?? 8081);
const serials = (env.ALLOWED_SERIALS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const flushEvery = Number(env.FLUSH_SECONDS ?? 15) * 1000;
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

if (!url || !key) {
  console.error('Set TIMEFLEX_URL and TIMEFLEX_DEVICE_KEY. Make the key in TimeFlex: More > Devices.');
  process.exit(1);
}
if (!/^[+-]\d{2}:\d{2}$/.test(offset)) {
  console.error('COLLEGE_UTC_OFFSET must look like +05:30');
  process.exit(1);
}

const bridge = createBridge({ url, key, offset, queueFile: env.QUEUE_FILE ?? 'timeflex-queue.json', log });
const flush = async () => {
  const before = bridge.pending();
  if (!before) return;
  const { sent, unmatched, rejected, error } = await bridge.flush();
  if (sent) log(`Sent ${sent} scan(s).`);
  if (unmatched?.length) log(`Not on any class list: ${[...new Set(unmatched)].join(', ')}. Their IDs on the machine must match a roll number.`);
  if (rejected) log(`${rejected} refused and set aside.`);
  if (error) log(`${error}. ${bridge.pending()} waiting, will retry.`);
};

if (process.argv[2] === 'import') {
  const file = process.argv[3];
  if (!file) {
    console.error('Usage: node main.mjs import punches.csv');
    process.exit(1);
  }
  const lines = parseCsv(readFileSync(file, 'utf8'));
  bridge.enqueue(lines.map((line) => deviceLineToScan(line, env.SOURCE_NAME ?? 'file', offset)));
  log(`Read ${lines.length} line(s) from ${file}.`);
  await flush();
  process.exit(bridge.pending() ? 1 : 0);
}

const server = http.createServer((request, response) => {
  const parsed = new URL(request.url, 'http://bridge');
  if (parsed.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ status: 'ok', waiting: bridge.pending() }));
  }
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      response.writeHead(413).end('Too large');
      request.destroy();
    } else chunks.push(chunk);
  });
  request.on('end', () => {
    if (response.writableEnded) return;
    const { status, body } = handleIclock(
      { method: request.method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body: Buffer.concat(chunks).toString('utf8') },
      { enqueue: bridge.enqueue, offset, serials },
    );
    response.writeHead(status, { 'Content-Type': 'text/plain' });
    response.end(body);
    if (parsed.pathname === '/iclock/cdata' && request.method === 'POST') flush().catch((error) => log(error.message));
  });
});

server.listen(port, () => {
  log(`Listening for machines on port ${port}. Set each machine's server to this computer's address and port.`);
  if (!serials.length) log('Any machine on this network can report here. Set ALLOWED_SERIALS to limit it to yours.');
});
setInterval(() => flush().catch((error) => log(error.message)), flushEvery);
