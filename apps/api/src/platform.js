import { nanoid } from 'nanoid';

import { DEMO_DOMAIN } from './auth.js';
import { createInvite, profileOf } from './members.js';
import { LIMITS, cleanText } from './validate.js';

const TYPES = ['school', 'college', 'university'];
const STATUSES = ['active', 'paused'];

/** Where a college is on the way to using the product. */
export const collegeStage = (institution, timetableStatuses, sharedUpdates) => {
  if (!institution.ownerId) return 'invited';
  const profile = profileOf(institution);
  if (!profile.divisions?.length || !profile.subjects?.length || !profile.teachers?.length) return 'setting_up';
  if (!timetableStatuses.length) return 'ready';
  if (!timetableStatuses.includes('approved')) return 'built';
  return sharedUpdates ? 'live' : 'approved';
};

/** The central admin's view across colleges: names, counts and progress, never people's details. */
export const mountPlatform = (app, { store, route, fail }) => {
  // Hidden rather than forbidden: nobody else learns this exists.
  const operator = (handler) => route(async (request, response) => {
    if (!request.account.platformAdmin) return fail(response, 404, 'Page not found');
    return handler(request, response);
  });

  const summary = async (institution) => {
    const owner = institution.ownerId ? await store.getAccount(institution.ownerId) : null;
    if (owner?.email.endsWith(DEMO_DOMAIN)) return null;
    const profile = profileOf(institution);
    const divisions = profile.divisions ?? [];
    const statuses = await store.timetableStatuses(institution.id);
    const notices = await store.listNotices(institution.id, 50);
    const shared = notices.filter((notice) => notice.recipients.some((r) => ['sent', 'delivered', 'read'].includes(r.status))).length;
    const members = await store.listMembers(institution.id);
    return {
      id: institution.id,
      name: institution.name,
      type: institution.type,
      status: institution.status ?? 'active',
      contact: institution.contact ?? null,
      createdAt: institution.createdAt,
      updatedAt: institution.updatedAt,
      adminEmail: owner?.email ?? null,
      stage: collegeStage(institution, statuses, shared),
      counts: {
        classes: divisions.length,
        teachers: profile.teachers?.length ?? 0,
        subjects: profile.subjects?.length ?? 0,
        students: divisions.reduce((sum, d) => sum + (d.students?.length || d.size || 0), 0),
        rooms: profile.rooms?.length ?? 0,
        members: members.length + (owner ? 1 : 0),
      },
    };
  };

  app.get('/api/platform/colleges', operator(async (request, response) => {
    const rows = await Promise.all((await store.listAllInstitutions()).map(summary));
    response.json(rows.filter(Boolean));
  }));

  app.post('/api/platform/colleges', operator(async (request, response) => {
    const { name, type, contact } = request.body ?? {};
    const cleanName = cleanText(name, LIMITS.institutionName);
    if (!cleanName) return fail(response, 400, `A name is required (at most ${LIMITS.institutionName} characters)`);
    if (!TYPES.includes(type)) return fail(response, 400, `Type must be one of ${TYPES.join(', ')}`);
    if (contact !== undefined && (typeof contact !== 'string' || contact.length > 200)) return fail(response, 400, 'Contact can be at most 200 characters');
    const institution = await store.createInstitution({
      id: nanoid(),
      ownerId: null,
      name: cleanName,
      type,
      contact: contact?.trim() || null,
      data: { profile: { institution: { name: cleanName, type } } },
    });
    const invite = await createInvite(store, { institutionId: institution.id, role: 'admin', createdBy: request.account.id });
    response.status(201).json({ id: institution.id, name: cleanName, code: invite.code, expiresAt: invite.expiresAt });
  }));

  app.post('/api/platform/colleges/:id/invite', operator(async (request, response) => {
    const institution = await store.getInstitution(request.params.id);
    if (!institution) return fail(response, 404, 'College not found');
    const invite = await createInvite(store, { institutionId: institution.id, role: 'admin', createdBy: request.account.id });
    response.status(201).json({ code: invite.code, expiresAt: invite.expiresAt });
  }));

  app.put('/api/platform/colleges/:id', operator(async (request, response) => {
    const { status } = request.body ?? {};
    if (!STATUSES.includes(status)) return fail(response, 400, `status must be one of ${STATUSES.join(', ')}`);
    const institution = await store.getInstitution(request.params.id);
    if (!institution) return fail(response, 404, 'College not found');
    await store.setInstitutionFields(institution.id, { status });
    response.json({ success: true, status });
  }));
};
