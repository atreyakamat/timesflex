// The ways the bridge hears about punches. Run: node --test plugins/biometric-bridge/test
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAdmsSource } from '../adapters/zkteco-adms.mjs';
import { scanFolder, createFolderSource } from '../adapters/folder.mjs';
import { createWebhookSource, handleWebhook, pick, readWhen } from '../adapters/webhook.mjs';
import { parseCsv } from '../bridge.mjs';
import { loadConfig } from '../config.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'tf-bridge-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const local = (msAgo) => {
  const d = new Date(Date.now() + 5.5 * 3600000 - msAgo);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

/* ---------- Webhook ---------- */

const SECRET = 'a-secret-of-enough-length';
const hook = (body, extra = {}) => {
  const got = [];
  const result = handleWebhook({ method: 'POST', path: '/punch', headers: { 'x-bridge-secret': SECRET }, body: JSON.stringify(body), ...extra }, { secret: SECRET, fields: { id: 'person.code', time: 'when' }, name: 'cloud', offset: '+05:30', enqueue: (scans) => got.push(...scans), ...(extra.options ?? {}) });
  return { ...result, json: JSON.parse(result.body), got };
};

test('reading a field from nested data', () => {
  assert.equal(pick({ a: { b: [{ c: 5 }] } }, 'a.b.0.c'), 5);
  assert.equal(pick({ a: null }, 'a.b'), undefined);
});

test('times as systems send them', () => {
  assert.equal(readWhen('2026-11-09T09:25:00+05:30', '+05:30'), '2026-11-09T03:55:00.000Z');
  assert.equal(readWhen('2026-11-09T03:55:00Z', '+05:30'), '2026-11-09T03:55:00.000Z');
  assert.equal(readWhen('2026-11-09 09:25:00', '+05:30'), '2026-11-09T03:55:00.000Z', 'no zone: the college’s');
  assert.equal(readWhen('09/11/2026 9:25 AM', '+05:30'), '2026-11-09T03:55:00.000Z');
  assert.equal(readWhen(1794203700, '+05:30'), new Date(1794203700000).toISOString(), 'seconds');
  assert.equal(readWhen(1794203700000, '+05:30'), new Date(1794203700000).toISOString(), 'milliseconds');
  assert.equal(readWhen('1794203700', '+05:30'), new Date(1794203700000).toISOString());
  assert.equal(readWhen('soon', '+05:30'), null);
  assert.equal(readWhen(undefined, '+05:30'), null);
});

test('a webhook takes one punch, or a list, with the fields you name', () => {
  const one = hook({ person: { code: 'A01' }, when: '2026-11-09 09:25:00' });
  assert.equal(one.status, 200);
  assert.deepEqual(one.got.map((s) => [s.identifier, s.at]), [['A01', '2026-11-09T03:55:00.000Z']]);
  const many = hook([{ person: { code: 1023 }, when: '2026-11-09 09:25:00' }, { person: {}, when: 'x' }]);
  assert.equal(many.got[0].identifier, '1023', 'numbers become text');
  assert.deepEqual(many.json, { received: 1, unreadable: [1] });
  const listed = hook({ data: { events: [{ person: { code: 'A02' }, when: '2026-11-09 09:30' }] } }, { options: { fields: { id: 'person.code', time: 'when', list: 'data.events' } } });
  assert.equal(listed.got[0].identifier, 'A02');
});

test('the same punch sent twice gets the same id', () => {
  const body = { person: { code: 'A01' }, when: '2026-11-09 09:25:00' };
  assert.equal(hook(body).got[0].scanId, hook(body).got[0].scanId);
});

test('a webhook refuses the wrong secret, the wrong path, and nonsense', () => {
  assert.equal(hook({}, { headers: {} }).status, 401);
  assert.equal(hook({}, { headers: { 'x-bridge-secret': 'nope' } }).status, 401);
  assert.equal(hook({ person: { code: 'A01' }, when: '2026-11-09 09:25' }, { headers: { authorization: `Bearer ${SECRET}` } }).status, 200, 'a bearer token works too');
  assert.equal(hook({}, { path: '/other' }).status, 404);
  assert.equal(hook({}, { method: 'GET' }).status, 405);
  assert.equal(hook({}, { body: '{not json' }).status, 400);
  assert.equal(hook([{ when: 'x' }]).status, 400, 'nothing readable at all');
  assert.equal(hook({ data: 5 }, { options: { fields: { id: 'id', list: 'data' } } }).status, 400);
});

test('a webhook won’t start without a proper secret and fields', () => {
  const context = { enqueue() {}, log() {}, offset: '+05:30' };
  assert.throws(() => createWebhookSource({ secret: 'short', fields: { id: 'id' } }, context), /16 characters/);
  assert.throws(() => createWebhookSource({ secret: SECRET }, context), /fields/);
});

test('a real webhook server, over the network', async () => {
  const got = [];
  const source = createWebhookSource({ port: 0, secret: SECRET, fields: { id: 'id', time: 'time' } }, { enqueue: (s) => got.push(...s), log() {}, offset: '+05:30' });
  await source.start();
  const response = await fetch(`http://127.0.0.1:${source.port()}/punch`, { method: 'POST', headers: { 'X-Bridge-Secret': SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'A01', time: '2026-11-09 09:25' }) });
  assert.equal(response.status, 200);
  const huge = await fetch(`http://127.0.0.1:${source.port()}/punch`, { method: 'POST', headers: { 'X-Bridge-Secret': SECRET }, body: 'x'.repeat(2 * 1024 * 1024) }).catch(() => ({ status: 413 }));
  assert.equal(huge.status, 413);
  await source.stop();
  assert.equal(got.length, 1);
});

/* ---------- Folder ---------- */

test('a folder: new files are read, growing logs send only what’s new, other files are ignored', () => {
  const folder = mkdtempSync(path.join(dir, 'f-'));
  const state = {};
  const got = [];
  const options = { enqueue: (s) => got.push(...s), offset: '+05:30', name: 'export' };
  writeFileSync(path.join(folder, 'log.csv'), `Emp Code,Punch Time\nA01,${local(3600000)}\n`);
  writeFileSync(path.join(folder, 'notes.docx'), 'ignored');
  assert.equal(scanFolder(folder, state, options), 1);
  assert.equal(scanFolder(folder, state, options), 0, 'nothing changed');
  appendFileSync(path.join(folder, 'log.csv'), `A02,${local(1800000)}\n`);
  assert.equal(scanFolder(folder, state, options), 1);
  assert.deepEqual(got.map((s) => s.identifier), ['A01', 'A02']);
  // The software starts a new, shorter file under the same name.
  writeFileSync(path.join(folder, 'log.csv'), `Emp Code,Punch Time\nA03,${local(600000)}\n`);
  assert.equal(scanFolder(folder, state, options), 1);
  assert.equal(got.at(-1).identifier, 'A03');
});

test('a folder leaves out punches too old for TimeFlex to accept, and says so', () => {
  const folder = mkdtempSync(path.join(dir, 'f-'));
  const notes = [];
  const got = [];
  writeFileSync(path.join(folder, 'attlog.dat'), `A01\t${local(20 * 86400000)}\t1\t0\nA02\t${local(60000)}\t1\t0\n`);
  scanFolder(folder, {}, { enqueue: (s) => got.push(...s), offset: '+05:30', name: 'usb', log: (m) => notes.push(m) });
  assert.deepEqual(got.map((s) => s.identifier), ['A02']);
  assert.match(notes.join(' '), /over 13 days old/);
});

test('a folder source remembers what it sent across restarts', async () => {
  const folder = mkdtempSync(path.join(dir, 'f-'));
  const stateFile = path.join(dir, `state-${Date.now()}`);
  writeFileSync(path.join(folder, 'a.csv'), `A01,${local(60000)}\n`);
  const got = [];
  const context = { enqueue: (s) => got.push(...s), log() {}, offset: '+05:30', stateFile };
  createFolderSource({ path: folder }, context).check();
  createFolderSource({ path: folder }, context).check();
  assert.equal(got.length, 1);
  assert.throws(() => createFolderSource({ path: path.join(dir, 'missing') }, context), /doesn’t exist|doesn't exist/);
});

/* ---------- Push machines and settings ---------- */

test('the push-machine source answers a machine over the network', async () => {
  const got = [];
  const source = createAdmsSource({ port: 0, serials: ['SN1'] }, { enqueue: (s) => got.push(...s), log() {}, offset: '+05:30' });
  await source.start();
  const at = local(60000);
  const ok = await fetch(`http://127.0.0.1:${source.port()}/iclock/cdata?SN=SN1&table=ATTLOG`, { method: 'POST', body: `A01\t${at}\t0\t1` });
  assert.equal(await ok.text(), 'OK: 1');
  const stranger = await fetch(`http://127.0.0.1:${source.port()}/iclock/cdata?SN=EVIL&table=ATTLOG`, { method: 'POST', body: `A01\t${at}\t0\t1` });
  assert.equal(stranger.status, 403);
  await source.stop();
  assert.equal(got.length, 1);
});

test('a one-off file uses the same reader as everything else', () => {
  assert.deepEqual(parseCsv('A01,09/11/2026 08:50 AM'), [{ pin: 'A01', time: '2026-11-09 08:50:00' }]);
});

test('settings: the simple case from the environment, several sources from a file', () => {
  const simple = loadConfig({ TIMEFLEX_URL: 'http://x', TIMEFLEX_DEVICE_KEY: 'tfd_k', ALLOWED_SERIALS: 'A, B' });
  assert.deepEqual(simple.sources, [{ type: 'zkteco-adms', port: 8081, serials: ['A', 'B'] }]);
  assert.equal(simple.offset, '+05:30');
  const file = path.join(dir, 'bridge.config.json');
  writeFileSync(file, JSON.stringify({ timeflexUrl: 'http://y', utcOffset: '+04:00', sources: [{ type: 'folder', path: dir }, { type: 'webhook', secret: SECRET, fields: { id: 'id' } }] }));
  const many = loadConfig({ BRIDGE_CONFIG: file, TIMEFLEX_DEVICE_KEY: 'tfd_k' });
  assert.equal(many.url, 'http://y');
  assert.deepEqual(many.sources.map((s) => s.type), ['folder', 'webhook']);
  assert.throws(() => loadConfig({}), /TIMEFLEX_URL/);
  assert.throws(() => loadConfig({ TIMEFLEX_URL: 'x', TIMEFLEX_DEVICE_KEY: 'k', COLLEGE_UTC_OFFSET: 'IST' }), /\+05:30/);
  writeFileSync(file, JSON.stringify({ sources: [{ type: 'carrier-pigeon' }] }));
  assert.throws(() => loadConfig({ BRIDGE_CONFIG: file, TIMEFLEX_URL: 'x', TIMEFLEX_DEVICE_KEY: 'k' }), /must be one of/);
  writeFileSync(file, '{oops');
  assert.throws(() => loadConfig({ BRIDGE_CONFIG: file, TIMEFLEX_URL: 'x', TIMEFLEX_DEVICE_KEY: 'k' }), /valid JSON/);
  assert.throws(() => loadConfig({ BRIDGE_CONFIG: path.join(dir, 'nope.json') }), /doesn't exist/);
});
