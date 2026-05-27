import http from 'node:http';

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        service: 'timesflex-api',
        status: 'ok',
      }),
    );
    return;
  }

  if (request.method === 'POST' && request.url === '/api/timetable/generate') {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });

    request.on('end', () => {
      const requestPayload = body ? JSON.parse(body) : {};

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'queued',
          timetableType: 'college-department',
          received: requestPayload,
        }),
      );
    });

    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

const port = process.env.PORT ?? 3001;

server.listen(port, () => {
  console.log(`TimeFlex API listening on port ${port}`);
});
