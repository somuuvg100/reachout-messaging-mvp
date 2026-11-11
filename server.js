const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).forEach(line => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); });
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const sessions = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const SMS_MODE = process.env.SMS_MODE || 'demo';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
function readStore() { if (!fs.existsSync(STORE_FILE)) return { users: [], messages: [], optouts: [] }; return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
function writeStore(store) { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2)); }
function id() { return crypto.randomUUID(); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function passwordHash(value) { return crypto.scryptSync(value, 'reachout-local-salt', 32).toString('hex'); }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 100_000) req.destroy(); }); req.on('end', () => { try { if (!raw) return resolve({}); if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(raw))); resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid request body')); } }); req.on('error', reject); }); }
function auth(req) { const token = req.headers.authorization?.replace('Bearer ', ''); return token ? sessions.get(token) : null; }
function cleanPhone(country, phone) { return `${country || ''} ${String(phone || '').replace(/[^\d+]/g, '')}`.trim(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
async function sendSms(to, from, text) {
  if (SMS_MODE !== 'twilio') return { status: 'demo-ready', provider: 'demo' };
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) throw new Error('SMS provider is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.');
  const params = new URLSearchParams({ To: to, From: from || TWILIO_FROM_NUMBER, Body: text });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'The SMS provider rejected the message.');
  return { status: data.status || 'queued', provider: 'twilio', providerId: data.sid };
}
function twiml(message) { return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${String(message).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]))}</Message></Response>`; }

async function api(req, res, url) {
  const store = readStore();
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, provider: SMS_MODE, configured: SMS_MODE === 'twilio' ? Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) : true });
  if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { provider: SMS_MODE, sender: TWILIO_FROM_NUMBER || 'ReachOut verified number' });
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const input = await body(req); const name = String(input.name || '').trim(); const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || ''); if (name.length < 2 || !validEmail(email) || password.length < 8) return json(res, 400, { error: 'Enter a valid name, email, and password of at least 8 characters.' });
    if (store.users.some(user => user.email === email)) return json(res, 409, { error: 'An account with this email already exists.' });
    const user = { id: id(), name, email, passwordHash: passwordHash(password), sender: TWILIO_FROM_NUMBER || 'ReachOut verified number', createdAt: new Date().toISOString() }; store.users.push(user); writeStore(store);
    const token = id(); sessions.set(token, user.id); return json(res, 201, { user, token });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const input = await body(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || ''); const user = store.users.find(item => item.email === email);
    if (!user || !user.passwordHash || passwordHash(password) !== user.passwordHash) return json(res, 401, { error: 'Invalid email or password.' });
    const token = id(); sessions.set(token, user.id); return json(res, 200, { user, token });
  }
  const userId = auth(req);
  if (req.method === 'POST' && url.pathname === '/api/webhooks/twilio/inbound') {
    const input = await body(req); const recipient = String(input.To || TWILIO_FROM_NUMBER); const user = store.users.find(item => item.sender === recipient) || store.users[0];
    if (user && input.From && input.Body) { store.messages.push({ id: id(), userId: user.id, direction: 'inbound', sender: input.From, recipient, body: String(input.Body).slice(0, 160), status: 'received', createdAt: new Date().toISOString() }); writeStore(store); }
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' }); return res.end(twiml('Thanks. Your reply was received.'));
  }
  if (req.method === 'GET' && url.pathname === '/api/me') { const user = store.users.find(item => item.id === userId); return user ? json(res, 200, { user }) : json(res, 401, { error: 'Sign in required.' }); }
  if (!userId) return json(res, 401, { error: 'Sign in required.' });
  if (req.method === 'GET' && url.pathname === '/api/inbox') {
    const messages = store.messages.filter(item => item.userId === userId && item.direction === 'inbound');
    return json(res, 200, { messages });
  }
  if (req.method === 'POST' && url.pathname === '/api/optouts') {
    const input = await body(req); const phone = cleanPhone(input.countryCode, input.phone); if (!phone) return json(res, 400, { error: 'A phone number is required.' });
    if (!store.optouts.some(item => item.userId === userId && item.phone === phone)) store.optouts.push({ userId, phone, createdAt: new Date().toISOString() }); writeStore(store); return json(res, 200, { ok: true, phone });
  }
  if (req.method === 'POST' && url.pathname === '/api/messages') {
    const input = await body(req); const phone = cleanPhone(input.countryCode, input.phone); const text = String(input.message || '').trim();
    if (!phone || phone.replace(/\D/g, '').length < 7) return json(res, 400, { error: 'Enter a valid international phone number.' });
    if (!text || text.length > 160) return json(res, 400, { error: 'Message must be between 1 and 160 characters.' });
    if (!input.consent) return json(res, 400, { error: 'Recipient consent is required.' });
    if (store.optouts.some(item => item.userId === userId && item.phone === phone)) return json(res, 403, { error: 'This contact has opted out and cannot be messaged.' });
    let delivery; try { delivery = await sendSms(phone, String(input.sender || TWILIO_FROM_NUMBER), text); } catch (error) { return json(res, 502, { error: error.message }); }
    const message = { id: id(), userId, direction: 'outbound', sender: String(input.sender || TWILIO_FROM_NUMBER || 'ReachOut verified number'), recipient: phone, body: text, status: delivery.status, provider: delivery.provider, providerId: delivery.providerId || null, createdAt: new Date().toISOString() }; store.messages.push(message); writeStore(store); return json(res, 201, { message });
  }
  return json(res, 404, { error: 'Not found.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let file = url.pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  } catch (error) { json(res, 500, { error: error.message || 'Server error.' }); }
});
server.listen(PORT, () => console.log(`ReachOut running at http://localhost:${PORT}`));
