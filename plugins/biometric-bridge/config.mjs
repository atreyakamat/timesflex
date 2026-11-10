// Settings come from a JSON file (BRIDGE_CONFIG), or for the simple case of one push machine,
// from environment variables alone. The device key is best kept in the environment, not the file.
import { existsSync, readFileSync } from 'node:fs';

import { SOURCES } from './adapters/index.mjs';

export const loadConfig = (env = process.env) => {
  const file = env.BRIDGE_CONFIG;
  let config = {};
  if (file) {
    if (!existsSync(file)) throw new Error(`BRIDGE_CONFIG points at ${file}, which doesn't exist`);
    try {
      config = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`${file} isn't valid JSON: ${error.message}`);
    }
  }
  const url = env.TIMEFLEX_URL ?? config.timeflexUrl;
  const key = env.TIMEFLEX_DEVICE_KEY ?? config.deviceKey;
  const offset = env.COLLEGE_UTC_OFFSET ?? config.utcOffset ?? '+05:30';
  if (!url || !key) throw new Error('Set TIMEFLEX_URL and TIMEFLEX_DEVICE_KEY. Make the key in TimeFlex: More > Devices.');
  if (!/^[+-]\d{2}:\d{2}$/.test(offset)) throw new Error('The UTC offset must look like +05:30');
  const serials = (env.ALLOWED_SERIALS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const sources = config.sources ?? [{ type: 'zkteco-adms', port: Number(env.PORT ?? 8081), serials }];
  if (!Array.isArray(sources) || !sources.length) throw new Error('"sources" must list at least one source');
  for (const [index, source] of sources.entries()) {
    if (!SOURCES[source?.type]) throw new Error(`Source ${index + 1}: "type" must be one of ${Object.keys(SOURCES).join(', ')}`);
  }
  return {
    url,
    key,
    offset,
    queueFile: env.QUEUE_FILE ?? config.queueFile ?? 'timeflex-queue.json',
    flushSeconds: Number(env.FLUSH_SECONDS ?? config.flushSeconds ?? 15),
    sources,
  };
};
