// For machines or vendor software that can call a URL when someone punches: cloud attendance
// services, access-control software, or your own scripts. You tell it which fields hold the ID
// and the time; it needs a shared secret, since anyone who can reach it could otherwise post.
import crypto from 'node:crypto';
import http from 'node:http';

import { parseDateTime } from '../punchfile.mjs';

const MAX_BODY = 1024 * 1024;

/** "event.person.id" or "items.0.id" from an object. */
export const pick = (value, dotted) => dotted.split('.').reduce((current, key) => (current == null ? undefined : current[key]), value);

/** An ISO time with a zone, seconds or milliseconds since 1970, or a local time like a machine writes. */
export const readWhen = (value, offset) => {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text) && !Number.isNaN(Date.parse(text))) return new Date(text).toISOString();
  if (/^\d{10,13}$/.test(text)) return readWhen(Number(text), offset);
  const local = parseDateTime(text);
  return local ? new Date(`${local.replace(' ', 'T')}${offset}`).toISOString() : null;
};

const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** One request. Pure, so it can be tested without a network. */
export const handleWebhook = ({ method, path, headers = {}, body }, { secret, fields, name, offset, enqueue, path: route = '/punch' }) => {
  const reply = (status, payload) => ({ status, body: JSON.stringify(payload) });
  if (path !== route) return reply(404, { error: 'Not found' });
  if (method !== 'POST') return reply(405, { error: 'Use POST' });
  const bearer = /^Bearer (.+)$/i.exec(headers.authorization ?? '')?.[1];
  if (!sameSecret(headers['x-bridge-secret'] ?? bearer, secret)) return reply(401, { error: 'Wrong or missing secret' });
  let parsed;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return reply(400, { error: 'Send JSON' });
  }
  const items = Array.isArray(parsed) ? parsed : fields.list ? pick(parsed, fields.list) : [parsed];
  if (!Array.isArray(items)) return reply(400, { error: `No list at "${fields.list}"` });
  const scans = [];
  const problems = [];
  for (const [index, item] of items.entries()) {
    const id = pick(item, fields.id);
    const at = readWhen(pick(item, fields.time ?? 'time'), offset);
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id).trim() === '' || !at) {
      problems.push(index);
      continue;
    }
    const identifier = String(id).trim();
    scans.push({ identifier, at, scanId: crypto.createHash('sha256').update(`${name}|${identifier}|${at}`).digest('hex').slice(0, 32) });
  }
  enqueue(scans);
  return reply(problems.length && !scans.length ? 400 : 200, { received: scans.length, unreadable: problems });
};

export const createWebhookSource = (options, { enqueue, log, offset, onReceived }) => {
  if (typeof options.secret !== 'string' || options.secret.length < 16) throw new Error('A webhook source needs a "secret" of at least 16 characters');
  if (!options.fields?.id) throw new Error('A webhook source needs "fields": { "id": "...", "time": "..." }');
  const settings = { ...options, name: options.name ?? 'webhook', offset, enqueue };
  const server = http.createServer((request, response) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        response.writeHead(413).end();
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      const { status, body } = handleWebhook({ method: request.method, path: new URL(request.url, 'http://bridge').pathname, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }, settings);
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(body);
      if (status === 200) onReceived?.();
    });
  });
  return {
    start: () => new Promise((resolve) => server.listen(options.port ?? 8082, () => {
      log(`${settings.name}: waiting for punches at http://<this computer>:${server.address().port}${options.path ?? '/punch'}`);
      resolve();
    })),
    stop: () => new Promise((resolve) => server.close(resolve)),
    port: () => server.address()?.port,
  };
};
