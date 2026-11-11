// Bundles the TypeScript tests with esbuild (already installed with Vite) and runs them with node:test.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
// Inside the workspace so the bundles resolve packages from node_modules.
const cache = path.join(here, '../../../node_modules/.cache');
mkdirSync(cache, { recursive: true });
const outdir = mkdtempSync(path.join(cache, 'web-test-'));
const entryPoints = readdirSync(here)
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => path.join(here, file));

try {
  await build({
    entryPoints,
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    // Resolve packages from the workspace at run time instead of inlining them.
    packages: 'external',
    logLevel: 'warning',
  });
  const outputs = readdirSync(outdir).map((file) => path.join(outdir, file));
  execFileSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit', cwd: here });
} catch (error) {
  process.exitCode = error.status ?? 1;
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
