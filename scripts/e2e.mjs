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
    await waitFor(`__has('Step 1 of 5') && __has('Who teaches at E2E Test College')`, 15000);
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
  await click('Paste a list instead');
  await type('Prof. Mehta: DBMS, Operating Systems\nDr. Rao: Maths\nProf. Iyer: Networks, Networks Lab', 'Prof. Mehta: DBMS, Operating Systems, DBMS Lab\nDr. Rao - Maths\nIyer teaches Networks and Software Engineering\n<img src=x onerror="window.__xss=1">: <script>window.__xss=1</script>');
  await click('Add them all');
  await waitFor(`__has('4 teachers added')`);
  check('a pasted list adds every teacher', await has('Dr. Rao'));
  await sleep(300);
  check('code typed as a teacher’s name stays plain text', (await evaluate(`window.__xss === undefined && !document.querySelector('img[src="x"]')`)) && (await has('onerror')));
  await shot('01c-teachers');
  await click('Continue');
  await waitFor(`__has('Step 2 of 5')`);
  await type('e.g. SE-A', 'SE-A');
  await click('Add class');
  await waitFor(`__has('1 class added')`);
  await click('Continue');
  await waitFor(`__has('Step 3 of 5')`);
  await shot('01b-week');
  await click('Looks right');
  await waitFor(`__has('Step 4 of 5')`);
  check('subjects come from what the teachers can teach', (await has('Operating Systems')) && (await has('Software Engineering')) && (await has('DBMS Lab')));
  await shot('01d-subjects');
  await click('Continue');
  await waitFor(`__has('Step 5 of 5')`);
  check('rooms are suggested', (await has('Room 101')) && (await has('Lab 1')));
  await click('Continue');
  await waitFor(`__has('Build 3 versions')`);
  check('the estimate shows how full the week is', (await has('periods a week')) && (await has('1 class,')));
  await shot('01e-estimate');
  await click('Build 3 versions');
  await waitFor(`__has('3 versions ready to compare')`, 120000);
  await click('See my timetable');
  await waitFor(`__has('Compare versions')`, 20000);
  check('a first user gets a clash-free timetable', await has('No clashes'));
  await shot('01f-first-timetable');
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
  await waitFor(`__has('You seem to prefer') || __has('Pick versions and move classes')`, 10000);
  check('home shows the learned preference line', true);
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

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await go(`${APP}/timetable`);
  await waitFor(`__has('Mon') && __has('Timetable')`, 10000);
  const overflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  check('no sideways scrolling on a phone', overflow <= 0, `${overflow}px`);
  await shot('07-phone-timetable');

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
  rmSync(profileDir, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
