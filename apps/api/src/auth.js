import crypto from 'node:crypto';
import { promisify } from 'node:util';

import { HttpError } from './errors.js';

const scrypt = promisify(crypto.scrypt);

export const ROLES = ['admin', 'viewer'];
export const SESSION_COOKIE = 'tf_session';
const SESSION_DAYS = 7;
const KEY_LENGTH = 64;

// Passwords are stored as scrypt$<salt>$<hash>, both base64. No extra dependency needed.
export const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
};

export const verifyPassword = async (password, stored) => {
  const [scheme, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
};

// Only a hash of the session token is stored, so a leaked database cannot be replayed as a login.
export const newSessionToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

export const validateUsername = (username) => {
  const value = String(username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(value)) {
    throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  }
  return value;
};

export const validatePassword = (password) => {
  const value = String(password ?? '');
  if (value.length < 8 || value.length > 200) throw new HttpError(400, 'Password must be at least 8 characters.');
  return value;
};

export const validateRole = (role) => {
  if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of ${ROLES.join(', ')}.`);
  return role;
};

export const publicUser = (user) =>
  user && { id: user.id, username: user.username, role: user.role, disabled: Boolean(user.disabled), createdAt: user.createdAt };

const parseCookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => key && value !== undefined)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join('='))]),
  );

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
});

/** Attaches request.user when a valid session cookie is present. Never rejects on its own. */
export const loadUser = (store) => async (request, response, next) => {
  try {
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const session = await store.getSession(hashToken(token));
      if (session && new Date(session.expiresAt) > new Date()) {
        const user = await store.getUser(session.userId);
        if (user && !user.disabled) {
          request.user = user;
          request.sessionHash = session.id;
        }
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireUser = (request, response, next) => {
  if (!request.user) return next(new HttpError(401, 'Please sign in.'));
  next();
};

export const requireRole = (...roles) => (request, response, next) => {
  if (!request.user) return next(new HttpError(401, 'Please sign in.'));
  if (!roles.includes(request.user.role)) return next(new HttpError(403, 'You do not have permission to do this.'));
  next();
};

/**
 * Slows down password guessing: after MAX_FAILURES failed logins for a username
 * (or from one address) within the window, further attempts are refused until it passes.
 */
export const createLoginLimiter = ({ maxFailures = 10, windowMs = 15 * 60 * 1000 } = {}) => {
  const failures = new Map();
  const keys = (username, ip) => [`u:${username}`, `ip:${ip}`];
  const recent = (key) => {
    const now = Date.now();
    const list = (failures.get(key) ?? []).filter((time) => now - time < windowMs);
    failures.set(key, list);
    return list;
  };
  return {
    check(username, ip) {
      if (keys(username, ip).some((key) => recent(key).length >= maxFailures)) {
        throw new HttpError(429, 'Too many failed sign-in attempts. Wait 15 minutes and try again.');
      }
    },
    fail(username, ip) {
      for (const key of keys(username, ip)) failures.set(key, [...recent(key), Date.now()]);
    },
    succeed(username) {
      failures.delete(`u:${username}`);
    },
  };
};
