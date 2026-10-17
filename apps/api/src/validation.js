import { HttpError } from './errors.js';

const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const fail = (message) => {
  throw new HttpError(400, message);
};

export const validateInstitutionFields = ({ name, type }) => {
  if (!isText(name) || !isText(type)) fail('name and type are required');
  if (name.length > 200) fail('name must be at most 200 characters');
  if (!['college', 'school', 'university'].includes(type)) fail('type must be college, school or university');
};

const PROFILE_LISTS = ['divisions', 'teachers', 'rooms', 'subjects', 'slots'];

export const validateProfile = (profile) => {
  if (profile === undefined) return;
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) fail('profile must be an object');
  for (const key of PROFILE_LISTS) {
    if (profile[key] !== undefined && !Array.isArray(profile[key])) fail(`profile.${key} must be a list`);
  }
};

/** Shape checks for a solver request, so bad data is rejected here with a clear message. */
export const validateTimetableRequest = (request) => {
  if (!request || typeof request !== 'object') fail('request.days, request.slots, and request.sessions are required');
  const { days, slots, sessions } = request;
  if (!Array.isArray(days) || !Array.isArray(slots) || !Array.isArray(sessions)) {
    fail('request.days, request.slots, and request.sessions are required');
  }
  if (!days.every(isText) || new Set(days).size !== days.length) fail('request.days must be distinct names');
  if (!slots.every(isText) || new Set(slots).size !== slots.length) fail('request.slots must be distinct labels');
  if (sessions.length > 5000) fail('request.sessions is too large');
  const ids = new Set();
  sessions.forEach((session, index) => {
    const where = `request.sessions[${index}]`;
    if (!session || typeof session !== 'object') fail(`${where} must be an object`);
    for (const key of ['id', 'subject_id', 'teacher_id', 'division_id']) {
      if (!isText(session[key])) fail(`${where}.${key} is required`);
    }
    if (ids.has(session.id)) fail(`${where}.id is a duplicate`);
    ids.add(session.id);
    if (session.duration_slots !== undefined && !(Number.isInteger(session.duration_slots) && session.duration_slots >= 1)) {
      fail(`${where}.duration_slots must be a whole number of at least 1`);
    }
  });
};
