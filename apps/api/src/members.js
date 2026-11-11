import { nanoid } from 'nanoid';

import { DEMO_DOMAIN, MAX_PASSWORD, MIN_PASSWORD, hashPassword, hashToken, isValidEmail, newToken, normalizeEmail, verifyPassword } from './auth.js';
import { DuplicateEmailError } from './db.js';
import { LIMITS, cleanText } from './validate.js';

const INVITE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export const profileOf = (institution) => institution?.data?.profile ?? institution?.data ?? {};

/** Makes a one-use invite. Only its hash is stored, so the code can be shown just this once. */
export const createInvite = async (store, { institutionId, role, teacherId = null, createdBy }) => {
  await store.deleteUnusedInvites(institutionId, teacherId);
  const code = newToken();
  const invite = {
    id: nanoid(),
    tokenHash: hashToken(code),
    institutionId,
    role,
    teacherId,
    createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_DAYS * DAY).toISOString(),
    usedAt: null,
    usedBy: null,
  };
  await store.createInvite(invite);
  return { id: invite.id, code, expiresAt: invite.expiresAt, role, teacherId };
};

const usableInvite = async (store, code) => {
  if (typeof code !== 'string' || code.length > 200) return null;
  const invite = await store.getInvite(hashToken(code));
  if (!invite || invite.usedAt || new Date(invite.expiresAt) <= new Date()) return null;
  return invite;
};

/** Before sign-in: look at an invite, and accept it. */
export const mountJoin = (app, { store, route, fail, sessionPayload, startSession, signupLimiter, loginLimiter }) => {
  const gone = (response) => fail(response, 410, 'This invite is no longer valid. Ask for a new one.');

  app.get('/api/auth/invite/:code', route(async (request, response) => {
    if (!signupLimiter.take(`peek|${request.ip}`)) return fail(response, 429, 'Too many attempts. Try again in a little while.');
    const invite = await usableInvite(store, request.params.code);
    const institution = invite && (await store.getInstitution(invite.institutionId));
    if (!institution) return gone(response);
    const teacher = profileOf(institution).teachers?.find((item) => item.id === invite.teacherId);
    response.json({ college: institution.name, teacher: teacher?.name ?? null, role: invite.role });
  }));

  app.post('/api/auth/join', route(async (request, response) => {
    const { code, name, email, password } = request.body ?? {};
    const invite = await usableInvite(store, code);
    const institution = invite && (await store.getInstitution(invite.institutionId));
    if (!institution) return gone(response);

    const cleanEmail = typeof email === 'string' ? normalizeEmail(email) : '';
    if (!isValidEmail(cleanEmail) || cleanEmail.endsWith(DEMO_DOMAIN)) return fail(response, 400, 'Enter a valid e-mail address');
    if (typeof password !== 'string' || password.length > MAX_PASSWORD) return fail(response, 400, `Password must be at most ${MAX_PASSWORD} characters`);

    // Someone who already has an account proves it's theirs. A wrong try leaves the invite usable.
    let account = await store.getAccountByEmail(cleanEmail);
    const isNew = !account;
    if (account) {
      const key = `join|${cleanEmail}|${request.ip}`;
      if (loginLimiter.blocked(key)) return fail(response, 429, 'Too many attempts. Try again in a few minutes.');
      if (!(await verifyPassword(password, account.passwordHash))) {
        loginLimiter.fail(key);
        return fail(response, 401, 'That e-mail already has an account, and the password is incorrect.');
      }
    } else {
      const cleanName = cleanText(name, LIMITS.name);
      if (!cleanName) return fail(response, 400, 'Your name is required');
      if (password.length < MIN_PASSWORD) return fail(response, 400, `Password must be at least ${MIN_PASSWORD} characters`);
      if (!signupLimiter.take(request.ip)) return fail(response, 429, 'Too many attempts. Try again in a little while.');
      try {
        account = await store.createAccount({ name: cleanName, email: cleanEmail, passwordHash: await hashPassword(password) });
      } catch (error) {
        if (error instanceof DuplicateEmailError) return fail(response, 409, 'An account with this e-mail already exists.');
        throw error;
      }
    }

    // Two people racing for one invite: only one can claim it.
    if (!(await store.claimInvite(invite.tokenHash, account.id))) {
      if (isNew) await store.deleteAccount(account.id);
      return gone(response);
    }
    if (invite.role === 'admin' && !institution.ownerId) {
      await store.setInstitutionFields(institution.id, { ownerId: account.id });
    } else {
      await store.addMember({ accountId: account.id, institutionId: institution.id, role: invite.role, teacherId: invite.teacherId });
    }
    const token = await startSession(account);
    response.status(isNew ? 201 : 200).json(await sessionPayload(account, token));
  }));
};

/** After sign-in: an admin managing who has access. */
export const mountMembers = (app, { store, route, fail, ownedInstitution }) => {
  app.post('/api/institutions/:id/invites', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return fail(response, 404, 'Institution not found');
    const { teacherId } = request.body ?? {};
    if (!profileOf(institution).teachers?.some((teacher) => teacher.id === teacherId)) {
      return fail(response, 400, 'Invite one of your teachers. If you just added them, wait a moment for it to save.');
    }
    response.status(201).json(await createInvite(store, { institutionId: institution.id, role: 'teacher', teacherId, createdBy: request.account.id }));
  }));

  app.get('/api/institutions/:id/invites', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return fail(response, 404, 'Institution not found');
    const now = new Date();
    const invites = await store.listInvites(institution.id);
    response.json(
      invites.map((invite) => ({
        id: invite.id,
        teacherId: invite.teacherId,
        role: invite.role,
        expiresAt: invite.expiresAt,
        status: invite.usedAt ? 'joined' : new Date(invite.expiresAt) <= now ? 'expired' : 'waiting',
      })),
    );
  }));

  app.delete('/api/institutions/:id/invites/:inviteId', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return fail(response, 404, 'Institution not found');
    await store.deleteInvite(request.params.inviteId, institution.id);
    response.json({ success: true });
  }));

  app.get('/api/institutions/:id/members', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return fail(response, 404, 'Institution not found');
    const members = await store.listMembers(institution.id);
    const owner = institution.ownerId ? await store.getAccount(institution.ownerId) : null;
    const describe = async (member) => {
      const account = await store.getAccount(member.accountId);
      return account && { accountId: account.id, name: account.name, email: account.email, role: member.role, teacherId: member.teacherId ?? null };
    };
    const rows = await Promise.all(members.map(describe));
    response.json([...(owner ? [{ accountId: owner.id, name: owner.name, email: owner.email, role: 'admin', teacherId: null, owner: true }] : []), ...rows.filter(Boolean)]);
  }));

  app.delete('/api/institutions/:id/members/:accountId', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return fail(response, 404, 'Institution not found');
    if (institution.ownerId === request.params.accountId) return fail(response, 409, 'The college’s main admin can’t be removed.');
    await store.removeMember(request.params.accountId, institution.id);
    response.json({ success: true });
  }));
};
