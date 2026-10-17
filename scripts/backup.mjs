// Back up or restore TimeFlex without Docker.
//   node scripts/backup.mjs                    save a backup into ./backups (keeps the newest BACKUP_KEEP, default 14)
//   node scripts/backup.mjs --restore <file>   replace the current data with a backup (stop the app first)
// PostgreSQL (DATABASE_URL set) needs pg_dump / pg_restore on PATH. The JSON file store is copied as is.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const databaseUrl = process.env.DATABASE_URL;
const dataFile = process.env.DATA_FILE ?? path.join(root, 'apps/api/data/timesflex.json');
const dir = path.resolve(root, process.env.BACKUP_DIR ?? 'backups');
const keep = Number(process.env.BACKUP_KEEP ?? 14);
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

function backup() {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const ext = databaseUrl ? 'dump' : 'json';
  const file = path.join(dir, `timesflex-${stamp}.${ext}`);
  if (databaseUrl) {
    run('pg_dump', ['--format=custom', `--file=${file}.partial`, databaseUrl]);
    renameSync(`${file}.partial`, file);
  } else {
    if (!existsSync(dataFile)) throw new Error(`No data yet at ${dataFile}.`);
    copyFileSync(dataFile, file);
  }
  console.log(`Saved ${file} (${Math.ceil(statSync(file).size / 1024)} KB)`);
  const old = readdirSync(dir)
    .filter((name) => name.startsWith('timesflex-') && name.endsWith(`.${ext}`))
    .sort()
    .reverse()
    .slice(keep);
  for (const name of old) rmSync(path.join(dir, name));
}

function restore(file) {
  if (!file || !existsSync(file)) throw new Error('Give the backup file to restore: --restore backups/timesflex-....dump');
  if (file.endsWith('.json')) {
    if (databaseUrl) throw new Error('That is a file-store backup, but DATABASE_URL is set.');
    copyFileSync(file, dataFile);
  } else {
    if (!databaseUrl) throw new Error('Set DATABASE_URL to restore a PostgreSQL backup.');
    run('pg_restore', ['--clean', '--if-exists', '--no-owner', `--dbname=${databaseUrl}`, file]);
  }
  console.log(`Restored ${file}. Start the app again.`);
}

try {
  const at = process.argv.indexOf('--restore');
  if (at === -1) backup();
  else restore(process.argv[at + 1]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
