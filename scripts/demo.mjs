// Pitch-day launcher: builds the app (first time, or with --rebuild), starts the solver,
// the API (reading apps/api/.env for ANTHROPIC_API_KEY) and the app, then opens the browser.
// Usage: npm run demo            (add -- --rebuild after changing the app)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const venvPython = path.join(root, 'services/solver/.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
const appDist = path.join(root, 'apps/mobile/dist-web');
const APP_URL = 'http://localhost:8081';

if (!existsSync(venvPython)) {
  console.error('Run "npm run setup" once first (it creates the solver environment and installs the app).');
  process.exit(1);
}

// Is Claude switched on? (An exported key works too; the API reads apps/api/.env itself.)
const envFile = path.join(root, 'apps/api/.env');
const keyInFile = existsSync(envFile) && /^\s*ANTHROPIC_API_KEY\s*=\s*\S+/m.test(readFileSync(envFile, 'utf8'));
const claude = keyInFile || Boolean(process.env.ANTHROPIC_API_KEY);

if (!existsSync(path.join(appDist, 'index.html')) || process.argv.includes('--rebuild')) {
  console.log('Building the app for the browser (about a minute, first time only)…');
  execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web'], {
    cwd: path.join(root, 'apps/mobile'),
    stdio: 'inherit',
    shell: isWindows,
  });
}

const services = [
  { name: 'solver', color: 35, command: venvPython, args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], cwd: 'services/solver' },
  { name: 'api', color: 36, command: process.execPath, args: ['--env-file-if-exists=.env', 'src/index.js'], cwd: 'apps/api' },
  { name: 'app', color: 32, command: process.execPath, args: ['scripts/serve-app.mjs', 'apps/mobile/dist-web', '8081'], cwd: '.' },
];

const children = services.map(({ name, color, command, args, cwd }) => {
  const child = spawn(command, args, { cwd: path.join(root, cwd), env: process.env });
  const prefix = `\x1b[${color}m[${name.padEnd(6)}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
  child.on('exit', (code) => {
    console.log(`${prefix}stopped (${code})`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Open the browser once the API answers.
const ready = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const [api, app] = await Promise.all([fetch('http://127.0.0.1:3001/health'), fetch(APP_URL)]);
      if (api.ok && app.ok) return true;
    } catch {
      // Still starting.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
if (await ready()) {
  console.log(`\n  TimeFlex demo is running at ${APP_URL}`);
  console.log(
    claude
      ? '  Assistant: Claude (claude-sonnet-5-5) is on.'
      : '  Assistant: no ANTHROPIC_API_KEY yet, so the built-in rules are used.\n  Copy apps/api/.env.example to apps/api/.env and add your key to turn on Claude.',
  );
  console.log('  Click "Try the live demo" for a ready-made college. Press Ctrl+C to stop.\n');
  const opener = isWindows ? ['cmd', ['/c', 'start', '', APP_URL]] : process.platform === 'darwin' ? ['open', [APP_URL]] : ['xdg-open', [APP_URL]];
  if (!process.argv.includes('--no-open')) spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
}
