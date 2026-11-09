// End-to-end test of the TimeFlex app (apps/mobile, web build) in headless Chrome.
//
// Needs the API and solver running (npm run dev, or both started separately) and the
// exported web app served (npm run e2e builds and serves it). It signs up a throwaway
// account, explores with sample data, builds and compares versions, uses the assistant,
// checks phone layout, and deletes the account at the end.
//
//   APP_URL=http://localhost:8081 API_URL=http://127.0.0.1:3001 node scripts/e2e.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.APP_URL ?? 'http://localhost:8081';
const API = process.env.API_URL ?? 'http://127.0.0.1:3001';
const SHOTS = process.argv[2];
const PORT = 9300 + Math.floor(Math.random() * 500);
const chromePath =
  process.env.CHROME_PATH ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(2);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `e2e-${Date.now()}@example.test`;
const firstEmail = `e2e-first-${Date.now()}@example.test`;
const password = `e2e-${Math.random().toString(36).slice(2)}-pass`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✔' : '  ✖'} ${name}${detail ? ` (${detail})` : ''}`);
};

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'timeflex-e2e-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1280,900',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
]);

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
await new Promise((resolve) => ws.addEventListener('open', resolve));
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};
const waitFor = async (expression, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      // Page is navigating.
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${expression}`);
};
const shot = async (name) => {
  if (!SHOTS) return;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
};

// React Native Web renders plain divs; find things by their visible text.
const HELPERS = `
window.__visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
window.__byText = (text, exact = true) => [...document.querySelectorAll('div,span,a,button')].reverse()
  .find((el) => __visible(el) && (exact ? el.textContent.trim() === text : el.textContent.includes(text)) && el.children.length <= 3);
window.__click = (text, exact = true) => { const el = __byText(text, exact); if (!el) throw new Error('no element ' + text); el.click(); return true; };
window.__type = (placeholder, value) => {
  const el = [...document.querySelectorAll('input,textarea')].find((i) => i.placeholder === placeholder && __visible(i));
  if (!el) throw new Error('no input ' + placeholder);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__enter = (placeholder) => {
  const el = [...document.querySelectorAll('input,textarea')].find((i) => i.placeholder === placeholder && __visible(i));
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  return true;
};
window.__has = (text) => document.body.innerText.includes(text);
`;
const go = async (url) => {
  await send('Page.navigate', { url });
  await sleep(500);
  await waitFor(`document.readyState === 'complete'`);
  await evaluate(HELPERS);
};
const click = (text, exact = true) => evaluate(`__click(${JSON.stringify(text)}, ${exact})`);
const type = (placeholder, value) => evaluate(`__type(${JSON.stringify(placeholder)}, ${JSON.stringify(value)})`);
const has = (text) => evaluate(`__has(${JSON.stringify(text)})`);

let token = null;
const check0Close = () => evaluate(`[...document.querySelectorAll('[aria-label="Close"]')].filter(__visible).pop().click()`);
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  await go(APP);
  await waitFor(`__has('planned with you')`);
  check('landing page renders', true);
  await shot('01-landing');

  const signUp = async (address) => {
    await click('Create your account');
    await waitFor(`__has('Let’s set up your department')`);
    await type('e.g. Goa College of Engineering', 'E2E Test College');
    await type('e.g. Prof. Anita Mehta', 'Prof. Test Coordinator');
    await type('you@college.edu', address);
    await type('At least 8 characters', password);
    await sleep(200);
    await click('Create account');
    await waitFor(`__has('Step 1 of 4') && __has('classes at E2E Test College')`, 15000);
    return evaluate(`localStorage.getItem('timeflex.session')`);
  };

  // A real first user, from nothing: institution, teachers and what they teach, then a timetable.
  token = await signUp(firstEmail);
  check('sign-up opens the step-by-step setup', true);
  check('session token stored', Boolean(token));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  check('setup fits a phone screen', (await evaluate(`document.documentElement.scrollWidth - window.innerWidth`)) <= 0);
  await shot('01a-phone-teachers');
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  const press = (label) => evaluate(`(() => { const el = [...document.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)} && __visible(x)); if (!el) throw new Error('no button ' + ${JSON.stringify(label)}); el.click(); return true; })()`);
  // Step 1: tap the years and branches, make one year common, split one box into divisions.
  for (const chip of ['FY', 'SY', 'Comp', 'IT']) await click(chip);
  await waitFor(`__has('SY Comp') && __has('SY IT') && __has('FY Comp')`);
  check('tapping years and branches makes the grid', true);
  await click('FY: same for all branches');
  await waitFor(`!__has('FY Comp')`);
  check('a year can be common to all branches', true);
  await press('More divisions for SY Comp');
  await waitFor(`__has('4 classes')`);
  await shot('01b-classes');
  check('the grid counts classes and students', await has('240 students'));
  await click('Continue');
  await waitFor(`__has('Step 2 of 4')`);

  // Step 2: each year and branch gets its subjects; another can copy them.
  await type('e.g. DBMS, Operating Systems, DBMS Lab', 'Maths');
  await click('Add subjects');
  await waitFor(`__has('1 subject')`);
  await click('SY Comp');
  await waitFor(`__has('Subjects for SY Comp')`);
  await type('e.g. DBMS, Operating Systems, DBMS Lab', 'DBMS, Operating Systems, DBMS Lab');
  await click('Add subjects');
  await waitFor(`__has('Operating Systems')`);
  await click('SY IT');
  await waitFor(`__has('Subjects for SY IT')`);
  await click('Copy from SY Comp');
  await waitFor(`__has('Operating Systems')`);
  check('another branch can copy subjects', true);
  await shot('01c-subjects');
  await click('Continue');
  await waitFor(`__has('Step 3 of 4')`);

  // Step 3: paste links teachers to subjects; one subject is split between divisions.
  await click('Paste a list instead');
  await type('Prof. Mehta: DBMS, Operating Systems\nDr. Rao: Maths\nProf. Iyer: Networks, Networks Lab', 'Prof. Mehta: DBMS, DBMS Lab\nDr. Rao - Maths\nIyer teaches Operating Systems, Thermodynamics\n<img src=x onerror="window.__xss=1">');
  await click('Add them all');
  await waitFor(`__has('4 teachers')`);
  await sleep(300);
  check('a pasted list links teachers to their subjects', await has('All subjects have a teacher'));
  check('a subject that doesn’t exist is reported, not lost', await has('Thermodynamics'));
  check('code typed as a teacher’s name stays plain text', (await evaluate(`window.__xss === undefined && !document.querySelector('img[src="x"]')`)) && (await has('onerror')));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  check('setup fits a phone screen', (await evaluate(`document.documentElement.scrollWidth - window.innerWidth`)) <= 0);
  await shot('01a-phone-teachers');
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  await press('Change teacher for DBMS in SY Comp');
  await waitFor(`__has('Split by division')`);
  await press('Split DBMS for SY Comp by division');
  await waitFor(`__has('SY Comp A') && __has('SY Comp B')`);
  await press('Dr. Rao for DBMS in SY Comp B');
  await sleep(300);
  await shot('01d-teachers');
  check('one subject can have a different teacher per division', await has('All subjects have a teacher'));
  await click('Continue');
  await waitFor(`__has('Step 4 of 4')`);

  // Step 4: rooms and the week, then the estimate.
  check('rooms are suggested', (await has('Room 101')) && (await has('Lab 1')));
  await shot('01e-rooms-week');
  await click('Looks right');
  await waitFor(`__has('Build 3 versions')`);
  check('the estimate shows how full the week is', (await has('periods a week')) && (await has('4 classes,')));
  await shot('01f-estimate');
  await click('Build 3 versions');
  await waitFor(`__has('3 versions ready to compare')`, 120000);
  await click('See my timetable');
  await waitFor(`__has('Compare versions')`, 20000);
  check('a first user gets a clash-free timetable', await has('No clashes'));
  await shot('01g-first-timetable');
  await click('SY Comp');
  await waitFor(`__has('SY Comp B')`, 5000);
  check('classes can be narrowed down by year and branch', true);
  const firstSaved = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const firstVersions = await (await fetch(`${API}/api/institutions/${firstSaved.institution.id}/timetables`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const saved = firstSaved.institution.data.profile ?? firstSaved.institution.data;
  const dbms = saved.subjects.find((s) => s.name === 'DBMS' && s.group === 'SY|Comp');
  const divisionB = saved.divisions.find((x) => x.name === 'SY Comp B');
  const divisionA = saved.divisions.find((x) => x.name === 'SY Comp A');
  const sessionsOf = (division) => firstVersions[0].generatedSessions.filter((x) => x.subject_id === dbms.id && x.division_id === division.id);
  const nameOf = (id) => saved.teachers.find((x) => x.id === id)?.name;
  check('the timetable uses each division’s own teacher', sessionsOf(divisionA).every((x) => nameOf(x.teacher_id) === 'Prof. Mehta') && sessionsOf(divisionB).every((x) => nameOf(x.teacher_id) === 'Dr. Rao') && sessionsOf(divisionB).length > 0);
  await fetch(`${API}/api/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  await evaluate(`localStorage.clear()`);
  await go(APP);
  await waitFor(`__has('planned with you')`);

  // The rest of the app, on the full sample department.
  token = await signUp(email);
  await click('Use sample data instead');
  await waitFor(`__has('Build 3 versions')`, 15000);
  await shot('02-onboarding-review');
  await click('Build 3 versions');
  await waitFor(`__has('3 versions ready to compare')`, 120000);
  check('three versions built from onboarding', true);
  await click('See my timetable');
  await waitFor(`__has('Compare versions')`, 20000);
  check('timetable shows the comparison', true);
  check('no clashes in the built timetable', await has('No clashes'));
  await shot('03-timetable');

  // Tap a class: the explanation sheet lists reasons and legal moves.
  await evaluate(`(() => { const tile = [...document.querySelectorAll('[aria-label$="Tap for details"]')].find(__visible); tile.click(); return true; })()`);
  await waitFor(`__has('Why it is here')`, 5000);
  check('tapping a class explains why it is there', true);
  await shot('04-explain');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);

  await click('Choose this');
  await sleep(800);
  await go(`${APP}/home`);
  await waitFor(`__has('Approve your timetable')`, 10000);
  check('home says what to do next', true);
  await shot('05-home');

  await go(`${APP}/assistant`);
  await waitFor(`__has('TimeFlex assistant')`);
  await type('Tell me what changed…', 'Mehta is on leave from Monday to Wednesday for a conference');
  await evaluate(`__enter('Tell me what changed…')`);
  await waitFor(`__has('I will:')`, 15000);
  check('assistant previews the leave before applying', await has('on leave from'));
  await click('Apply');
  await waitFor(`__has('Done:')`, 10000);
  await shot('06-assistant');
  await sleep(1500);
  const me = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const leave = me.institution?.data?.operations?.absences ?? [];
  check('leave saved on the server', leave.length >= 3, `${leave.length} absence days`);

  // Approve, tell teachers, change a room, and see that only the affected teacher needs telling.
  const openWindows = `(window.__opened = [], window.open = (url) => { window.__opened.push(url); return null; }, true)`;
  await go(`${APP}/timetable`);
  await waitFor(`__has('Compare versions')`, 15000);
  await click('Approve');
  await waitFor(`__has('Now let your teachers know')`, 10000);
  check('approving prompts to tell the teachers', true);
  await go(`${APP}/updates`);
  await evaluate(openWindows);
  await waitFor(`__has('Prepare the messages')`, 10000);
  check('a new timetable means every teacher needs telling', await has('New timetable'));
  await shot('08-updates-ready');
  await click('Prepare the messages');
  await waitFor(`__has('0 of') && __has('Send to ')`, 10000);
  check('nothing new is waiting once messages are prepared', await has('Nothing new to tell anyone'));
  await shot('09-updates-tracking');
  await click('Send to ', false);
  await waitFor(`__has('Did you send it to') && __has('Yes, sent')`, 5000);
  const opened = await evaluate(`window.__opened[0] ?? ''`);
  check('WhatsApp opens with the teacher’s number and own message', /^https:\/\/wa\.me\/\d+\?text=Hello/.test(opened), opened.slice(0, 40));
  await click('Yes, sent');
  await waitFor(`__has('1 of')`, 5000);
  check('sent teachers are counted as told', true);
  check('it moves straight on to the next teacher', await has('Send to '));
  await shot('10-updates-one-told');
  await sleep(1000);

  await go(`${APP}/timetable`);
  await waitFor(`__has('Compare versions')`, 15000);
  // Not every class has another room free, so look for one that does.
  const tiles = await evaluate(`[...document.querySelectorAll('[aria-label$="Tap for details"]')].filter(__visible).length`);
  let roomOffered = false;
  for (let i = 0; i < tiles && !roomOffered; i += 1) {
    await evaluate(`[...document.querySelectorAll('[aria-label$="Tap for details"]')].filter(__visible)[${i}].click()`);
    await waitFor(`__has('Why it is here')`, 5000);
    roomOffered = await has('Change the room');
    if (!roomOffered) {
      await check0Close();
      await sleep(300);
    }
  }
  if (!roomOffered) throw new Error('no class had another room free');
  await sleep(500);
  await shot('11-change-room');
  check('a class offers free rooms to change to', true);
  await evaluate(`(() => { const label = [...document.querySelectorAll('div')].find((d) => __visible(d) && d.children.length === 0 && d.textContent.startsWith('Change the room')); const chip = label.parentElement.querySelector('[role="button"]'); chip.click(); return true; })()`);
  await waitFor(`__has('Undo')`, 5000);
  await sleep(500);
  await shot('12-undo');
  check('changing a room offers Undo', true);
  await sleep(1500);
  await go(`${APP}/updates`);
  await waitFor(`__has('1 timetable change')`, 10000);
  check('the room change is waiting to be told', await has('teacher'));
  await shot('13-updates-after-change');

  const statusAfter = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('the timetable stayed approved through the change', Boolean(statusAfter.institution));
  const tts = await (await fetch(`${API}/api/institutions/${statusAfter.institution.id}/timetables`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('it is still the approved version', tts.some((t) => t.status === 'approved'));

  // Reloading any screen must keep you signed in, with your data showing straight away.
  for (const page of ['more', 'setup/subjects', 'attendance', 'updates']) {
    await go(`${APP}/${page}`);
    await sleep(1200);
    const still = await evaluate(`location.pathname.includes('welcome') === false && !!localStorage.getItem('timeflex.session')`);
    check(`reloading ${page} keeps you signed in`, still);
  }
  await go(`${APP}/attendance`);
  await waitFor(`__has('Tap the students who are absent') || __has('has no classes on this day')`, 8000);
  check('attendance opens on a class with its students', !(await has('No class list yet')));
  await shot('18-attendance');
  await go(`${APP}/setup/subjects`);
  await waitFor(`__has('Operating Systems')`, 5000);
  check('setup screens show saved data after a reload', !(await has('No subjects yet')));

  // Adding to the setup updates the timetable without moving anything.
  const sessionsBefore = (await (await fetch(`${API}/api/institutions/${statusAfter.institution.id}/timetables`, { headers: { Authorization: `Bearer ${token}` } })).json()).find((t) => t.status === 'approved').generatedSessions;
  await go(`${APP}/onboarding?step=subjects`);
  await waitFor(`__has('Subjects for')`, 8000);
  await type('e.g. DBMS, Operating Systems, DBMS Lab', 'Ethics');
  await click('Add subjects');
  await waitFor(`__has('Ethics')`, 3000);
  await sleep(1500);
  await go(`${APP}/timetable`);
  await waitFor(`__has('Your setup has changed')`, 10000);
  check('the timetable notices the setup has changed', await has('new class'));
  await shot('15-setup-changed');
  await click('Update the timetable');
  await waitFor(`__has('Everything else stayed where it was')`, 40000);
  await sleep(1500);
  const afterAll = await (await fetch(`${API}/api/institutions/${statusAfter.institution.id}/timetables`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const nowLive = afterAll.filter((t) => t.status === 'approved');
  check('there is exactly one approved timetable afterwards', nowLive.length === 1, String(nowLive.length));
  const place = (s) => `${s.id}|${s.day}|${s.slot}|${s.room_id}|${s.teacher_id}`;
  const afterPlaces = new Set(nowLive[0].generatedSessions.map(place));
  check('every existing class stayed exactly where it was', sessionsBefore.every((s) => afterPlaces.has(place(s))), `${sessionsBefore.length} checked`);
  check('the new classes were added', nowLive[0].generatedSessions.length > sessionsBefore.length);
  check('classes are not left showing as locked', !nowLive[0].generatedSessions.some((s) => s.locked));

  // Removing a year warns first and can be undone; renaming keeps everything.
  await go(`${APP}/onboarding?step=classes`);
  await waitFor(`__has('Years')`, 8000);
  await click('TY');
  await waitFor(`__has('Remove these?')`, 5000);
  check('removing a year asks first and says what would go', await has('Yes, remove them'));
  await shot('16-remove-warning');
  await click('Keep them');
  await sleep(500);
  check('choosing to keep it removes nothing', await has('TY Comp'));
  await click('Rename');
  await waitFor(`__has('Rename years and branches')`, 3000);
  await sleep(300);
  await shot('17-rename');
  await click('Done');
  await sleep(400);

  // Sample data and starting over.
  await go(`${APP}/more`);
  await waitFor(`__has('Start over')`, 8000);
  await click('Start over');
  await waitFor(`__has('can’t be undone')`, 3000);
  check('starting over warns that it cannot be undone', true);
  await click('Keep what I have');
  await sleep(400);

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await go(`${APP}/updates`);
  await waitFor(`__has('Tell your teachers')`, 10000);
  check('updates fits a phone screen', (await evaluate(`document.documentElement.scrollWidth - window.innerWidth`)) <= 0);
  await shot('14-phone-updates');
  await go(`${APP}/timetable`);
  await waitFor(`__has('Mon') && __has('Timetable')`, 10000);
  const overflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('no sideways scrolling on a phone', overflow <= 0, `${overflow}px`);
  await shot('07-phone-timetable');

  // Signed out, a page that needs an account goes to the start page.
  const keep = await evaluate(`localStorage.getItem('timeflex.session')`);
  await evaluate(`localStorage.removeItem('timeflex.session')`);
  await go(`${APP}/setup/subjects`);
  await waitFor(`location.pathname === '/welcome'`, 8000);
  check('signed out, setup pages go to the start page', true);
  await evaluate(`localStorage.setItem('timeflex.session', ${JSON.stringify(keep)})`);

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  check(`flow completed: ${error.message}`, false);
  await shot('error').catch(() => {});
} finally {
  if (token) {
    const res = await fetch(`${API}/api/auth/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    console.log(`  cleanup: test account ${res?.ok ? 'deleted' : 'NOT deleted'}`);
  }
  ws.close();
  chrome.kill();
  await sleep(300);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  // Chrome can hold its folder a moment longer, and that must not hide the result.
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    // A temporary folder left behind does no harm.
  }
  process.exitCode = failed ? 1 : 0;
}
