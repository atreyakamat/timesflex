// For machines that push attendance over the network themselves (ZKTeco "ADMS" / "Cloud server"
// / "PUSH" setting, and machines built on the same firmware). Unverified on real hardware.
import http from 'node:http';

import { handleIclock } from '../bridge.mjs';

const MAX_BODY = 2 * 1024 * 1024;

export const createAdmsSource = (options, { enqueue, log, offset, onReceived }) => {
  const serials = options.serials ?? [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://bridge');
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        response.writeHead(413).end('Too large');
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      const { status, body } = handleIclock({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: Buffer.concat(chunks).toString('utf8') }, { enqueue, offset, serials });
      response.writeHead(status, { 'Content-Type': 'text/plain' }).end(body);
      if (url.pathname === '/iclock/cdata' && request.method === 'POST' && status === 200) onReceived?.();
    });
  });
  return {
    start: () => new Promise((resolve) => server.listen(options.port ?? 8081, () => {
      log(`${options.name ?? 'zkteco-adms'}: machines can report to port ${server.address().port}`);
      if (!serials.length) log('Any machine on this network can report here. List your machines\' serial numbers in "serials".');
      resolve();
    })),
    stop: () => new Promise((resolve) => server.close(resolve)),
    port: () => server.address()?.port,
  };
};
