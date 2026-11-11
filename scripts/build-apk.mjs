// Builds the Android app inside Docker. Usage: npm run docker:apk -- http://192.168.1.20:8080
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2];

if (!url || !/^https?:\/\/\S+$/.test(url) || /\/\/(localhost|127\.0\.0\.1)\b/.test(url)) {
  console.error('Give the address phones will use to reach the server, for example:');
  console.error('  npm run docker:apk -- http://192.168.1.20:8080');
  console.error('  npm run docker:apk -- https://timetable.example.com');
  console.error('"localhost" will not work: on a phone it means the phone itself.');
  process.exit(1);
}

console.log(`Building TimeFlex.apk for ${url}. The first build takes 20 minutes or more.`);
execFileSync(
  'docker',
  ['build', '-f', 'docker/android.Dockerfile', '--build-arg', `API_URL=${url.replace(/\/$/, '')}`, '--output', 'type=local,dest=dist-apk', '.'],
  { cwd: root, stdio: 'inherit' },
);
console.log(`\nDone: ${path.join(root, 'dist-apk', 'TimeFlex.apk')}`);
