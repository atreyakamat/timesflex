import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { createFileStore } from '../src/db.js';
import { toWhatsAppNumber } from '../src/whatsapp.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-notices-'));
const store = await createFileStore(path.join(dir, 'data.json'));
const sent = [];
let failNext = false;
let nextMessage = 0;
let lastId = '';
const send = async (message) => {
  if (failNext) {
    failNext = false;
    throw new Error('WhatsApp did not accept this message.');
  }
  sent.push(message);
  nextMessage += 1;
  lastId = `wamid.${nextMessage}`;
  return lastId;
};
const server = createApp({ store, solve: async () => ({}), send }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const SECRET = 'test-app-secret';
const saved = { ...process.env };

test.after(() => {
  server.close();
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(() => {
  process.env.WHATSAPP_TOKEN = 'token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
  sent.length = 0;
});

const call = async (method, url, { body, token, raw, headers } = {}) => {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON.
  }
  return { status: response.status, body: json, text };
};
let counter = 0;
const college = async (teachers = [{ id: 't1', name: 'Prof. Mehta', phone: '98765 43210' }, { id: 't2', name: 'Dr. Rao' }]) => {
  counter += 1;
  const { body } = await call('POST', '/api/auth/signup', { body: { name: 'C', email: `c${counter}@example.test`, password: 'password-1234', institutionName: `College ${counter}` } });
  await call('PUT', `/api/institutions/${body.institution.id}`, { token: body.token, body: { name: `College ${counter}`, type: 'college', profile: { teachers } } });
  return { token: body.token, id: body.institution.id };
};
const person = (teacherId, text = 'Hello\n\nDBMS moved') => ({ teacherId, name: 'ignored', text, summary: 'DBMS moved' });
const createNotice = (c, recipients = [person('t1'), person('t2')]) => call('POST', `/api/institutions/${c.id}/notices`, { token: c.token, body: { title: 'Changes', kind: 'timetable', groupText: 'Group', recipients } });
const signed = (payload) => {
  const raw = JSON.stringify(payload);
  return { raw, headers: { 'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` } };
};
const statusPayload = (id, status, extra = {}) => ({ object: 'whatsapp_business_account', entry: [{ id: 'x', changes: [{ field: 'messages', value: { statuses: [{ id, status, timestamp: '1', recipient_id: '1', ...extra }] } }] }] });

test('phone numbers become international, and junk is refused', () => {
  assert.equal(toWhatsAppNumber('98765 43210'), '+919876543210');
  assert.equal(toWhatsAppNumber('+1 650 555 1234'), '+16505551234');
  assert.equal(toWhatsAppNumber('12345'), null);
  assert.equal(toWhatsAppNumber(undefined), null);
});

test('an update is kept per teacher, with names from the college’s own records', async () => {
  const c = await college();
  const { status, body } = await createNotice(c);
  assert.equal(status, 201);
  assert.deepEqual(body.recipients.map((r) => [r.name, r.status]), [['Prof. Mehta', 'pending'], ['Dr. Rao', 'pending']]);
  const list = await call('GET', `/api/institutions/${c.id}/notices`, { token: c.token });
  assert.equal(list.body[0].id, body.id);
});

test('nobody outside the college’s teachers can be a recipient', async () => {
  const c = await college();
  const { status } = await createNotice(c, [person('stranger')]);
  assert.equal(status, 400);
});

test('another college cannot read, change or send an update', async () => {
  const c = await college();
  const other = await college();
  const { body } = await createNotice(c);
  assert.equal((await call('GET', `/api/institutions/${c.id}/notices`, { token: other.token })).status, 404);
  assert.equal((await call('PUT', `/api/notices/${body.id}/recipients/t1`, { token: other.token, body: { status: 'sent' } })).status, 404);
  assert.equal((await call('PUT', `/api/notices/${body.id}/group`, { token: other.token, body: { shared: true } })).status, 404);
  assert.equal((await call('POST', `/api/notices/${body.id}/send`, { token: other.token })).status, 404);
  assert.equal(sent.length, 0);
});

test('sending uses the saved number, and marks who has none', async () => {
  const c = await college();
  const { body } = await createNotice(c);
  const result = await call('POST', `/api/notices/${body.id}/send`, { token: c.token, body: { phone: '+10000000000' } });
  assert.equal(result.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+919876543210');
  assert.equal(result.body.recipients[0].status, 'sent');
  assert.equal(result.body.recipients[1].status, 'failed');
  assert.match(result.body.recipients[1].error, /No WhatsApp number/);
});

test('sending again only reaches those not reached, and a failure can be retried', async () => {
  const c = await college([{ id: 't1', name: 'A', phone: '9876543210' }, { id: 't2', name: 'B', phone: '9876543211' }]);
  const { body } = await createNotice(c);
  failNext = true;
  const first = await call('POST', `/api/notices/${body.id}/send`, { token: c.token });
  assert.deepEqual(first.body.recipients.map((r) => r.status), ['failed', 'sent']);
  assert.equal(sent.length, 1);
  const second = await call('POST', `/api/notices/${body.id}/send`, { token: c.token });
  assert.deepEqual(second.body.recipients.map((r) => r.status), ['sent', 'sent']);
  assert.equal(sent.length, 2);
  assert.equal(second.body.recipients[0].error, undefined);
});

test('without keys, sending is refused and marking by hand still works', async () => {
  delete process.env.WHATSAPP_TOKEN;
  const c = await college();
  const { body } = await createNotice(c);
  assert.equal((await call('GET', '/api/notify/status', { token: c.token })).body.whatsappApi, false);
  assert.equal((await call('POST', `/api/notices/${body.id}/send`, { token: c.token })).status, 409);
  const opened = await call('PUT', `/api/notices/${body.id}/recipients/t1`, { token: c.token, body: { status: 'opened' } });
  assert.equal(opened.body.recipients[0].status, 'opened');
  const done = await call('PUT', `/api/notices/${body.id}/recipients/t1`, { token: c.token, body: { status: 'sent' } });
  assert.equal(done.body.recipients[0].status, 'sent');
  assert.equal((await call('PUT', `/api/notices/${body.id}/recipients/t1`, { token: c.token, body: { status: 'read' } })).status, 400);
});

test('the demo cannot send real messages', async () => {
  const { body: demo } = await call('POST', '/api/auth/demo', { body: {} });
  await call('PUT', `/api/institutions/${demo.institution.id}`, { token: demo.token, body: { name: 'D', type: 'college', profile: { teachers: [{ id: 't1', name: 'T', phone: '9876543210' }] } } });
  const { body } = await createNotice({ id: demo.institution.id, token: demo.token }, [person('t1')]);
  assert.equal((await call('POST', `/api/notices/${body.id}/send`, { token: demo.token })).status, 403);
  assert.equal(sent.length, 0);
});

test('the webhook handshake needs the right token', async () => {
  const ok = await call('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc');
  assert.equal(ok.status, 200);
  assert.equal(ok.text, 'abc');
  assert.equal((await call('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc')).status, 403);
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  assert.equal((await call('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=abc')).status, 403);
});

test('delivery updates need a valid signature, only move forward, and can repeat', async () => {
  const c = await college([{ id: 't1', name: 'A', phone: '9876543210' }]);
  const { body } = await createNotice(c, [person('t1')]);
  await call('POST', `/api/notices/${body.id}/send`, { token: c.token });
  const id = lastId;
  const statusNow = async () => (await call('GET', `/api/institutions/${c.id}/notices`, { token: c.token })).body[0].recipients[0];

  assert.equal((await call('POST', '/api/webhooks/whatsapp', { raw: JSON.stringify(statusPayload(id, 'read')), headers: { 'X-Hub-Signature-256': 'sha256=bad' } })).status, 401);
  assert.equal((await call('POST', '/api/webhooks/whatsapp', { raw: JSON.stringify(statusPayload(id, 'read')) })).status, 401);
  assert.equal((await statusNow()).status, 'sent');

  const post = async (payload) => {
    const s = signed(payload);
    assert.equal((await call('POST', '/api/webhooks/whatsapp', s)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 60));
  };
  await post(statusPayload(id, 'read'));
  assert.equal((await statusNow()).status, 'read');
  await post(statusPayload(id, 'delivered'));
  assert.equal((await statusNow()).status, 'read');
  await post(statusPayload('wamid.unknown', 'read'));
});

test('a failed delivery is shown, and Meta’s raw error text is not', async () => {
  const c = await college([{ id: 't1', name: 'A', phone: '9876543210' }]);
  const { body } = await createNotice(c, [person('t1')]);
  await call('POST', `/api/notices/${body.id}/send`, { token: c.token });
  const s = signed(statusPayload(lastId, 'failed', { errors: [{ code: 131049, title: 'internal detail' }] }));
  await call('POST', '/api/webhooks/whatsapp', s);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const [person0] = (await call('GET', `/api/institutions/${c.id}/notices`, { token: c.token })).body[0].recipients;
  assert.equal(person0.status, 'failed');
  assert.match(person0.error, /could not deliver/);
  assert.doesNotMatch(person0.error, /internal detail/);
});

test('deleting an account removes its updates', async () => {
  const c = await college();
  const { body } = await createNotice(c);
  assert.ok(await store.getNotice(body.id));
  await call('DELETE', '/api/auth/account', { token: c.token, body: { password: 'password-1234' } });
  assert.equal(await store.getNotice(body.id), null);
});

test('moving a class keeps an approved timetable approved', async () => {
  const c = await college();
  const { body: tt } = await call('POST', `/api/institutions/${c.id}/timetables`, { token: c.token, body: { label: 'V', request: { days: ['Monday'], slots: ['a'], sessions: [] } } });
  await call('PUT', `/api/timetables/${tt.id}`, { token: c.token, body: { status: 'approved' } });
  const moved = await call('PUT', `/api/timetables/${tt.id}`, { token: c.token, body: { generatedSessions: [] } });
  assert.equal(moved.body.status, 'approved');
});
