// The logic of the bridge, with no dependencies, so it can run on anything with Node 18+.
// Speaks the "push" protocol biometric machines use (ZKTeco ADMS and compatibles) on one side
// and the TimeFlex device API on the other.
//
// The machine protocol here comes from public third-party write-ups, not the vendor, and hasn't
// been tried on real hardware yet. See README.md.
import crypto from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { parsePunches } from './punchfile.mjs';

const BATCH = 200;
const TIME = /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Attendance log lines: "<person id>\t<time>\t<status>\t<how they verified>...". Anything else is skipped. */
export const parseAttlog = (body) => {
  const lines = [];
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const [pin, time] = raw.split('\t').map((field) => field.trim());
    const match = time && TIME.exec(time);
    if (!pin || !match) continue;
    const [, year, month, day, hour, minute, second = '00'] = match;
    lines.push({ pin, time: `${year}-${month}-${day} ${hour}:${minute}:${second}` });
  }
  return lines;
};

/** Machines report local time with no zone, so the bridge has to be told which zone it's in. */
export const deviceLineToScan = ({ pin, time }, serial, offset) => ({
  identifier: pin,
  at: new Date(`${time.replace(' ', 'T')}${offset}`).toISOString(),
  // Machines resend after a lost connection. The same punch always gets the same id.
  scanId: crypto.createHash('sha256').update(`${serial}|${pin}|${time}`).digest('hex').slice(0, 32),
});

const greeting = (serial) =>
  [`GET OPTION FROM: ${serial}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=60', 'Delay=30', 'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=None'].join('\n');

/**
 * One request from a machine. Pure, so it can be tested without a network.
 * `serials`, if given, is the list of machines allowed to report: the protocol has no password.
 */
export const handleIclock = ({ method, path, query = {}, body = '' }, { enqueue, offset, serials }) => {
  const reply = (status, text) => ({ status, body: text });
  if (!path.startsWith('/iclock/')) return reply(404, 'Not found');
  const serial = query.SN;
  if (!serial) return reply(400, 'Missing serial number');
  if (serials?.length && !serials.includes(serial)) return reply(403, 'Unknown machine');

  if (path === '/iclock/cdata' && method === 'GET') return reply(200, greeting(serial));
  if (path === '/iclock/cdata' && method === 'POST') {
    if (query.table !== 'ATTLOG') return reply(200, 'OK'); // Staff changes, photos and so on: not ours.
    const lines = parseAttlog(body);
    enqueue(lines.map((line) => deviceLineToScan(line, serial, offset)));
    return reply(200, `OK: ${lines.length}`);
  }
  // Asking for commands, or reporting results. We never send any.
  return reply(200, 'OK');
};

/** Keeps scans on disk until TimeFlex has them, so a restart or an outage loses nothing. */
export const createBridge = ({ url, key, offset, queueFile, fetchImpl = fetch, log = () => {} }) => {
  const base = url.replace(/\/+$/, '');
  let queue = [];
  if (queueFile && existsSync(queueFile)) {
    try {
      queue = JSON.parse(readFileSync(queueFile, 'utf8'));
    } catch {
      // Don't throw away something a person might recover by hand, and don't refuse to start.
      renameSync(queueFile, `${queueFile}.corrupt-${Date.now()}`);
      log(`The queue file couldn't be read, and was kept beside it as .corrupt`);
    }
  }
  const save = () => {
    if (!queueFile) return;
    const temp = `${queueFile}.tmp`;
    writeFileSync(temp, JSON.stringify(queue));
    renameSync(temp, queueFile);
  };
  const setAside = (scans) => {
    if (queueFile) writeFileSync(`${queueFile}.rejected`, `${scans.map((scan) => JSON.stringify(scan)).join('\n')}\n`, { flag: 'a' });
    log(`TimeFlex refused ${scans.length} scan(s). Often the machine's clock is wrong. Kept in ${queueFile}.rejected`);
  };
  const send = (scans) =>
    fetchImpl(`${base}/api/device/v1/scans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ scans }),
      signal: AbortSignal.timeout(30000),
    });

  let flushing = null;
  const drain = async () => {
    const result = { sent: 0, unmatched: [], rejected: 0 };
    const finish = (scans, body) => {
      queue = queue.slice(scans.length);
      save();
      result.sent += scans.length;
      result.unmatched.push(...(body?.unmatched ?? []));
    };
    while (queue.length) {
      const batch = queue.slice(0, BATCH);
      let response;
      try {
        response = await send(batch);
      } catch (error) {
        return { ...result, error: `Can't reach TimeFlex: ${error.message}` };
      }
      if (response.ok) {
        finish(batch, await response.json().catch(() => ({})));
        continue;
      }
      if (response.status !== 400) return { ...result, error: `TimeFlex answered ${response.status}${response.status === 401 ? ': check the device key' : ''}` };
      // One bad scan fails the whole batch, and it would block everything behind it forever.
      // Try each alone, and set aside only the ones truly refused.
      for (const scan of batch) {
        let single;
        try {
          single = await send([scan]);
        } catch (error) {
          return { ...result, error: `Can't reach TimeFlex: ${error.message}` };
        }
        if (single.ok) finish([scan], await single.json().catch(() => ({})));
        else if (single.status === 400) {
          setAside([scan]);
          queue = queue.slice(1);
          save();
          result.rejected += 1;
        } else return { ...result, error: `TimeFlex answered ${single.status}` };
      }
    }
    return result;
  };

  return {
    offset,
    enqueue(scans) {
      if (!scans.length) return;
      queue.push(...scans);
      save();
    },
    pending: () => queue.length,
    /** One at a time: two overlapping sends would each remove the other's scans from the queue. */
    flush() {
      flushing ??= drain().finally(() => {
        flushing = null;
      });
      return flushing;
    },
  };
};

/** Any exported attendance file, read the same way as the app reads uploads. */
export const parseCsv = (text) => parsePunches(text).punches.map(({ id, time }) => ({ pin: id, time }));
