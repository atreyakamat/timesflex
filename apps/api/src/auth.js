import crypto from 'node:crypto';

/**
 * Password hashing, session tokens and a small login rate limiter.
 * Passwords use scrypt with a per-password salt; only a SHA-256 of each
 * session token is stored, so a leaked data file cannot be replayed.
 */

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
export const SESSION_DAYS = 30;
export const MIN_PASSWORD = 8;

const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))),
  );

export const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
};

export const verifyPassword = async (password, stored) => {
  const [scheme, salt, key] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'));
  const expected = Buffer.from(key, 'base64');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

// Compared against when an e-mail is unknown, so both paths take the same time.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString('hex'));
export const verifyAgainstDummy = (password) => verifyPassword(password, DUMMY_HASH);

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
export const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

export const bearerToken = (request) => {
  const header = request.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
};

/** At most `limit` failed attempts per key inside `windowMs`. In memory, per process. */
export const createRateLimiter = ({ limit = 10, windowMs = 15 * 60 * 1000 } = {}) => {
  const attempts = new Map();
  const recent = (key) => (attempts.get(key) ?? []).filter((time) => Date.now() - time < windowMs);
  return {
    blocked: (key) => recent(key).length >= limit,
    fail: (key) => attempts.set(key, [...recent(key), Date.now()]),
    reset: (key) => attempts.delete(key),
  };
};
