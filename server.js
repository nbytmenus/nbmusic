const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_PANEL_PASSWORD = process.env.ADMIN_PANEL_PASSWORD || 'changeme-dev-password';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sessions = new Map();

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { users: [], tracks: [], counters: { user: 0, track: 0 } };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt] = stored.split(':');
  return hashPassword(password, salt) === stored;
}

function seedAdmin() {
  const db = loadDb();
  if (!db.users.find((u) => u.username === ADMIN_USERNAME)) {
    db.counters.user += 1;
    db.users.push({
      id: db.counters.user,
      username: ADMIN_USERNAME,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      isAdmin: true,
      createdAt: new Date().toISOString()
    });
    saveDb(db);
    console.log(`Created admin '${ADMIN_USERNAME}'`);
  }
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((entry) => {
        const idx = entry.indexOf('=');
        return [entry.slice(0, idx), decodeURIComponent(entry.slice(idx + 1))];
      })
  );
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return sessions.get(sid) || null;
}

function createSession(res, user) {
  const sid = crypto.randomUUID();
  sessions.set(sid, { user, devUnlocked: false, createdAt: Date.now() });
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/`);
}

function destroySession(req, res) {
  const sid = parseCookies(req).sid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/');
}

function sanitizeFilePath(base, target) {
  const safePath = path.normalize(path.join(base, target));
  if (!safePath.startsWith(base)) return null;
  return safePath;
}

function serveFile(res, filePath, contentType = 'text/plain') {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, pathname) {
  let requestPath = pathname === '/' ? '/index.html' : pathname;
  const safe = sanitizeFilePath(PUBLIC_DIR, requestPath);
  if (!safe || !fs.existsSync(safe) || fs.statSync(safe).isDirectory()) {
    return false;
  }
  const ext = path.extname(safe).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  serveFile(res, safe, types[ext] || 'application/octet-stream');
  return true;
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const session = getSession(req);

  if (pathname === '/api/me' && req.method === 'GET') {
    sendJson(res, 200, { user: session?.user || null, devUnlocked: !!session?.devUnlocked });
    return;
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || password.length < 6) {
      sendJson(res, 400, { error: 'Username and password (min 6 chars) are required' });
      return;
    }

    const db = loadDb();
    if (db.users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 400, { error: 'Username already exists' });
      return;
    }

    db.counters.user += 1;
    db.users.push({
      id: db.counters.user,
      username,
      passwordHash: hashPassword(password),
      isAdmin: false,
      createdAt: new Date().toISOString()
    });
    saveDb(db);
    sendJson(res, 200, { success: true });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    const db = loadDb();
    const user = db.users.find((u) => u.username === username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJson(res, 401, { error: 'Invalid credentials' });
      return;
    }

    createSession(res, { id: user.id, username: user.username, is_admin: user.isAdmin });
    sendJson(res, 200, { user: { id: user.id, username: user.username, is_admin: user.isAdmin } });
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    destroySession(req, res);
    sendJson(res, 200, { success: true });
    return;
  }

  if (pathname === '/api/admin/unlock' && req.method === 'POST') {
    if (!session?.user) return sendJson(res, 401, { error: 'Unauthorized' });
    if (!session.user.is_admin) return sendJson(res, 403, { error: 'Admin access required' });

    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (String(body.password || '') !== ADMIN_PANEL_PASSWORD) {
      return sendJson(res, 401, { error: 'Invalid admin panel password' });
    }
    session.devUnlocked = true;
    sendJson(res, 200, { success: true });
    return;
  }

  if (pathname === '/api/tracks' && req.method === 'GET') {
    if (!session?.user) return sendJson(res, 401, { error: 'Unauthorized' });
    const db = loadDb();
    const tracks = db.tracks
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((t) => ({ id: t.id, title: t.title, artist: t.artist, uploader: t.uploader, created_at: t.createdAt }));
    sendJson(res, 200, { tracks });
    return;
  }

  if (pathname === '/api/tracks/upload' && req.method === 'POST') {
    if (!session?.user) return sendJson(res, 401, { error: 'Unauthorized' });
    if (!session.user.is_admin) return sendJson(res, 403, { error: 'Admin access required' });
    if (!session.devUnlocked) return sendJson(res, 403, { error: 'Unlock dev panel first' });

    const title = String(url.searchParams.get('title') || '').trim();
    const artist = String(url.searchParams.get('artist') || '').trim();
    const originalName = String(url.searchParams.get('filename') || 'track.mp3').replace(/[^\w.-]/g, '_');
    const contentType = req.headers['content-type'] || 'audio/mpeg';

    if (!title || !artist || !contentType.startsWith('audio/')) {
      return sendJson(res, 400, { error: 'Valid title, artist, and audio content-type are required' });
    }

    const body = await readBody(req);
    if (!body.length) return sendJson(res, 400, { error: 'Empty upload' });

    const ext = path.extname(originalName) || '.mp3';
    const savedName = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, savedName), body);

    const db = loadDb();
    db.counters.track += 1;
    db.tracks.push({
      id: db.counters.track,
      title,
      artist,
      filename: savedName,
      mimeType: contentType,
      uploader: session.user.username,
      createdAt: new Date().toISOString()
    });
    saveDb(db);
    sendJson(res, 200, { success: true });
    return;
  }

  if (pathname.startsWith('/stream/') && req.method === 'GET') {
    if (!session?.user) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    const id = Number(pathname.split('/').pop());
    const db = loadDb();
    const track = db.tracks.find((t) => t.id === id);
    if (!track) {
      res.writeHead(404);
      res.end('Track not found');
      return;
    }

    const filePath = path.join(UPLOAD_DIR, track.filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('File missing');
      return;
    }

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const [startText, endText] = range.replace('bytes=', '').split('-');
      const start = Number(startText);
      const end = endText ? Number(endText) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
        res.writeHead(416);
        res.end('Range Not Satisfiable');
        return;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': track.mimeType
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': track.mimeType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (serveStatic(req, res, pathname)) return;
  serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
}

seedAdmin();
const server = http.createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error(err);
    sendJson(res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`NBMusic running at http://localhost:${PORT}`);
});
