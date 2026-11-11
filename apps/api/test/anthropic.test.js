import assert from 'node:assert/strict';
import test from 'node:test';

import Anthropic from '@anthropic-ai/sdk';

import { claudeJson, setClaudeClient, toStrictSchema } from '../src/anthropic.js';
import { interpretCommand } from '../src/intent.js';
import { aiConfig, extractJson } from '../src/llm.js';
import { parseRequirements } from '../src/parser.js';

/** A stand-in for the SDK client: records requests, replies with queued responses. */
const fakeClient = (...replies) => {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (request) => {
          calls.push(request);
          const next = replies.shift();
          if (next instanceof Error) throw next;
          return next;
        },
      },
    },
  };
};
const reply = (json, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(json) }] });

const withKey = async (fn) => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, provider: process.env.AI_PROVIDER, model: process.env.AI_MODEL };
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  try {
    await fn();
  } finally {
    for (const [name, value] of [['ANTHROPIC_API_KEY', saved.key], ['AI_PROVIDER', saved.provider], ['AI_MODEL', saved.model]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    setClaudeClient(null);
  }
};

test('a key alone switches the assistant to Claude Sonnet 5.5', async () => {
  await withKey(async () => {
    const config = aiConfig();
    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, 'claude-sonnet-5-5');
  });
  // Without a key the local model stays the default.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_PROVIDER) assert.equal(aiConfig().provider, 'ollama');
});

test('schemas become strict: closed objects, every field required, nullable as anyOf', () => {
  const strict = toStrictSchema({
    type: 'object',
    properties: {
      name: { type: ['string', 'null'] },
      tags: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
      style: { type: ['string', 'null'], enum: ['a', 'b', null] },
    },
    required: ['name'],
  });
  assert.deepEqual(strict.required, ['name', 'tags', 'style']);
  assert.equal(strict.additionalProperties, false);
  assert.deepEqual(strict.properties.name, { anyOf: [{ type: 'string' }, { type: 'null' }] });
  assert.equal(strict.properties.tags.items.additionalProperties, false);
  assert.deepEqual(strict.properties.style.anyOf[0], { type: 'string', enum: ['a', 'b'] });
});

test('claudeJson sends structured output, low effort and the refusal fallback', async () => {
  const client = fakeClient(reply({ intent: 'absent', teacher: 'Mehta' }));
  setClaudeClient(client);
  const result = await claudeJson({ system: 's', user: 'u', schema: { type: 'object', properties: { intent: { type: 'string' } } }, extractJson });
  assert.deepEqual(result, { intent: 'absent', teacher: 'Mehta' });
  const [request] = client.calls;
  assert.equal(request.model, 'claude-sonnet-5-5');
  assert.equal(request.fallbacks, 'default');
  assert.deepEqual(request.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(request.output_config.effort, 'low');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.equal(request.output_config.format.schema.additionalProperties, false);
  setClaudeClient(null);
});

test('a rejected schema retries without it; a refusal is reported, not parsed', async () => {
  const badRequest = Object.assign(Object.create(Anthropic.BadRequestError.prototype), { message: 'schema not supported' });
  const client = fakeClient(badRequest, reply({ ok: true }));
  setClaudeClient(client);
  assert.deepEqual(await claudeJson({ system: 's', user: 'u', schema: { type: 'object' }, extractJson }), { ok: true });
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].output_config.format, undefined);
  assert.match(client.calls[1].system, /JSON schema/);

  setClaudeClient(fakeClient({ stop_reason: 'refusal', stop_details: { category: 'general_harms' }, content: [] }));
  await assert.rejects(claudeJson({ system: 's', user: 'u', schema: { type: 'object' }, extractJson }), /declined/);
  setClaudeClient(null);
});

test('the assistant and "describe it" both run through Claude when a key is set', async () => {
  await withKey(async () => {
    setClaudeClient(fakeClient(reply({ intent: 'leave', teacher: 'Mehta', date_from: 'Monday', date_to: 'Wednesday', expertise: [] })));
    const interpreted = await interpretCommand('Mehta will be away at a conference early next week', { teachers: ['Prof. Mehta'] });
    assert.equal(interpreted.source, 'llm');
    assert.equal(interpreted.intent.intent, 'leave');

    const draft = {
      institution: { name: null, workingDays: ['Monday', 'Tuesday'], startTime: '09:00', endTime: '13:00', slotDurationMinutes: 60, breakAfterSlots: null, breakDurationMinutes: null },
      divisions: [{ name: 'SE-A', batches: [] }],
      teachers: [{ name: 'Prof. Mehta', maxLecturesPerDay: 3, maxLecturesPerWeek: null, unavailableDays: [] }],
      rooms: [],
      subjects: [{ name: 'DBMS', isLab: false, sessionsPerWeek: 3, durationSlots: 1, teacher: 'Prof. Mehta', room: null }],
    };
    setClaudeClient(fakeClient(reply(draft)));
    const parsed = await parseRequirements('Mon and Tue, 9 to 1. SE-A. Prof. Mehta teaches DBMS 3 times a week, max 3 a day.');
    assert.equal(parsed.source, 'llm');
    assert.ok(parsed.draft.subjects.some((s) => s.name === 'DBMS' && s.teacher === 'Prof. Mehta'));
  });
});
