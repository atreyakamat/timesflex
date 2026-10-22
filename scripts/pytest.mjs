// Runs the solver test suite inside its virtualenv.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const solver = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../services/solver');
const python = path.join(solver, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
execFileSync(python, ['-m', 'pytest', '-q', 'tests'], { cwd: solver, stdio: 'inherit' });
