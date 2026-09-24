const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'nagarclean-data.json');
const SESSION_TTL = 8 * 60 * 60 * 1000;
const DEMO_ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL || 'admin@nagarclean.demo';
const DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'Admin@123';
const DEMO_ZONE_EMAIL = process.env.DEMO_ZONE_EMAIL || 'zone1@nagarclean.demo';
const DEMO_ZONE_PASSWORD = process.env.DEMO_ZONE_PASSWORD || 'Zone@123';
const DEMO_ZONE_ACCOUNTS = [
  { email: DEMO_ZONE_EMAIL, password: DEMO_ZONE_PASSWORD, zone: 'Z1' },
  { email: process.env.DEMO_ZONE2_EMAIL || 'zone2@nagarclean.demo', password: process.env.DEMO_ZONE2_PASSWORD || 'Zone2@123', zone: 'Z2' },
  { email: process.env.DEMO_ZONE3_EMAIL || 'zone3@nagarclean.demo', password: process.env.DEMO_ZONE3_PASSWORD || 'Zone3@123', zone: 'Z3' },
  { email: process.env.DEMO_ZONE4_EMAIL || 'zone4@nagarclean.demo', password: process.env.DEMO_ZONE4_PASSWORD || 'Zone4@123', zone: 'Z4' },
];
const sessions = new Map();

const zones = [
  { id: 'Z1', lat: 25.3070, lng: 83.0105 },
  { id: 'Z2', lat: 25.3106, lng: 82.9878 },
  { id: 'Z3', lat: 25.2925, lng: 83.0018 },
  { id: 'Z4', lat: 25.3376, lng: 82.9863 },
];

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: [], complaints: [], nextComplaint: 1 };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function sessionUser(req) {
  const token = parseCookies(req).nc_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session.user;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derived) => {
    if (error) reject(error);
    else resolve(`${salt}:${derived.toString('hex')}`);
  }));
}

async function ensureDemoAdmin() {
  const data = readData();
  let changed = false;
  if (!data.users.some(user => user.email === DEMO_ADMIN_EMAIL && user.role === 'hq')) {
    data.users.push({ name: 'Demo Administrator', email: DEMO_ADMIN_EMAIL, role: 'hq', zone: null, passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD) });
    changed = true;
  }
  for (const account of DEMO_ZONE_ACCOUNTS) {
    if (!data.users.some(user => user.email === account.email && user.role === 'zonal')) {
      data.users.push({ name: `Demo Zone ${account.zone.slice(1)} Officer`, email: account.email, role: 'zonal', zone: account.zone, passwordHash: await hashPassword(account.password) });
      changed = true;
    }
  }
  if (changed) writeData(data);
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derived) => {
    if (error) return reject(error);
    const actual = derived.toString('hex');
    resolve(actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected)));
  }));
}

function publicUser(user) {
  return { name: user.name, email: user.email, role: user.role, zone: user.zone || null };
}

function createSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket && req.socket.encrypted);
  const cookie = `nc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${isSecure ? '; Secure' : ''}`;
  sessions.set(token, { user: publicUser(user), expiresAt: Date.now() + SESSION_TTL });
  res.setHeader('Set-Cookie', cookie);
}

function nearestZone(lat, lng) {
  return zones.reduce((best, zone) => {
    const distance = Math.hypot(zone.lat - lat, zone.lng - lng);
    return distance < best.distance ? { zone, distance } : best;
  }, { zone: zones[0], distance: Infinity }).zone.id;
}

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid_json')); } });
    req.on('error', reject);
  });
}

function requireStaff(req, res, role) {
  const user = sessionUser(req);
  if (!user || (role && user.role !== role)) {
    send(res, 401, { error: 'unauthorized' });
    return null;
  }
  return user;
}

async function handleApi(req, res, url) {
  const data = readData();
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = sessionUser(req);
    return send(res, user ? 200 : 401, user ? { user } : { error: 'unauthorized' });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/signout') {
    const token = parseCookies(req).nc_session;
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'nc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (req.method === 'POST' && (url.pathname === '/api/auth/signup' || url.pathname === '/api/auth/signin')) {
    const body = await jsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = body.role === 'zonal' ? 'zonal' : 'hq';
    if (!email || password.length < 6) return send(res, 400, { error: 'invalid_credentials' });
    if (url.pathname.endsWith('signup')) {
      const name = String(body.name || '').trim();
      const zone = role === 'zonal' ? String(body.zone || '') : null;
      if (!name || (role === 'zonal' && !zones.some(item => item.id === zone))) return send(res, 400, { error: 'invalid_profile' });
      if (data.users.some(user => user.email === email && user.role === role)) return send(res, 409, { error: 'email_exists' });
      data.users.push({ name, email, role, zone, passwordHash: await hashPassword(password) });
      writeData(data);
      const user = data.users[data.users.length - 1];
      createSession(req, res, user);
      return send(res, 201, { user: publicUser(user) });
    }
    const user = data.users.find(item => item.email === email && item.role === role);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return send(res, 401, { error: 'invalid_login' });
    createSession(req, res, user);
    return send(res, 200, { user: publicUser(user) });
  }
  if (req.method === 'GET' && url.pathname === '/api/complaints') {
    const user = sessionUser(req);
    const zone = url.searchParams.get('zone');
    if (zone && !user) return send(res, 401, { error: 'unauthorized' });
    if (user?.role === 'zonal' && zone && zone !== user.zone) return send(res, 403, { error: 'forbidden' });
    const rows = data.complaints.filter(item => !zone || item.zone === zone);
    if (!user) {
      return send(res, 200, rows.map(item => ({
        id: item.id, code: item.code, category: item.category, lat: item.lat, lng: item.lng,
        zone: item.zone, status: item.status, createdAt: item.createdAt, assignedTo: item.assignedTo || null,
      })));
    }
    return send(res, 200, rows);
  }
  if (req.method === 'POST' && url.pathname === '/api/complaints') {
    const body = await jsonBody(req);
    if (!['garbage', 'sewage', 'dumping', 'drainage', 'toilet', 'sweeping'].includes(body.category)) return send(res, 400, { error: 'invalid_category' });
    if (!Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lng))) return send(res, 400, { error: 'invalid_location' });
    const zone = nearestZone(Number(body.lat), Number(body.lng));
    const complaint = {
      id: `complaint-${Date.now()}`,
      code: `NC-VNS-${new Date().getFullYear()}-${String(data.nextComplaint++).padStart(5, '0')}`,
      category: body.category, description: String(body.description || '').slice(0, 2000), name: String(body.name || '').slice(0, 120),
      reporterEmail: sessionUser(req)?.email || null, lat: Number(body.lat), lng: Number(body.lng), zone,
      photo: body.photo || null, status: 'submitted', createdAt: new Date().toISOString(), assignedTo: null,
    };
    data.complaints.unshift(complaint); writeData(data); return send(res, 201, complaint);
  }
  const action = url.pathname.match(/^\/api\/complaints\/([^/]+)\/([^/]+)$/);
  if (req.method === 'PATCH' && action) {
    const user = requireStaff(req, res); if (!user) return;
    const complaint = data.complaints.find(item => item.id === action[1]);
    if (!complaint) return send(res, 404, { error: 'not_found' });
    if (user.role === 'zonal' && complaint.zone !== user.zone) return send(res, 403, { error: 'forbidden' });
    const body = await jsonBody(req);
    const now = new Date().toISOString();
    if (action[2] === 'verify') { complaint.status = 'verified'; complaint.verifiedAt = now; }
    else if (action[2] === 'reassign-zone' && zones.some(item => item.id === body.zone)) { complaint.zone = body.zone; complaint.status = 'verified'; complaint.verifiedAt = now; }
    else if (action[2] === 'assign') { complaint.status = 'assigned'; complaint.assignedType = body.assignedType || 'worker'; complaint.assignedTo = body.assignedTo || complaint.assignedTo || 'Dispatch team'; }
    else if (action[2] === 'progress') { complaint.status = 'progress'; }
    else if (action[2] === 'resolve') { complaint.status = 'resolved'; complaint.resolvedAt = now; complaint.afterPhoto = body.afterPhoto || null; }
    else return send(res, 400, { error: 'unknown_action' });
    writeData(data); return send(res, 200, complaint);
  }
  send(res, 404, { error: 'not_found' });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/Index.html' : url.pathname;
  const safePath = requested.split('?')[0].split('#')[0];
  if (path.basename(safePath).toLowerCase() === path.basename(DATA_FILE).toLowerCase()) {
    return send(res, 404, { error: 'not_found' });
  }
  const normalized = path.normalize(safePath).replace(/^\.(?:\/|\\)/, '');
  let file = path.join(PUBLIC_ROOT, normalized || 'Index.html');

  if (!file.startsWith(PUBLIC_ROOT)) return send(res, 404, { error: 'not_found' });

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const dir = path.dirname(file);
    const fallbackName = path.basename(file);
    const match = fs.existsSync(dir)
      ? fs.readdirSync(dir).find(name => name.toLowerCase() === fallbackName.toLowerCase())
      : null;
    if (!match) return send(res, 404, { error: 'not_found' });
    file = path.join(dir, match);
  }

  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const requestOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;
  const allowedOrigin = process.env.ALLOWED_ORIGIN || requestOrigin;
  const origin = req.headers.origin;
  if (origin && origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Requested-With');

  if (req.method === 'OPTIONS') {
    if (origin && origin !== allowedOrigin) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: 'server_error' });
  }
});

ensureDemoAdmin()
  .then(() => server.listen(PORT, HOST, () => console.log(`Server running on port ${PORT}`)))
  .catch(error => { console.error('Unable to prepare demo admin account', error); process.exitCode = 1; });