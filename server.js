const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8083);
const publicDir = path.join(__dirname, 'public');
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');
const allowedSlots = Array.from({ length: 12 }, (_, i) => `slot-${i + 1}`);

const emptyState = () => ({
  ulds: [],
  requirements: [],
  issues: [],
  chuteNames: ['', '', ''],
  assignments: Object.fromEntries(allowedSlots.map((key) => [key, null])),
  updatedAt: null
});

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

function cleanText(value, maxLength = 64) {
  return String(value || '').replace(/[^\w .:-]/g, '').slice(0, maxLength);
}

function cleanLongText(value, maxLength = 1000) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanCommodity(value) {
  const commodity = String(value || '').trim().toUpperCase();
  return /^(B[1-4][A-X]|MXT|BJ|BY|B0X|BTX)$/.test(commodity) ? commodity : '';
}

function normalizeState(value = {}) {
  const defaults = emptyState();
  const rawUlds = Array.isArray(value.ulds) ? value.ulds : [];
  const ulds = rawUlds.slice(0, 200).map((uld) => {
    const number = cleanText(uld?.number, 16).toUpperCase();
    return {
      id: cleanText(uld?.id, 80) || number,
      number,
      commodity: cleanCommodity(uld?.commodity),
      t2t: Boolean(uld?.t2t) && /^QKE/.test(number)
    };
  }).filter((uld) => /^[A-Z]{3}\d{3,8}EK$/.test(uld.number));
  const validIds = new Set(ulds.map((uld) => uld.id));
  const rawAssignments = value.assignments && typeof value.assignments === 'object' ? value.assignments : {};
  const assignments = Object.fromEntries(allowedSlots.map((slot) => {
    const id = cleanText(rawAssignments[slot], 80);
    return [slot, validIds.has(id) ? id : null];
  }));
  const requirements = (Array.isArray(value.requirements) ? value.requirements : []).slice(0, 200).map((item) => ({
    quantity: Math.min(Math.max(Number(item?.quantity) || 0, 0), 200),
    commodity: cleanCommodity(item?.commodity),
    t2t: Boolean(item?.t2t)
  })).filter((item) => item.quantity > 0 && item.commodity);
  const issues = (Array.isArray(value.issues) ? value.issues : []).slice(0, 500).map((issue) => {
    const status = issue?.status === 'closed' ? 'closed' : 'open';
    return {
      id: cleanText(issue?.id, 80) || `issue-${Date.now()}`,
      text: cleanLongText(issue?.text, 1000),
      status,
      createdAt: typeof issue?.createdAt === 'string' ? issue.createdAt : new Date().toISOString(),
      closedAt: status === 'closed' && typeof issue?.closedAt === 'string' ? issue.closedAt : null
    };
  }).filter((issue) => issue.text);
  return {
    ...defaults,
    ulds,
    requirements,
    issues,
    chuteNames: Array.from({ length: 3 }, (_, index) => {
      const name = String(value.chuteNames?.[index] || '').trim().toUpperCase();
      return /^MU\d{3}$/.test(name) ? name : '';
    }),
    assignments,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null
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
  response.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function serveFile(request, response) {
  const pathname = new URL(request.url, `http://${host}:${port}`).pathname;
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  if (requestPath.includes('\0')) return json(response, 400, { error: 'Bad request' });
  const filePath = path.resolve(publicDir, `.${requestPath}`);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) return json(response, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, contents) => {
    if (error) return json(response, error.code === 'ENOENT' ? 404 : 500, { error: 'Not found' });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8' };
    response.writeHead(200, { ...securityHeaders, 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(contents);
  });
}

const server = http.createServer((request, response) => {
  if (request.url === '/api/state' && request.method === 'GET') return json(response, 200, readState());
  if (request.url === '/api/state' && request.method === 'PUT') {
    if (!/^application\/json\b/i.test(request.headers['content-type'] || '')) return json(response, 415, { error: 'Expected JSON' });
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        response.writeHead(413, securityHeaders);
        response.end();
        request.destroy();
      }
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
