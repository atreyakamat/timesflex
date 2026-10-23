// One-time setup: Python virtualenv for the solver, then a check for a local model.
// Usage: npm install && npm run setup
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const solver = path.join(root, 'services/solver');
const isWindows = process.platform === 'win32';
const venvPython = path.join(solver, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });

if (!existsSync(venvPython)) {
  console.log('Creating solver virtualenv (Python 3.11+)…');
  run(isWindows ? 'python' : 'python3', ['-m', 'venv', '.venv'], solver);
}
console.log('Installing solver dependencies (FastAPI, OR-Tools)…');
try {
  execFileSync(venvPython, ['-m', 'pip', '--version'], { stdio: 'ignore' });
} catch {
  // Virtualenvs made by some tools (e.g. uv) ship without pip.
  run(venvPython, ['-m', 'ensurepip', '--upgrade'], solver);
}
run(venvPython, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], solver);
run(venvPython, ['-m', 'pip', 'install', '--quiet', '-e', '.[dev]'], solver);

// The app (Android, iOS and web) keeps its own node_modules: it needs React 19, the old web app React 18.
execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: path.join(root, 'apps/mobile'), stdio: 'inherit', shell: isWindows });

const model = process.env.AI_MODEL ?? 'qwen3:0.6b';
try {
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
  const { models = [] } = await response.json();
  const installed = models.some((item) => item.name === model || item.name === `${model}:latest`);
  console.log(
    installed
      ? `Ollama is running and ${model} is installed.`
      : `Ollama is running. Pull the model once with:  ollama pull ${model}`,
  );
} catch {
  console.log(
    `Ollama not detected. Optional: install it from https://ollama.com, then run  ollama pull ${model}\n` +
      'Without it, Quick setup falls back to the basic rule parser; everything else works.',
  );
}
console.log('\nSetup done. Start the server with  npm run dev  and the app with  npm run app');
