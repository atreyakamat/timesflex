// Starts solver (Python), API (Node) and web (Vite) together with prefixed logs.
// Usage: npm run dev
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const venvPython = path.join(root, 'services/solver/.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');

if (!existsSync(venvPython)) {
  console.error('Solver virtualenv not found. Run "npm run setup" once first.');
  process.exit(1);
}

const services = [
  {
    name: 'solver',
    color: 35,
    command: venvPython,
    args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'],
    cwd: 'services/solver',
  },
  { name: 'api', color: 36, command: process.execPath, args: ['--watch', 'src/index.js'], cwd: 'apps/api' },
  {
    name: 'web',
    color: 32,
    command: process.execPath,
    args: [path.join(root, 'node_modules/vite/bin/vite.js')],
    cwd: 'apps/web',
  },
];

const children = services.map(({ name, color, command, args, cwd }) => {
  const child = spawn(command, args, { cwd: path.join(root, cwd), env: process.env });
  const prefix = `\x1b[${color}m[${name.padEnd(6)}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
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

console.log('TimeFlex starting… open http://localhost:5173');
