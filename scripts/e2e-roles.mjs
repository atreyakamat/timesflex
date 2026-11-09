// End-to-end in a real browser: each role doing its job. The central admin onboards a college; its
// admin sets up and invites a teacher; the teacher marks students; the office reviews.
//   APP_URL=http://localhost:8080 node scripts/e2e-roles.mjs [screenshot-dir]
// PROMOTE_COMMAND turns an account into a central admin; {email} is replaced. Without it, that part is skipped.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.APP_URL ?? 'http://localhost:8080';
const API = process.env.API_URL ?? APP;
const SHOTS = process.argv[2];
const PORT = 9400 + Math.floor(Math.random() * 400);
const chromePath = process.env.CHROME_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(2);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const PASSWORD = `roles-${stamp}-pass`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail ? ` (${detail})` : ''}`);
};

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'tf-roles-'));
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', '--no-first-run', 'about:blank']);
let target;
for (let i = 0; i < 60 && !target; i += 1) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
  } catch {
    // Chrome is still starting.
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};
const HELPERS = `
window.__vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
window.__find = (text, exact) => [...document.querySelectorAll('div,span,a,button')].reverse().find((el) => __vis(el) && (exact ? el.textContent.trim() === text : el.textContent.includes(text)) && el.children.length <= 3);
window.__has = (text) => document.body.innerText.includes(text);
window.__type = (ph, v) => { const el = [...document.querySelectorAll('input,textarea')].find((i) => i.placeholder === ph && __vis(i)); if (!el) throw new Error('no input ' + ph); const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return true; };
`;
const waitFor = async (expression, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await ev(expression)) return;
    } catch {
      // Page is navigating.
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${expression}`);
};
const go = async (url) => {
  await send('Page.navigate', { url });
  await sleep(500);
  await waitFor(`document.readyState === 'complete'`);
  await ev(HELPERS);
};
const has = (t) => waitFor(`__has(${JSON.stringify(t)})`);
const seen = (t) => ev(`__has(${JSON.stringify(t)})`);
const click = (t, exact = true) => ev(`(() => { const el = __find(${JSON.stringify(t)}, ${exact}); if (!el) throw new Error('nothing to click: ' + ${JSON.stringify(t)}); el.click(); return true; })()`);
const type = (p, v) => ev(`__type(${JSON.stringify(p)}, ${JSON.stringify(v)})`);
const shot = async (name) => {
  if (!SHOTS) return;
  await sleep(350);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
};
const signOutBrowser = async () => {
  await ev(`localStorage.clear()`);
};
const apiCall = async (method, url, token, body) => {
  const r = await fetch(`${API}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const tokens = [];

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await go(APP);

  let collegeLink = null;
  const collegeName = `Role Test College ${stamp}`;
  /* ---------- Central admin ---------- */
  if (process.env.PROMOTE_COMMAND) {
    const email = `central-${stamp}@example.test`;
    const op = await apiCall('POST', '/api/auth/signup', null, { name: 'Central Admin', email, password: PASSWORD, institutionName: 'Operator HQ' });
    tokens.push([op.json.token, PASSWORD]);
    execSync(process.env.PROMOTE_COMMAND.replace('{email}', email), { stdio: 'pipe' });
    await ev(`localStorage.setItem('timeflex.session', ${JSON.stringify(op.json.token)})`);
    await go(`${APP}/admin`);
    await has('All colleges');
    check('the central admin reaches the panel', true);
    await click('Add a college');
    await has('Onboard a college');
    await type('e.g. Agnel Institute of Technology', collegeName);
    await type('e.g. Principal, 98xxxxxxxx', 'Principal, on the phone');
    await click('Create and get invite');
    await has('Send this to the college’s admin');
    collegeLink = await ev(`[...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /\\/join\\?code=[\\w%-]+$/.test(t) && t.startsWith('http'))`);
    check('creating a college gives a one-use invite link', /\/join\?code=/.test(collegeLink ?? ''));
    check('it shows as waiting for its admin', (await seen('Admin hasn’t joined yet')) && (await seen('Invited')));
    await shot('r1-central-admin');
    await signOutBrowser();
  } else {
    console.log('  - central admin part skipped: no PROMOTE_COMMAND');
  }

  /* ---------- College admin ---------- */
  const adminEmail = `admin-${stamp}@example.test`;
  if (collegeLink) {
    await go(collegeLink);
    await has(collegeName);
    check('the invite shows which college it’s for', await seen('You’ve been invited to run this college'));
    await type('e.g. Prof. Anita Mehta', 'College Principal');
    await type('you@college.edu', adminEmail);
    await type('At least 8 characters', PASSWORD);
    await sleep(150);
    await click('Join');
    await has('Which classes at');
    check('the admin lands straight in setup', true);
  } else {
    const made = await apiCall('POST', '/api/auth/signup', null, { name: 'College Principal', email: adminEmail, password: PASSWORD, institutionName: collegeName });
    await ev(`localStorage.setItem('timeflex.session', ${JSON.stringify(made.json.token)})`);
    await go(`${APP}/onboarding`);
    await has('Which classes at');
  }
  const adminToken = await ev(`localStorage.getItem('timeflex.session')`);
  tokens.push([adminToken, PASSWORD]);
  await click('Use sample data instead');
  await has('Build 3 versions');
  await click('Build 3 versions');
  await waitFor(`__has('3 versions ready to compare')`, 120000);
  await sleep(1500);
  await go(`${APP}/timetable`);
  await has('Compare versions');
  await click('Approve');
  await has('Now let your teachers know');
  await sleep(1200);

  await go(`${APP}/access`);
  await has('Teacher access');
  check('teacher access lists the teachers', await seen('Prof. Mehta'));
  // Teachers are listed in order, and Prof. Mehta comes first.
  await waitFor(`[...document.querySelectorAll('[role="button"]')].some((x) => x.textContent.trim().endsWith('Invite'))`);
  await ev(`[...document.querySelectorAll('[role="button"]')].find((x) => x.textContent.trim().endsWith('Invite')).click()`);
  await has('Works once, for 14 days');
  const teacherLink = await ev(`[...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /\\/join\\?code=[\\w%-]+$/.test(t) && t.startsWith('http'))`);
  check('an invite link is made for that teacher', /\/join\?code=/.test(teacherLink ?? ''));
  await shot('r2-teacher-access');
  await signOutBrowser();

  /* ---------- Teacher ---------- */
  const teacherEmail = `teacher-${stamp}@example.test`;
  await go(teacherLink);
  await has('Join as Prof. Mehta');
  check('the invite says who it’s for', true);
  await type('you@college.edu', teacherEmail);
  await type('At least 8 characters', PASSWORD);
  await sleep(150);
  await click('Join');
  await has('Your classes today');
  const teacherToken = await ev(`localStorage.getItem('timeflex.session')`);
  tokens.push([teacherToken, PASSWORD]);
  check('a teacher lands on their own page', await seen('Mark a student'));
  check('a teacher sees no admin navigation', !(await seen('Approve')) && !(await seen('Teacher access')));
  await shot('r3-teacher-home');

  await go(`${APP}/timetable`);
  await waitFor(`location.pathname !== '/timetable'`, 8000);
  check('a teacher can’t open admin screens', await ev(`location.pathname === '/teacher'`));

  // Reload keeps them on their own page, with their data.
  await go(`${APP}/teacher`);
  await has('Your classes today');
  check('a teacher stays signed in across a reload', true);

  // Mark two students late with a remark.
  await go(`${APP}/mark`);
  await has('Mark a student');
  await waitFor(`document.querySelectorAll('[role="checkbox"]').length > 5`);
  check('saving is on screen without scrolling past the class', await ev(`(() => { const el = __find('Tap the students above', true); const r = el.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })()`));
  await ev(`(() => { const tiles = [...document.querySelectorAll('[role="checkbox"]')]; tiles[0].click(); tiles[1].click(); return true; })()`);
  await has('Save for 2 students');
  await click('15 min');
  await type('e.g. Bus was late', 'Bus was late');
  await shot('r4-mark-late');
  await click('Save for 2 students');
  await has('Late: 2 students saved');
  check('a teacher marks two students late with a remark', true);
  await shot('r5-saved-undo');

  // Undo really takes it back.
  await click('Undo');
  await has('Undone');
  let mine = await apiCall('GET', `/api/institutions/${(await apiCall('GET', '/api/auth/me', teacherToken)).json.institution.id}/events`, teacherToken);
  check('Undo voids the marks, keeping the trail', mine.json.length === 2 && mine.json.every((e) => e.status === 'void'));

  // Find a student anywhere by name, and flag them.
  await sleep(300);
  const someone = await ev(`[...document.querySelectorAll('[role="checkbox"]')][2].getAttribute('aria-label').split(',')[0]`);
  await type('Name or roll number, in any class', someone);
  await waitFor(`document.querySelectorAll('[role="checkbox"]').length >= 1 && document.querySelectorAll('[role="checkbox"]').length < 10`);
  check('search finds a student by name', true);
  await ev(`[...document.querySelectorAll('[role="checkbox"]')][0].click()`);
  await click('Bunked');
  await has('This goes to the college office to review');
  await type('e.g. Near the canteen during period 3', 'Near the canteen during period 3');
  await click('Save for 1 student');
  await has('Bunked: 1 student saved');
  check('any teacher can flag a student as bunking', true);

  /* ---------- Office review ---------- */
  await signOutBrowser();
  await ev(`localStorage.setItem('timeflex.session', ${JSON.stringify(adminToken)})`);
  await go(`${APP}/students`);
  await has('Waiting for review');
  check('the office sees the teacher’s flag straight away', (await seen('Near the canteen during period 3')) && (await seen('Bunked a class')));
  await shot('r6-office-students');
  await type('What was done? (optional)', 'Spoke to the student');
  await click('Mark reviewed');
  await waitFor(`!__has('Mark reviewed')`);
  check('the office reviews the flag with an outcome', true);

  await type('Name or roll number', someone);
  await has(someone);
  await ev(`(() => { const el = [...document.querySelectorAll('[role="link"]')].find((x) => x.textContent.includes(${JSON.stringify(someone)})); el.click(); return true; })()`);
  await has('Times late');
  await has('Spoke to the student');
  check('a student’s record shows the flag and outcome', await seen('Bunked a class'));
  check('no attendance yet reads as a dash, not null', !(await seen('null')));
  await shot('r7-student-record');

  /* ---------- Phone ---------- */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const page of ['students', 'mark', 'access']) {
    await go(`${APP}/${page}`);
    await sleep(600);
    check(`${page} fits a phone`, (await ev(`document.documentElement.scrollWidth - innerWidth`)) <= 0);
    await shot(`r8-phone-${page}`);
  }
  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200));
} catch (error) {
  check(`flow completed: ${error.message}`, false);
  await shot('r-error').catch(() => {});
} finally {
  // Teachers first: deleting the admin removes the college.
  for (const [token, password] of tokens.reverse()) await apiCall('DELETE', '/api/auth/account', token, { password });
  ws.close();
  chrome.kill();
  await sleep(300);
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    // A temporary folder left behind does no harm.
  }
  process.exit(failed ? 1 : 0);
}
