// Attacks a TimeFlex server you own and reports what got through. It creates throwaway accounts,
// removes them afterwards, and trips the rate limits, so your address may be briefly limited.
//   TARGET=http://localhost:8080 npm run test:security
//   SECURITY_DIRECT=1 also runs checks that only make sense when talking straight to the API.
const BASE = (process.env.TARGET ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const stamp = Date.now();
let failed = 0;
const results = [];

const check = (name, ok, detail = '') => {
  results.push(ok);
  if (!ok) failed += 1;
  console.log(`${ok ? 'SAFE      ' : 'VULNERABLE'} ${name}${detail ? `  [${String(detail).slice(0, 110)}]` : ''}`);
};
const call = async (method, url, { body, token, raw, headers } = {}) => {
  const response = await fetch(`${BASE}${url}`, {
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
  return { status: response.status, json, text, headers: response.headers };
};
/** Anything that tells an attacker how the server is built. */
const leaks = (text) => /(\bat .+\.js:\d+|node_modules|ECONNREFUSED|SQLSTATE|syntax error at|duplicate key|127\.0\.0\.1|:8000|:11434|http:\/\/(solver|ollama|db|api)\b|pydantic|Solver request failed|<pre>)/i.test(text);

const newAccount = async (label) => {
  const email = `sec-${label}-${stamp}@example.test`;
  const password = `sec-${stamp}-password`;
  const r = await call('POST', '/api/auth/signup', { body: { name: `Sec ${label}`, email, password, institutionName: `Sec ${label} College`, institutionType: 'college' } });
  if (r.status !== 201) throw new Error(`could not create a test account: ${r.status} ${r.text.slice(0, 120)}`);
  return { email, password, token: r.json.token, institution: r.json.institution, account: r.json.account };
};
const smallRequest = (extra = {}) => ({
  days: ['Monday'],
  slots: ['s1'],
  sessions: [{ id: 'x', teacher_id: 't', division_id: 'd', subject_id: 'm', kind: 'lecture', duration_slots: 1 }],
  ...extra,
});

console.log(`Target: ${BASE}\n`);
const alice = await newAccount('alice');
const mallory = await newAccount('mallory');
const made = [alice, mallory];

/* ---------- Who can see what ---------- */
const noAuth = ['GET /api/institutions', `GET /api/institutions/${alice.institution.id}`, 'GET /api/ai/status', 'POST /api/agent/interpret', 'POST /api/parse', 'GET /api/auth/me'];
for (const route of noAuth) {
  const [method, url] = route.split(' ');
  const r = await call(method, url, method === 'POST' ? { body: { text: 'x' } } : {});
  check(`no login is refused: ${route}`, r.status === 401, r.status);
}
const forged = await call('GET', '/api/auth/me', { token: 'A'.repeat(43) });
check('a made-up session token is refused', forged.status === 401, forged.status);

const timetable = await call('POST', `/api/institutions/${alice.institution.id}/timetables`, { token: alice.token, body: { label: 'Alice', request: smallRequest() } });
check('owner can create a timetable (control)', timetable.status === 201, timetable.status);
const ttId = timetable.json?.id;
const inst = `/api/institutions/${alice.institution.id}`;
const attacks = [
  ['read another college', 'GET', inst],
  ['overwrite another college', 'PUT', inst, { name: 'Hacked', type: 'college', profile: {} }],
  ['delete another college', 'DELETE', inst],
  ['change another college’s attendance', 'PUT', `${inst}/operations`, { absences: [], substitutions: [], attendance: [] }],
  ['list another college’s timetables', 'GET', `${inst}/timetables`],
  ['add a timetable to another college', 'POST', `${inst}/timetables`, { request: smallRequest() }],
  ['read another college’s timetable', 'GET', `/api/timetables/${ttId}`],
  ['edit another college’s timetable', 'PUT', `/api/timetables/${ttId}`, { status: 'approved' }],
  ['run the solver on another college’s timetable', 'POST', `/api/timetables/${ttId}/solve`],
];
for (const [name, method, url, body] of attacks) {
  const r = await call(method, url, { token: mallory.token, body });
  check(`cannot ${name}`, r.status === 404, r.status);
}
const stillThere = await call('GET', inst, { token: alice.token });
check('the victim’s data is untouched', stillThere.json?.name === alice.institution.name, stillThere.json?.name);

/* ---------- Updates and WhatsApp ---------- */
await call('PUT', inst, { token: alice.token, body: { name: alice.institution.name, type: 'college', profile: { teachers: [{ id: 't1', name: 'T', phone: '9876543210' }] } } });
const noticeBody = { title: 'x', kind: 'timetable', groupText: 'g', recipients: [{ teacherId: 't1', text: 'hello', summary: 'hello' }] };
const notice = await call('POST', `${inst}/notices`, { token: alice.token, body: noticeBody });
check('owner can create an update (control)', notice.status === 201, notice.status);
for (const [name, method, url, body] of [
  ['read another college’s updates', 'GET', `${inst}/notices`],
  ['add an update to another college', 'POST', `${inst}/notices`, noticeBody],
  ['change another college’s update', 'PUT', `/api/notices/${notice.json?.id}/recipients/t1`, { status: 'skipped' }],
  ['send another college’s update', 'POST', `/api/notices/${notice.json?.id}/send`],
]) {
  const r = await call(method, url, { token: mallory.token, body });
  check(`cannot ${name}`, r.status === 404 || (r.status === 409 && name.startsWith('send')), r.status);
}
const stranger = await call('POST', `${inst}/notices`, { token: alice.token, body: { ...noticeBody, recipients: [{ teacherId: 'someone-else', text: 'spam', summary: 'spam' }] } });
check('messages only go to the college’s own teachers', stranger.status === 400, stranger.status);
const forgedHook = await call('POST', '/api/webhooks/whatsapp', { raw: JSON.stringify({ entry: [] }), headers: { 'X-Hub-Signature-256': 'sha256=00' } });
check('a forged delivery update is refused', forgedHook.status === 401, forgedHook.status);
const unsignedHook = await call('POST', '/api/webhooks/whatsapp', { raw: '{}' });
check('an unsigned delivery update is refused', unsignedHook.status === 401, unsignedHook.status);
const hookCheck = await call('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=x');
check('the webhook handshake needs the secret', hookCheck.status === 403, hookCheck.status);

/* ---------- Injection and bad input ---------- */
for (const payload of ["' OR '1'='1' --", "'; DROP TABLE accounts; --"]) {
  const r = await call('POST', '/api/auth/login', { body: { email: payload, password: payload } });
  check(`SQL injection at login fails: ${payload}`, r.status === 401, r.status);
}
const sqlId = await call('GET', `/api/institutions/${encodeURIComponent("' OR 1=1 --")}`, { token: mallory.token });
check('SQL injection in an id fails', sqlId.status === 404, sqlId.status);
const alive = await call('GET', '/api/auth/me', { token: alice.token });
check('the database survived those', alive.status === 200, alive.status);

const weird = [
  ['object as e-mail', '/api/auth/login', { email: { $ne: null }, password: { $ne: null } }],
  ['array as sign-up fields', '/api/auth/signup', { name: ['a'], email: ['a@b.co'], password: ['x'], institutionName: {} }],
  ['null body fields', '/api/auth/signup', { name: null, email: null, password: null }],
];
for (const [name, url, body] of weird) {
  const r = await call('POST', url, { body });
  check(`${name} gets a clean refusal`, r.status >= 400 && r.status < 500 && !leaks(r.text), `${r.status} ${r.text}`);
}
const typed = await call('POST', '/api/institutions', { token: mallory.token, body: { name: { evil: 1 }, type: ['x'] } });
check('wrong types for a college are refused', typed.status === 400, `${typed.status} ${typed.text}`);
const badContext = await call('POST', '/api/agent/interpret', { token: mallory.token, body: { text: 'hello', context: { teachers: 7, subjects: 'x', classes: { a: 1 } } } });
check('a malformed assistant request does not crash', badContext.status < 500 && !leaks(badContext.text), `${badContext.status} ${badContext.text}`);
const malformed = await call('POST', '/api/auth/login', { raw: '{"email": ' });
check('broken JSON reveals nothing', malformed.status === 400 && !leaks(malformed.text), `${malformed.status} ${malformed.text}`);
const missing = await call('GET', '/api/nope/%E0%A4%A', { token: mallory.token });
check('a malformed URL reveals nothing', missing.status < 500 && !leaks(missing.text), `${missing.status} ${missing.text}`);

/* ---------- What leaks out ---------- */
const me = await call('GET', '/api/auth/me', { token: alice.token });
check('sign-in data never includes the password hash', !/passwordHash|password_hash|scrypt\$/.test(me.text));
check('college data never includes the owner id', !/ownerId|owner_id/.test(stillThere.text));
const badSolve = await call('POST', `${inst}/timetables`, { token: alice.token, body: { request: { days: 'x', slots: 'y', sessions: 'z' } } });
if (badSolve.status === 201) {
  const r = await call('POST', `/api/timetables/${badSolve.json.id}/solve`, { token: alice.token });
  check('solver errors reveal nothing', !leaks(r.text), `${r.status} ${r.text}`);
} else {
  check('nonsense timetable requests are refused', badSolve.status === 400, badSolve.status);
}
const ai = await call('GET', '/api/ai/status', { token: mallory.token });
check('AI status hides internal addresses', !leaks(ai.text) && !/baseUrl|installedModels/.test(ai.text), ai.text);
const health = await call('GET', '/health');
check('the public health check says nothing about the setup', health.status === 200 && !/storage|"ai"|postgres/.test(health.text), health.text);
check('the server does not advertise its software', !health.headers.get('x-powered-by'), health.headers.get('x-powered-by'));
const evil = await call('GET', '/health', { headers: { Origin: 'https://evil.example' } });
if (process.env.SECURITY_DIRECT) console.log('INFO       direct to API, skipping the checks that belong to the front door');
else {
  check('other websites cannot call the API', !['*', 'https://evil.example'].includes(evil.headers.get('access-control-allow-origin')), evil.headers.get('access-control-allow-origin'));
  const page = await fetch(`${BASE}/`);
  for (const header of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
    check(`page sends ${header}`, Boolean(page.headers.get(header)));
  }
}

/* ---------- Sessions ---------- */
const second = await call('POST', '/api/auth/login', { body: { email: alice.email, password: alice.password } });
check('the right password signs in (control)', second.status === 200, second.status);
await call('POST', '/api/auth/logout', { token: second.json?.token });
const afterLogout = await call('GET', '/api/auth/me', { token: second.json?.token });
check('a token stops working after sign-out', afterLogout.status === 401, afterLogout.status);
const wrongDelete = await call('DELETE', '/api/auth/account', { token: alice.token, body: { password: 'not-the-password' } });
check('deleting an account needs the password', wrongDelete.status === 403, wrongDelete.status);
const wrongChange = await call('POST', '/api/auth/password', { token: alice.token, body: { current: 'not-the-password', next: 'new-password-123' } });
check('changing the password needs the old one', wrongChange.status === 403, wrongChange.status);
const device = await call('POST', '/api/auth/login', { body: { email: mallory.email, password: mallory.password } });
const changed = await call('POST', '/api/auth/password', { token: mallory.token, body: { current: mallory.password, next: `${mallory.password}-2` } });
const otherDevice = await call('GET', '/api/auth/me', { token: device.json?.token });
check('changing the password signs out other devices', changed.status === 200 && otherDevice.status === 401, `${changed.status} ${otherDevice.status}`);
mallory.password = `${mallory.password}-2`;
const demoClaim = await call('POST', '/api/auth/signup', { body: { name: 'x', email: `x-${stamp}@demo.timeflex.app`, password: 'password-long-enough', institutionName: 'x' } });
check('nobody can sign up on the demo domain', demoClaim.status === 400, demoClaim.status);

/* ---------- Using it up ---------- */
const big = 'x'.repeat(2 * 1024 * 1024);
const hugeSignup = await call('POST', '/api/auth/signup', { body: { name: big, email: 'a@b.co', password: 'x', institutionName: 'x' } });
check('a 2 MB body without a login is refused', hugeSignup.status === 413, hugeSignup.status);
const longPassword = await call('POST', '/api/auth/signup', { body: { name: 'x', email: `long-${stamp}@example.test`, password: 'p'.repeat(20000), institutionName: 'x' } });
check('an absurdly long password is refused', longPassword.status === 400, longPassword.status);
if (longPassword.status === 201) made.push({ token: longPassword.json.token, password: 'p'.repeat(20000) });
const longName = await call('POST', '/api/auth/signup', { body: { name: 'n'.repeat(5000), email: `name-${stamp}@example.test`, password: 'password-long-enough', institutionName: 'x' } });
check('an absurdly long name is refused', longName.status === 400, longName.status);
if (longName.status === 201) made.push({ token: longName.json.token, password: 'password-long-enough' });

const slow = await call('POST', `${inst}/timetables`, { token: alice.token, body: { request: smallRequest({ time_limit_seconds: 120 }) } });
check('a client cannot ask for very long solver runs', slow.status === 400, slow.status);
const manySessions = Array.from({ length: 20000 }, (_, i) => ({ ...smallRequest().sessions[0], id: `s${i}` }));
const heavy = await call('POST', `${inst}/timetables`, { token: alice.token, body: { request: smallRequest({ sessions: manySessions }) } });
check('an oversized solver job is refused', heavy.status === 400 || heavy.status === 413, heavy.status);

let colleges = 0;
for (let i = 0; i < 12; i += 1) {
  const r = await call('POST', '/api/institutions', { token: mallory.token, body: { name: `C${i}`, type: 'college' } });
  if (r.status === 201) colleges += 1;
}
check('one account cannot create endless colleges', colleges < 12, `${colleges} of 12 created`);

let solves = 0;
let solveStatus = 0;
const mine = (await call('POST', `/api/institutions/${mallory.institution.id}/timetables`, { token: mallory.token, body: { request: smallRequest() } })).json;
const requests = await Promise.all(Array.from({ length: 60 }, () => call('POST', `/api/timetables/${mine.id}/solve`, { token: mallory.token })));
for (const r of requests) {
  if (r.status === 200) solves += 1;
  else solveStatus = r.status;
}
check('the solver really ran before the limit (control)', solves > 0, `${solves} ran`);
check('solver flood from one account is limited', solves < 60, `${solves} of 60 ran, others ${solveStatus}`);

let asked = 0;
const flood = await Promise.all(Array.from({ length: 60 }, () => call('POST', '/api/agent/interpret', { token: mallory.token, body: { text: 'flood' } })));
for (const r of flood) if (r.status === 200) asked += 1;
check('AI flood from one account is limited', asked < 60, `${asked} of 60 ran`);

let guesses = 0;
for (let i = 0; i < 12; i += 1) {
  const r = await call('POST', '/api/auth/login', { body: { email: alice.email, password: `wrong-${i}` } });
  if (r.status === 401) guesses += 1;
}
check('guessing one account’s password is limited', guesses <= 10, `${guesses} of 12 reached the password check`);
const stillIn = await call('POST', '/api/auth/login', { body: { email: mallory.email, password: mallory.password } });
check('that does not lock anyone else out', stillIn.status === 200, stillIn.status);
guesses = 0;
for (let i = 0; i < 230; i += 1) {
  const r = await call('POST', '/api/auth/login', { body: { email: `nobody-${i}-${stamp}@example.test`, password: 'guess-guess' } });
  if (r.status === 401) guesses += 1;
}
check('password guessing across many e-mails is limited', guesses < 230, `${guesses} of 230 reached the password check`);

const flooded = [];
for (let i = 0; i < 120; i += 1) {
  const r = await call('POST', '/api/auth/signup', { body: { name: 'F', email: `flood-${i}-${stamp}@example.test`, password: 'flood-password', institutionName: 'F' } });
  if (r.status === 201) flooded.push({ token: r.json.token, password: 'flood-password' });
}
made.push(...flooded);
check('mass sign-up is limited', flooded.length < 120, `${flooded.length} of 120 created`);

/* ---------- Clean up ---------- */
let removed = 0;
for (const account of made) {
  const r = await call('DELETE', '/api/auth/account', { token: account.token, body: { password: account.password } });
  if (r.status === 200) {
    removed += 1;
    const gone = await call('GET', '/api/auth/me', { token: account.token });
    if (account === alice) check('a token stops working after the account is deleted', gone.status === 401, gone.status);
  }
}
console.log(`\nCleaned up ${removed} of ${made.length} test accounts.`);
console.log(`${results.length - failed} of ${results.length} safe, ${failed} vulnerable.`);
process.exitCode = failed ? 1 : 0;
