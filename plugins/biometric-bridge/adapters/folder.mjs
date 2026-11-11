// For machines whose software saves an attendance file (eTimeTrack-style tools, USB exports
// copied off the machine, or anything that writes CSV). Point this at the folder; new lines in
// new or growing files are sent. Works with any brand that can export a file.
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { deviceLineToScan } from '../bridge.mjs';
import { parsePunches } from '../punchfile.mjs';

const TYPES = /\.(csv|txt|dat|tsv|log)$/i;
// TimeFlex accepts scans up to 14 days old. Older lines would only be refused.
const MAX_AGE_DAYS = 13;

/**
 * Looks at the folder once. Remembers how many lines of each file it has sent, so a log the
 * software keeps adding to sends only what's new. A file that got shorter was replaced: read it again.
 */
export const scanFolder = (folder, state, { enqueue, offset, name, now = Date.now(), log = () => {} }) => {
  let sent = 0;
  for (const file of readdirSync(folder)) {
    if (!TYPES.test(file)) continue;
    const full = path.join(folder, file);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // Removed while we looked.
    }
    if (!stats.isFile()) continue;
    const seen = state[file];
    if (seen && seen.size === stats.size && seen.modified === stats.mtimeMs) continue;
    const { punches, skipped } = parsePunches(readFileSync(full, 'utf8'));
    const from = seen && stats.size >= seen.size ? seen.punches : 0;
    const fresh = punches.slice(from);
    const recent = fresh.filter((punch) => now - Date.parse(`${punch.time.replace(' ', 'T')}${offset}`) < MAX_AGE_DAYS * 86400000);
    if (fresh.length - recent.length) log(`${name}: ${file} has ${fresh.length - recent.length} punch(es) over ${MAX_AGE_DAYS} days old. Upload those in the app instead (More > Fingerprint machines).`);
    if (!seen && skipped) log(`${name}: couldn't read ${skipped} line(s) of ${file}.`);
    enqueue(recent.map((punch) => deviceLineToScan({ pin: punch.id, time: punch.time }, name, offset)));
    sent += recent.length;
    state[file] = { size: stats.size, modified: stats.mtimeMs, punches: punches.length };
  }
  return sent;
};

export const createFolderSource = (options, { enqueue, log, offset, stateFile, onReceived }) => {
  if (!options.path || !existsSync(options.path)) throw new Error(`The folder "${options.path}" doesn't exist`);
  const name = options.name ?? 'folder';
  let state = {};
  if (stateFile && existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {
      state = {};
    }
  }
  const save = () => {
    if (!stateFile) return;
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(state));
    renameSync(`${stateFile}.tmp`, stateFile);
  };
  const check = () => {
    try {
      const sent = scanFolder(options.path, state, { enqueue, offset, name, log });
      save();
      if (sent) {
        log(`${name}: found ${sent} new punch(es).`);
        onReceived?.();
      }
    } catch (error) {
      log(`${name}: ${error.message}`);
    }
  };
  let timer;
  return {
    start: async () => {
      log(`${name}: watching ${options.path} every ${options.every ?? 60} seconds`);
      check();
      timer = setInterval(check, (options.every ?? 60) * 1000);
    },
    stop: async () => clearInterval(timer),
    check,
  };
};
