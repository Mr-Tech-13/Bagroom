const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8083);
const publicDir = path.join(__dirname, 'public');
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');

const emptyState = () => ({
  ulds: [],
  requirements: [],
  chuteNames: ['', '', ''],
  assignments: Object.fromEntries([
    ...Array.from({ length: 12 }, (_, i) => `slot-${i + 1}`),
  ].map((key) => [key, null])),
  updatedAt: null
});

function normalizeState(value = {}) {
  const defaults = emptyState();
  return {
    ...defaults,
    ...value,
    chuteNames: Array.from({ length: 3 }, (_, index) => value.chuteNames?.[index] || ''),
    assignments: { ...defaults.assignments, ...(value.assignments || {}) }
  };
}

function readState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read state:', error.message);
    return emptyState();
  }
}

function writeState(value) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const next = { ...normalizeState(value), updatedAt: new Date().toISOString() };
  fs.writeFileSync(dataFile, JSON.stringify(next, null, 2));
  return next;
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function serveFile(request, response) {
  const requestPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = path.resolve(publicDir, `.${requestPath}`);
  if (!filePath.startsWith(publicDir)) return json(response, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, contents) => {
    if (error) return json(response, error.code === 'ENOENT' ? 404 : 500, { error: 'Not found' });
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    response.end(contents);
  });
}

const server = http.createServer((request, response) => {
  if (request.url === '/api/state' && request.method === 'GET') return json(response, 200, readState());
  if (request.url === '/api/state' && request.method === 'PUT') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on('end', () => {
      try {
        json(response, 200, writeState(JSON.parse(body)));
      } catch (error) {
        json(response, 400, { error: 'Invalid state data' });
      }
    });
    return;
  }
  if (request.method === 'GET') return serveFile(request, response);
  json(response, 405, { error: 'Method not allowed' });
});

server.listen(port, host, () => console.log(`ULD tracker listening on http://${host}:${port}`));
