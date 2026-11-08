import express from 'express';
import { nanoid } from 'nanoid';

import { DEMO_DOMAIN, createRateLimiter } from './auth.js';
import { LIMITS } from './validate.js';
import { sendWhatsAppTemplate, statusesIn, toWhatsAppNumber, validSignature, whatsappConfig, whatsappEnabled } from './whatsapp.js';

const KEEP_NOTICES = 100;
const MANUAL = ['pending', 'opened', 'sent', 'skipped'];
/** Delivery only moves forward: webhooks can repeat and arrive out of order. */
const RANK = { pending: 0, opened: 0, sent: 1, delivered: 2, read: 3, skipped: 4 };
/** "Sent" only means Meta accepted it, so a later failure must still show. Once delivered, it can't fail. */
const canBecome = (current, next) => (next === 'failed' ? (RANK[current] ?? 0) <= RANK.sent : (RANK[next] ?? -1) > (RANK[current] ?? 0));
const DAY = 24 * 60 * 60 * 1000;

const teachersOf = (institution) => (institution.data?.profile ?? institution.data ?? {}).teachers ?? [];
const publicNotice = ({ institutionId, ...notice }) => notice;

/** Changes to one notice run one at a time, so a webhook and a tap can't overwrite each other. */
const queues = new Map();
const inTurn = (id, job) => {
  const run = (queues.get(id) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  queues.set(id, tail);
  tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return run;
};

/** The public webhook Meta calls with delivery updates. Mounted before any body parsing. */
export const mountWhatsAppWebhook = (app, { store }) => {
  app.get('/api/webhooks/whatsapp', (request, response) => {
    const { verifyToken } = whatsappConfig();
    const ok = verifyToken && request.query['hub.mode'] === 'subscribe' && request.query['hub.verify_token'] === verifyToken;
    if (!ok) return response.sendStatus(403);
    response.type('text/plain').send(String(request.query['hub.challenge'] ?? ''));
  });

  app.post('/api/webhooks/whatsapp', express.raw({ type: '*/*', limit: '4mb' }), async (request, response) => {
    if (!validSignature(request.body, request.get('x-hub-signature-256'))) return response.sendStatus(401);
    response.sendStatus(200);
    try {
      for (const status of statusesIn(JSON.parse(request.body.toString('utf8')))) {
        const link = await store.findMessageLink(status.id);
        if (!link) continue;
        await inTurn(link.noticeId, async () => {
          const notice = await store.getNotice(link.noticeId);
          const person = notice?.recipients.find((r) => r.teacherId === link.teacherId);
          if (!person || !canBecome(person.status, status.status)) return;
          person.status = status.status;
          person.updatedAt = new Date().toISOString();
          if (status.status === 'failed') {
            console.warn('WhatsApp delivery failed:', status.errors?.[0]?.code, status.errors?.[0]?.title);
            person.error = 'WhatsApp could not deliver this. Send it by hand, or check the number.';
          } else delete person.error;
          await store.updateNotice(notice.id, notice);
        });
      }
    } catch (error) {
      console.error('WhatsApp webhook:', error.message);
    }
  });
};

/** Routes for the Updates screen. Mounted after the session check and body parser. */
export const mountNotices = (app, { store, route, fail, ownedInstitution, send = sendWhatsAppTemplate, limits = {} }) => {
  const createLimiter = limits.noticeCreate ?? createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });
  const sendLimiter = limits.noticeSend ?? createRateLimiter({ limit: 300, windowMs: DAY });
  const sending = new Set();

  /** The notice, if it belongs to this account's institution. */
  const ownedNotice = async (request, id) => {
    const notice = await store.getNotice(id);
    return notice && (await ownedInstitution(request, notice.institutionId)) ? notice : null;
  };

  app.get('/api/notify/status', route(async (request, response) => {
    response.json({ whatsappApi: whatsappEnabled() });
  }));

  app.get('/api/institutions/:id/notices', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return fail(response, 404, 'Institution not found');
    response.json((await store.listNotices(institution.id, 30)).map(publicNotice));
  }));

  app.post('/api/institutions/:id/notices', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return fail(response, 404, 'Institution not found');
    if (!createLimiter.take(request.account.id)) return fail(response, 429, 'That is a lot of updates in a short time. Give it a while.');

    const { title, kind, groupText, recipients } = request.body ?? {};
    if (typeof title !== 'string' || !title.trim() || title.length > LIMITS.label) return fail(response, 400, 'title is required');
    if (!['timetable', 'cover'].includes(kind)) return fail(response, 400, 'kind must be timetable or cover');
    if (typeof groupText !== 'string' || groupText.length > LIMITS.noticeText * 4) return fail(response, 400, 'groupText is too long');
    if (!Array.isArray(recipients) || recipients.length > LIMITS.noticeRecipients) return fail(response, 400, 'recipients must be a list');

    // Only this college's own teachers can receive anything. Names come from its records.
    const teachers = new Map(teachersOf(institution).map((teacher) => [teacher.id, teacher]));
    const people = [];
    for (const person of recipients) {
      const teacher = teachers.get(person?.teacherId);
      if (!teacher) return fail(response, 400, 'Every recipient must be one of your teachers. Wait a moment for changes to save, then try again.');
      if (typeof person.text !== 'string' || !person.text.trim() || person.text.length > LIMITS.noticeText) return fail(response, 400, 'Each message must be under 8000 characters');
      if (typeof person.summary !== 'string' || person.summary.length > LIMITS.noticeText) return fail(response, 400, 'summary is too long');
      if (!people.some((p) => p.teacherId === teacher.id)) {
        people.push({ teacherId: teacher.id, name: teacher.name, text: person.text, summary: person.summary, headline: String(person.headline ?? '').slice(0, 160), status: 'pending' });
      }
    }
    const notice = await store.createNotice({
      id: nanoid(),
      institutionId: institution.id,
      title: title.trim(),
      kind,
      groupText,
      createdAt: new Date().toISOString(),
      recipients: people,
    });
    await store.pruneNotices(institution.id, KEEP_NOTICES);
    response.status(201).json(publicNotice(notice));
  }));

  // The coordinator's own record of what they did by hand.
  app.put('/api/notices/:id/recipients/:teacherId', route(async (request, response) => {
    const { status } = request.body ?? {};
    if (!MANUAL.includes(status)) return fail(response, 400, `status must be one of ${MANUAL.join(', ')}`);
    if (!(await ownedNotice(request, request.params.id))) return fail(response, 404, 'Update not found');
    const notice = await inTurn(request.params.id, async () => {
      const fresh = await store.getNotice(request.params.id);
      const person = fresh.recipients.find((r) => r.teacherId === request.params.teacherId);
      if (!person) return null;
      Object.assign(person, { status, via: 'link', updatedAt: new Date().toISOString() });
      delete person.error;
      await store.updateNotice(fresh.id, fresh);
      return fresh;
    });
    if (!notice) return fail(response, 404, 'That teacher is not on this update');
    response.json(publicNotice(notice));
  }));

  app.put('/api/notices/:id/group', route(async (request, response) => {
    if (!(await ownedNotice(request, request.params.id))) return fail(response, 404, 'Update not found');
    const notice = await inTurn(request.params.id, async () => {
      const fresh = await store.getNotice(request.params.id);
      fresh.groupShared = request.body?.shared === true;
      await store.updateNotice(fresh.id, fresh);
      return fresh;
    });
    response.json(publicNotice(notice));
  }));

  // Sends whoever hasn't been reached yet, so pressing it again is safe.
  app.post('/api/notices/:id/send', route(async (request, response) => {
    if (!whatsappEnabled()) return fail(response, 409, 'WhatsApp sending is not set up on this server.');
    // Throwaway accounts must not be a way to message people at this server's expense.
    if (request.account.email.endsWith(DEMO_DOMAIN)) return fail(response, 403, 'The live demo cannot send real messages.');
    const owned = await ownedNotice(request, request.params.id);
    if (!owned) return fail(response, 404, 'Update not found');
    if (sending.has(owned.id)) return fail(response, 409, 'This update is already being sent.');

    sending.add(owned.id);
    try {
      const institution = await store.getInstitution(owned.institutionId);
      // Numbers come from the college's saved records, never from the request.
      const teachers = new Map(teachersOf(institution).map((teacher) => [teacher.id, teacher]));
      for (const { teacherId } of owned.recipients.filter((r) => r.status === 'pending' || r.status === 'failed' || r.status === 'opened')) {
        const person = (await store.getNotice(owned.id)).recipients.find((r) => r.teacherId === teacherId);
        const to = toWhatsAppNumber(teachers.get(teacherId)?.phone);
        let update;
        if (!to) update = { status: 'failed', error: 'No WhatsApp number saved for this teacher.' };
        else if (!sendLimiter.take(request.account.id)) update = { status: 'failed', error: 'Daily sending limit reached. Try again tomorrow.' };
        else {
          try {
            const messageId = await send({ to, name: person.name, institution: institution.name, summary: person.summary });
            await store.linkMessage(messageId, owned.id, teacherId);
            update = { status: 'sent', via: 'api', error: undefined };
          } catch (error) {
            update = { status: 'failed', error: error.name === 'Error' ? error.message : 'Could not reach WhatsApp. Try again.' };
          }
        }
        await inTurn(owned.id, async () => {
          const fresh = await store.getNotice(owned.id);
          const target = fresh.recipients.find((r) => r.teacherId === teacherId);
          // A delivery webhook may already have moved this further along.
          if (canBecome(target.status, update.status)) Object.assign(target, update, { updatedAt: new Date().toISOString() });
          if (target.error === undefined) delete target.error;
          await store.updateNotice(fresh.id, fresh);
        });
      }
    } finally {
      sending.delete(owned.id);
    }
    response.json(publicNotice(await store.getNotice(owned.id)));
  }));
};
