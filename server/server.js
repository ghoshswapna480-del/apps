const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const apiToken = process.env.DAILYFLOW_API_TOKEN || '';
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!localHosts.has(host) && !apiToken) {
  throw new Error('Set DAILYFLOW_API_TOKEN before binding DailyFlow to a non-local host.');
}
if (apiToken && Buffer.byteLength(apiToken, 'utf8') < 32) {
  throw new Error('DAILYFLOW_API_TOKEN must contain at least 32 bytes.');
}
const dataDirectory = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(path.join(dataDirectory, 'dailyflow.sqlite'));
database.exec(`CREATE TABLE IF NOT EXISTS workspace_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);
const readState = database.prepare('SELECT state_json, updated_at FROM workspace_state WHERE id = 1');
const writeState = database.prepare(`INSERT INTO workspace_state (id, state_json, updated_at) VALUES (1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`);

app.disable('x-powered-by');
// Leave room for backups accepted by the browser (up to 5 MB) plus the sync
// request wrapper and JSON encoding overhead.
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'State must be an object.';
  for (const name of ['routines', 'classes', 'tasks', 'notes', 'journal']) {
    if (!Array.isArray(value[name])) return `State field "${name}" must be an array.`;
    if (value[name].length > 5000) return `State field "${name}" is too large.`;
    if (value[name].some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')) {
      return `Every item in "${name}" must be an object with a string ID.`;
    }
  }
  return null;
}

function requireApiToken(request, response, next) {
  if (!apiToken) return next();
  const authorization = request.get('authorization') || '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedBuffer = Buffer.from(apiToken);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer)) {
    return next();
  }
  response.status(401).json({ error: 'A valid API token is required.' });
}

app.get('/api/health', (request, response) => {
  try {
    database.prepare('SELECT 1').get();
    response.json({ status: 'ok', database: 'sqlite' });
  } catch (error) {
    response.status(500).json({ status: 'error', message: 'Database is unavailable.' });
  }
});

app.get('/api/state', requireApiToken, (request, response) => {
  try {
    const row = readState.get();
    if (!row) return response.json({ data: null, updatedAt: null });
    response.json({ data: JSON.parse(row.state_json), updatedAt: row.updated_at });
  } catch (error) {
    response.status(500).json({ error: 'Could not read workspace state.' });
  }
});

app.put('/api/state', requireApiToken, (request, response) => {
  const nextState = request.body?.state;
  const validationError = validateState(nextState);
  if (validationError) return response.status(400).json({ error: validationError });

  try {
    const updatedAt = new Date().toISOString();
    const persistedState = { ...nextState, updatedAt };
    writeState.run(JSON.stringify(persistedState), updatedAt);
    response.json({ status: 'saved', updatedAt });
  } catch (error) {
    response.status(500).json({ error: 'Could not save workspace state.' });
  }
});

const server = app.listen(port, host, () => {
  console.log(`DailyFlow running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
  // The test runner and browser may leave keep-alive connections open. Close
  // them during shutdown so the server can exit promptly on Windows too.
  server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
