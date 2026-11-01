'use strict';
/* ------------------------------------------------------------------
 * Personal Uploader - single-user file hosting with share links
 * ------------------------------------------------------------------ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const archiver = require('archiver');
archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted'));

// ---- optional .env loader (cPanel env variables work too) ----------
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file */ }

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('ADMIN_USER and ADMIN_PASS environment variables are required.');
  process.exit(1);
}
const SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('uploader:' + ADMIN_USER + ':' + ADMIN_PASS).digest('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET is not set; sessions are signed with a key derived from the admin credentials. Set a long random SESSION_SECRET.');
}
if (String(ADMIN_PASS).length < 8) console.warn('[warn] ADMIN_PASS is shorter than 8 characters. Use a stronger password.');
const QUOTA = (parseFloat(process.env.QUOTA_GB) || 4.5) * 1024 ** 3;
const MAX_PENDING = 50; // unfinished uploads allowed at the same time
const CHUNK = 5 * 1024 * 1024; // 5 MB per request: safe for proxy / timeout limits

const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FILES = path.join(DATA, 'files');
const TMP = path.join(DATA, 'tmp');
const TEXTS = path.join(DATA, 'texts'); // encrypted text blobs (<id>.enc)
const DBF = path.join(DATA, 'db.json');
fs.mkdirSync(FILES, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(TEXTS, { recursive: true });

// ---- tiny JSON database ---------------------------------------------
let db = { files: {}, uploads: {}, texts: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8'))); } catch (e) {
  if (e.code !== 'ENOENT') { // corrupted db.json: keep a copy instead of silently overwriting it
    try { fs.copyFileSync(DBF, DBF + '.corrupt-' + Date.now()); } catch { /* ignore */ }
    console.error('db.json could not be read, starting empty:', e.message);
  }
}
if (!db.files || typeof db.files !== 'object') db.files = {};
if (!db.uploads || typeof db.uploads !== 'object') db.uploads = {};
if (!db.texts || typeof db.texts !== 'object') db.texts = {};
const finishing = new Set(); // upload ids currently being finalized (not persisted)
let saving = Promise.resolve();
function save() {
  saving = saving.then(async () => {
    const t = DBF + '.tmp';
    await fsp.writeFile(t, JSON.stringify(db));
    await fsp.rename(t, DBF);
  }).catch(e => console.error('db save failed', e));
  return saving;
}

// ---- helpers ----------------------------------------------------------
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeToken(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(t) {
  if (!t || typeof t !== 'string') return null;
  const [p, s] = t.split('.');
  if (!p || !s) return null;
  const e = sign(p);
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString());
    return o.exp > Date.now() ? o : null;
  } catch { return null; }
}
function cookiesOf(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) { try { o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); } catch { /* ignore */ } }
  });
  return o;
}
// scrypt runs on the libuv thread pool so hashing never blocks the event loop.
const scrypt = promisify(crypto.scrypt);
const pwBytes = pw => String(pw).slice(0, 1024); // cap input length (DoS guard)
async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + (await scrypt(pwBytes(pw), salt, 32)).toString('hex');
}
async function checkPw(pw, stored) {
  const [s, h] = String(stored || '').split(':');
  if (!s || !h) return false;
  const expected = Buffer.from(h, 'hex');
  const x = await scrypt(pwBytes(pw), Buffer.from(s, 'hex'), expected.length || 32);
  return x.length === expected.length && crypto.timingSafeEqual(x, expected);
}
// ---- encrypted texts ------------------------------------------------------
// Every text is sealed with AES-256-GCM. With a password the key is derived from it
// (scrypt), so the server cannot read the text without that password. Without one the
// key is derived from the server secret, which still protects the data at rest.
const MAX_TEXT = 1024 * 1024; // 1 MB of UTF-8 per text
const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
async function textKey(password, salt) {
  if (password) return scrypt(Buffer.from(pwBytes(password), 'utf8'), salt, 32, SCRYPT_OPTS);
  return Buffer.from(crypto.hkdfSync('sha256', SECRET, salt, 'uploader-text-v1', 32));
}
function sealText(plain, key, id) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(id)); // binds the ciphertext to its record
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function openText(blob, key, id) { // throws if the key is wrong or the data was tampered with
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAAD(Buffer.from(id));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

function cleanName(n, fallback) {
  n = String(n || '').replace(/[\\/\0\r\n:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);
  return n || fallback;
}
const randomDigits = (n = 8) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');
const newId = () => crypto.randomBytes(9).toString('hex');
const newLinkToken = () => crypto.randomBytes(18).toString('base64url');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isExpired = r => r.expiresAt && r.expiresAt <= Date.now();

// brute-force limiter (in-memory)
const fails = new Map();
const limited = k => { const f = fails.get(k); return !!(f && f.n >= 5 && f.until > Date.now()); };
function addFail(k) {
  let f = fails.get(k) || { n: 0, until: 0, t: 0 };
  if (f.until && f.until <= Date.now()) f = { n: 0, until: 0, t: 0 };
  f.n++;
  f.t = Date.now();
  if (f.n >= 5) f.until = Date.now() + 15 * 60 * 1000;
  fails.set(k, f);
}

async function unlinkQuiet(p) { try { await fsp.unlink(p); } catch { /* already gone */ } }
async function deleteText(t) {
  delete db.texts[t.id];
  await unlinkQuiet(path.join(TEXTS, t.id + '.enc'));
  await save();
}
async function deleteRecord(r) {
  if (r.file) await unlinkQuiet(path.join(FILES, r.file));
  delete db.files[r.id];
  await save();
}
function usedBytes() {
  let n = 0;
  for (const r of Object.values(db.files)) n += r.size || 0;
  for (const u of Object.values(db.uploads)) n += u.size || 0;
  for (const t of Object.values(db.texts)) n += t.size || 0;
  return n;
}

// ---- boot recovery ----------------------------------------------------
for (const r of Object.values(db.files)) {
  if (r.status === 'processing') { r.status = 'failed'; r.error = 'Server restarted while processing'; }
}
for (const f of fs.readdirSync(TMP)) {
  const id = f.replace(/\.part$/, '');
  if (!db.uploads[id]) unlinkQuiet(path.join(TMP, f));
}
// files on disk that no record points to (e.g. crash between unlink and db save) waste quota
const known = new Set(Object.values(db.files).map(r => r.file).filter(Boolean));
for (const f of fs.readdirSync(FILES)) {
  if (!known.has(f)) unlinkQuiet(path.join(FILES, f));
}
const knownTexts = new Set(Object.values(db.texts).map(t => t.id + '.enc'));
for (const f of fs.readdirSync(TEXTS)) {
  if (!knownTexts.has(f)) unlinkQuiet(path.join(TEXTS, f));
}
save();

// ---- zip ----------------------------------------------------------------
// zipPassword encrypts the archive contents itself (AES-256); independent of
// the share-link password gate (rec.pw), which only guards the download page.
function zipFile(src, dest, entryName, zipPassword) {
  return zipFiles([{ path: src, name: entryName }], dest, zipPassword);
}
// several source files -> one archive (used for multi-file share links)
function zipFiles(items, dest, zipPassword) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const zip = zipPassword
      ? archiver('zip-encrypted', { zlib: { level: 1 }, encryptionMethod: 'aes256', password: zipPassword })
      : archiver('zip', { zlib: { level: 1 } });
    out.on('close', resolve);
    out.on('error', reject);
    zip.on('error', reject);
    zip.pipe(out);
    for (const it of items) zip.file(it.path, { name: it.name });
    zip.finalize();
  });
}

// "a.txt", "a.txt" -> "a.txt", "a (2).txt" so entries never overwrite each other in the archive
function uniqueNames(names) {
  const seen = new Map();
  return names.map(n => {
    const k = n.toLowerCase();
    const c = (seen.get(k) || 0) + 1;
    seen.set(k, c);
    if (c === 1) return n;
    const m = n.match(/^(.*?)(\.[^.]*)?$/);
    return `${m[1]} (${c})${m[2] || ''}`;
  });
}

async function processBundle(rec, items, zipPassword) {
  try {
    rec.file = rec.id + '.zip';
    const dest = path.join(FILES, rec.file);
    await zipFiles(items, dest, zipPassword);
    rec.size = (await fsp.stat(dest)).size;
    rec.status = 'ready';
  } catch (e) {
    console.error('bundle failed', e);
    rec.status = 'failed';
    rec.error = String(e.message || e);
    if (rec.file) await unlinkQuiet(path.join(FILES, rec.file));
  }
  for (const it of items) await unlinkQuiet(it.path);
  await save();
}

async function processUpload(rec, tmpPath, entryName, zipPassword) {
  try {
    let dest;
    if (rec.zipped) {
      rec.file = rec.id + '.zip';
      dest = path.join(FILES, rec.file);
      await zipFile(tmpPath, dest, entryName, zipPassword);
      await unlinkQuiet(tmpPath);
    } else {
      rec.file = rec.id + '.bin';
      dest = path.join(FILES, rec.file);
      await fsp.rename(tmpPath, dest);
    }
    rec.size = (await fsp.stat(dest)).size;
    rec.status = 'ready';
  } catch (e) {
    console.error('process failed', e);
    rec.status = 'failed';
    rec.error = String(e.message || e);
    await unlinkQuiet(tmpPath);
    if (rec.file) await unlinkQuiet(path.join(FILES, rec.file));
  }
  await save();
}

// ---- app ----------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

// Express 4 does not catch rejected promises from async handlers: one failed fs call
// would become an unhandled rejection and could take the whole process down.
// Wrap every async route handler so errors reach the error middleware instead.
const wrapAsync = fn => (typeof fn === 'function' && fn.constructor.name === 'AsyncFunction'
  ? (req, res, next) => fn(req, res, next).catch(next) : fn);
for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
  const orig = app[m].bind(app);
  app[m] = (...args) => (args.length > 1 ? orig(...args.map(wrapAsync)) : orig(...args));
}
// Only trust as many reverse-proxy hops as configured: `true` would let any client
// spoof X-Forwarded-For and bypass the brute-force limiter.
const TRUST_PROXY = process.env.TRUST_PROXY === undefined ? 1 : (parseInt(process.env.TRUST_PROXY, 10) || 0);
app.set('trust proxy', TRUST_PROXY);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // Pages use small inline <script>/<style> blocks, everything else is same-origin only.
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
      + "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
      + "form-action 'self'; frame-ancestors 'none'"
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// API responses must never be cached by browsers or intermediaries.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const isAdmin = req => {
  const t = readToken(cookiesOf(req).sid);
  return !!(t && t.t === 'admin' && t.u === ADMIN_USER);
};
const auth = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'unauthorized' }));
const setCookie = (req, res, name, value, maxAgeMs, p = '/') =>
  res.cookie(name, value, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: maxAgeMs, path: p });

// ---- admin auth -----------------------------------------------------------
app.post('/api/login', express.json({ limit: '10kb' }), (req, res) => {
  const key = 'login:' + req.ip;
  if (limited(key)) return res.status(429).json({ error: 'تلاش‌های زیاد. ۱۵ دقیقه بعد دوباره امتحان کنید.' });
  const { username, password } = req.body || {};
  const userOk = safeEq(username || '', ADMIN_USER);
  const passOk = safeEq(password || '', ADMIN_PASS); // both are always evaluated (no early exit)
  const ok = userOk && passOk;
  if (!ok) { addFail(key); return res.status(401).json({ error: 'نام کاربری یا رمز اشتباه است.' }); }
  fails.delete(key);
  setCookie(req, res, 'sid', makeToken({ t: 'admin', u: ADMIN_USER, exp: Date.now() + 7 * 864e5 }), 7 * 864e5);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('sid', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ ok: true }));

// ---- chunked upload ---------------------------------------------------------
app.post('/api/upload/init', auth, express.json({ limit: '10kb' }), async (req, res) => {
  const b = req.body || {};
  const size = typeof b.size === 'number' ? b.size : NaN;
  if (!Number.isSafeInteger(size) || size < 0) return res.status(400).json({ error: 'حجم نامعتبر' });
  if (Object.keys(db.uploads).length >= MAX_PENDING) return res.status(429).json({ error: 'آپلودهای ناتمام زیاد است. کمی بعد دوباره امتحان کنید.' });
  if (usedBytes() + size > QUOTA) return res.status(413).json({ error: 'فضای کافی نیست.' });
  const id = newId();
  await fsp.writeFile(path.join(TMP, id + '.part'), '');
  db.uploads[id] = { id, size, name: cleanName(b.name, 'file'), last: Date.now() };
  save();
  res.json({ id, chunkSize: CHUNK });
});

app.put('/api/upload/:id/:index', auth, express.raw({ type: () => true, limit: CHUNK + 1024 }), async (req, res) => {
  const u = db.uploads[req.params.id];
  if (!u || finishing.has(u.id) || !/^\d{1,9}$/.test(req.params.index)) return res.status(404).json({ error: 'آپلود پیدا نشد.' });
  const index = parseInt(req.params.index, 10);
  const body = req.body;
  if (!Buffer.isBuffer(body)) return res.status(400).json({ error: 'bad body' });
  const offset = index * CHUNK;
  // every chunk is exactly CHUNK bytes except the last one, which holds the remainder
  if (offset >= u.size || body.length !== Math.min(CHUNK, u.size - offset)) {
    return res.status(400).json({ error: 'اندازهٔ تکه نامعتبر است.' });
  }
  let fh;
  try {
    fh = await fsp.open(path.join(TMP, u.id + '.part'), 'r+');
    await fh.write(body, 0, body.length, offset);
  } finally { if (fh) await fh.close(); }
  u.last = Date.now();
  res.json({ ok: true });
});

app.post('/api/upload/:id/finish', auth, express.json({ limit: '10kb' }), async (req, res) => {
  const u = db.uploads[req.params.id];
  if (!u || finishing.has(u.id)) return res.status(404).json({ error: 'آپلود پیدا نشد.' });
  const tmpPath = path.join(TMP, u.id + '.part');

  const b = req.body || {};
  let expiresAt = null;
  if (b.expiresAt != null) {
    expiresAt = Number(b.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return res.status(400).json({ error: 'زمان انقضا نامعتبر است.' });
  }
  // Name switch: on (b.rename truthy) -> user-supplied name; off -> a random
  // numeric name is generated server-side regardless of what the client sent.
  const renameOn = !!b.rename;
  const ext = (u.name.match(/\.[^./\\]+$/) || [''])[0];
  const baseName = renameOn ? cleanName(b.name, u.name) : randomDigits(10) + ext;
  const entryName = baseName; // name used inside the zip / as the stored file name
  const zipped = !!b.zip;
  const downloadName = zipped ? (baseName.replace(/\.[^.]*$/, '') || baseName) + '.zip' : baseName;

  // Link password (gates the download page) vs zip content password (encrypts
  // the archive itself, AES-256) are independent and either/both may be set.
  const linkPassword = b.password ? String(b.password) : '';
  const zipPassword = zipped && b.zipPassword ? String(b.zipPassword) : '';

  const pwHash = linkPassword ? await hashPw(linkPassword) : null;

  // Claim the upload before the next await: a double "finish" (retry / double click)
  // must not create two records that share one temp file.
  if (finishing.has(u.id) || db.uploads[u.id] !== u) return res.status(409).json({ error: 'این آپلود در حال تکمیل است.' });
  finishing.add(u.id);
  const st = await fsp.stat(tmpPath).catch(() => null);
  if (!st || st.size !== u.size) { finishing.delete(u.id); return res.status(400).json({ error: 'فایل ناقص دریافت شد.' }); }

  const rec = {
    id: u.id, token: newLinkToken(), name: downloadName, originalName: entryName,
    size: u.size, createdAt: Date.now(), expiresAt,
    pw: pwHash,
    zipped, zipEncrypted: !!zipPassword, status: 'processing', revoked: false, downloads: 0, file: null
  };
  db.files[rec.id] = rec;
  delete db.uploads[u.id];
  finishing.delete(u.id);
  await save();
  res.json({ ok: true, id: rec.id });
  processUpload(rec, tmpPath, entryName, zipPassword); // async; UI polls status
});

app.delete('/api/upload/:id', auth, async (req, res) => {
  const u = db.uploads[req.params.id];
  if (u && !finishing.has(u.id)) { delete db.uploads[u.id]; await unlinkQuiet(path.join(TMP, u.id + '.part')); save(); }
  res.json({ ok: true });
});

// ---- file management -------------------------------------------------------
app.get('/api/files', auth, (req, res) => {
  const list = Object.values(db.files)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(r => ({
      id: r.id, name: r.name, size: r.size, createdAt: r.createdAt, expiresAt: r.expiresAt,
      hasPassword: !!r.pw, zipped: r.zipped, zipEncrypted: !!r.zipEncrypted, status: r.status, error: r.error || null,
      downloads: r.downloads, link: r.token && !r.revoked ? '/d/' + r.token : null
    }));
  res.json({ files: list, used: usedBytes(), quota: QUOTA });
});

app.patch('/api/files/:id', auth, express.json({ limit: '10kb' }), async (req, res) => {
  const r = db.files[req.params.id];
  if (!r) return res.status(404).json({ error: 'فایل پیدا نشد.' });
  const b = req.body || {};
  if (typeof b.name === 'string' && b.name.trim()) {
    let n = cleanName(b.name, r.name);
    if (r.zipped && !/\.zip$/i.test(n)) n += '.zip';
    r.name = n;
  }
  if ('expiresAt' in b) {
    if (b.expiresAt === null) r.expiresAt = null;
    else {
      const t = Number(b.expiresAt);
      if (!Number.isFinite(t) || t <= Date.now()) return res.status(400).json({ error: 'زمان انقضا نامعتبر است.' });
      r.expiresAt = t;
    }
  }
  if (b.removePassword) r.pw = null;
  else if (typeof b.password === 'string' && b.password) r.pw = await hashPw(b.password);
  await save();
  res.json({ ok: true });
});

app.post('/api/files/:id/revoke', auth, async (req, res) => {
  const r = db.files[req.params.id];
  if (!r) return res.status(404).json({ error: 'فایل پیدا نشد.' });
  r.token = null; r.revoked = true;
  await save();
  res.json({ ok: true });
});

app.post('/api/files/:id/regenerate', auth, async (req, res) => {
  const r = db.files[req.params.id];
  if (!r) return res.status(404).json({ error: 'فایل پیدا نشد.' });
  r.token = newLinkToken(); r.revoked = false;
  await save();
  res.json({ ok: true, link: '/d/' + r.token });
});

app.delete('/api/files/:id', auth, async (req, res) => {
  const r = db.files[req.params.id];
  if (r) await deleteRecord(r);
  res.json({ ok: true });
});

// ---- texts (admin) -----------------------------------------------------------
app.post('/api/texts', auth, express.json({ limit: '2mb' }), async (req, res) => {
  const b = req.body || {};
  const text = typeof b.text === 'string' ? b.text : '';
  if (!text.trim()) return res.status(400).json({ error: 'متن خالی است.' });
  const plain = Buffer.from(text, 'utf8');
  if (plain.length > MAX_TEXT) return res.status(413).json({ error: 'متن بیشتر از ۱ مگابایت است.' });
  let expiresAt = null;
  if (b.expiresAt != null) {
    expiresAt = Number(b.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return res.status(400).json({ error: 'زمان انقضا نامعتبر است.' });
  }
  if (usedBytes() + plain.length + 28 > QUOTA) return res.status(413).json({ error: 'فضای کافی نیست.' });
  const password = typeof b.password === 'string' ? b.password : '';
  const id = newId();
  const salt = crypto.randomBytes(16);
  const blob = sealText(plain, await textKey(password, salt), id);
  await fsp.writeFile(path.join(TEXTS, id + '.enc'), blob, { mode: 0o600 });
  const rec = {
    id, token: newLinkToken(), title: String(b.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80), salt: salt.toString('hex'),
    size: blob.length, chars: [...text].length, createdAt: Date.now(), expiresAt,
    protected: !!password, burn: !!b.burn, revoked: false, views: 0
  };
  db.texts[id] = rec;
  await save();
  res.json({ ok: true, id, link: '/t/' + rec.token });
});

app.get('/api/texts', auth, (req, res) => {
  const list = Object.values(db.texts)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(t => ({
      id: t.id, title: t.title, chars: t.chars, size: t.size, createdAt: t.createdAt, expiresAt: t.expiresAt,
      protected: t.protected, burn: t.burn, views: t.views, link: t.token && !t.revoked ? '/t/' + t.token : null
    }));
  res.json({ texts: list });
});

app.post('/api/texts/:id/revoke', auth, async (req, res) => {
  const t = db.texts[req.params.id];
  if (!t) return res.status(404).json({ error: 'متن پیدا نشد.' });
  t.token = null; t.revoked = true;
  await save();
  res.json({ ok: true });
});

app.post('/api/texts/:id/regenerate', auth, async (req, res) => {
  const t = db.texts[req.params.id];
  if (!t) return res.status(404).json({ error: 'متن پیدا نشد.' });
  t.token = newLinkToken(); t.revoked = false;
  await save();
  res.json({ ok: true, link: '/t/' + t.token });
});

app.delete('/api/texts/:id', auth, async (req, res) => {
  const t = db.texts[req.params.id];
  if (t) await deleteText(t);
  res.json({ ok: true });
});

// ---- public download pages --------------------------------------------------
// Public pages share the admin UI's design language (beUI tokens + Vazirmatn).
const PAGE_CSS = `
@font-face{font-family:"Vazirmatn";src:url("/fonts/Vazirmatn-Variable.woff2") format("woff2");font-weight:100 900;font-display:swap}
:root{color-scheme:light;--background:oklch(99% 0 0);--foreground:oklch(15% 0 0);--card:oklch(97% 0 0);--muted-fg:oklch(50% 0 0);
  --border:oklch(15% 0 0 / .06);--border-strong:oklch(15% 0 0 / .12);--primary:#0285f7;--danger-tx:oklch(54% .22 25);
  --gradient-accent:linear-gradient(to right,oklch(72% .18 195),oklch(68% .22 295));--ease-out:cubic-bezier(.16,1,.3,1);
  --font:"Vazirmatn","Vazir",Tahoma,"Segoe UI",system-ui,sans-serif}
:root[data-theme=dark]{color-scheme:dark;--background:#151515;--foreground:oklch(96% 0 0);--card:#1c1c1c;--muted-fg:oklch(62% 0 0);
  --border:rgb(255 255 255 / .05);--border-strong:rgb(255 255 255 / .1);--danger-tx:oklch(72% .19 25);
  --gradient-accent:linear-gradient(to right,oklch(80% .18 195),oklch(72% .18 295))}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px calc(24px + env(safe-area-inset-bottom));background:var(--background);color:var(--foreground);
  font-family:var(--font);font-size:14px;line-height:1.8;-webkit-font-smoothing:antialiased}
svg.i{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.c.wide{max-width:680px}
.c{width:100%;max-width:400px;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:28px;padding:32px 24px 28px;animation:rise .3s var(--ease-out)}
.tile{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 18px;border-radius:22px;background:var(--border);color:var(--muted-fg)}
.tile.g{background:var(--gradient-accent);color:#fff}
.tile svg.i{width:28px;height:28px}
h1{margin:0 0 10px;font-size:18px;font-weight:700;line-height:1.7;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-bottom:6px}
.chip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 11px;border-radius:999px;background:var(--border);color:var(--muted-fg);font-size:12px;font-weight:500}
.chip svg.i{width:13px;height:13px}
.m{color:var(--muted-fg);font-size:13px;margin:6px 0 0}
form{margin:0}
input{display:block;width:100%;height:46px;margin:20px 0 0;padding:0 18px;border:1px solid var(--border-strong);border-radius:999px;background:var(--background);color:inherit;font:inherit;outline:none;
  transition:border-color .2s var(--ease-out),box-shadow .2s var(--ease-out)}
input:focus{border-color:color-mix(in oklch,var(--foreground) 40%,transparent);box-shadow:0 0 0 3px var(--border-strong)}
.e{min-height:24px;margin:6px 0 0;color:var(--danger-tx);font-size:13px}
.b{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;margin-top:20px;padding:0 28px;border:0;border-radius:999px;background:var(--foreground);color:var(--background);
  font:inherit;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer;transition:opacity .15s var(--ease-out),transform .15s var(--ease-out)}
.b:hover{opacity:.88}.b:active{transform:scale(.98)}
form .b{margin-top:0}
pre.txt{margin:18px 0 0;padding:16px 18px;max-height:60vh;overflow:auto;text-align:start;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--border-strong);border-radius:20px;background:var(--background);
  font:inherit;font-size:14px;line-height:1.9;user-select:text}
.b.alt{background:transparent;color:var(--foreground);border:1px solid var(--border-strong)}
.b.alt:hover{background:var(--border);opacity:1}
.warn{margin:14px 0 0;color:var(--danger-tx);font-size:12.5px}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (max-width:640px){input{font-size:16px}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}`;

const ICONS = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  down: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  text: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8M16 17H8M10 9H8"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>'
};
const svg = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const THEME_JS = `try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;
const page = (title, body, status = 200, wide = false) => ({ status, html:
  `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="preload" href="/fonts/Vazirmatn-Variable.woff2" as="font" type="font/woff2" crossorigin><script>${THEME_JS}</script><style>${PAGE_CSS}</style></head><body><main class="c${wide ? ' wide' : ''}">${body}</main></body></html>` });
const send = (res, p) => res.status(p.status).type('html').send(p.html);
const notFound = () => page('یافت نشد', `<div class="tile">${svg('ban')}</div><h1>لینک معتبر نیست</h1><p class="m">این لینک باطل شده، منقضی شده یا وجود ندارد.</p>`, 404);
const faNum = (n, d = 0) => Number(n).toLocaleString('fa-IR', { maximumFractionDigits: d });
const fmtSize = b => { const u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return faNum(b, i ? (b < 10 ? 2 : 1) : 0) + ' ' + u[i]; };

function findByToken(token) {
  if (!token) return null;
  for (const r of Object.values(db.files)) {
    if (r.token && r.token === token && !r.revoked) return r;
  }
  return null;
}
function liveRecord(token) {
  const r = findByToken(token);
  if (!r || r.status !== 'ready') return null;
  if (isExpired(r)) { deleteRecord(r); return null; }
  return r;
}
function landing(r, token, error) {
  const chips = `<span class="chip">${svg('file')}${fmtSize(r.size)}</span>`
    + (r.expiresAt ? `<span class="chip">${svg('clock')}${esc(new Date(r.expiresAt).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }))}</span>` : '')
    + (r.pw ? `<span class="chip">${svg('lock')}رمزدار</span>` : '');
  const head = `<div class="tile g">${svg(r.zipped ? 'archive' : 'file')}</div><h1><bdi>${esc(r.name)}</bdi></h1><div class="chips">${chips}</div>`;
  const body = r.pw
    ? `${head}<form method="post" action="/d/${esc(token)}"><input type="password" name="password" placeholder="رمز عبور فایل" autocomplete="off" autofocus required><div class="e" role="alert">${error ? esc(error) : ''}</div><button class="b" type="submit">${svg('down')}دانلود</button></form>`
    : `${head}<a class="b" href="/d/${esc(token)}/file">${svg('down')}دانلود</a>`;
  return page(r.name, body, error ? 401 : 200);
}

app.get('/d/:token', (req, res) => {
  const r = liveRecord(req.params.token);
  send(res, r ? landing(r, req.params.token) : notFound());
});

app.post('/d/:token', express.urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
  const token = req.params.token;
  const r = liveRecord(token);
  if (!r) return send(res, notFound());
  if (!r.pw) return res.redirect(303, `/d/${token}/file`);
  const key = 'dl:' + token + ':' + req.ip;
  if (limited(key)) return send(res, page('محدودیت', '<h1>تلاش‌های زیاد</h1><p class="m">چند دقیقه بعد دوباره امتحان کنید.</p>', 429));
  if (!(await checkPw((req.body || {}).password || '', r.pw))) { addFail(key); return send(res, landing(r, token, 'رمز اشتباه است.')); }
  fails.delete(key);
  setCookie(req, res, 'dl_' + token, makeToken({ t: 'dl', k: token, exp: Date.now() + 10 * 60 * 1000 }), 10 * 60 * 1000, '/d/' + token);
  res.redirect(303, `/d/${token}/file`);
});

app.get('/d/:token/file', (req, res) => {
  const token = req.params.token;
  const r = liveRecord(token);
  if (!r) return send(res, notFound());
  if (r.pw) {
    const t = readToken(cookiesOf(req)['dl_' + token]);
    if (!t || t.k !== token) return res.redirect(303, `/d/${token}`);
  }
  const range = req.headers.range;
  if (!range || /^bytes=0-/.test(range)) { r.downloads++; save(); }
  res.set('Cache-Control', 'private, no-store');
  res.download(path.join(FILES, r.file), r.name, err => {
    if (err && !res.headersSent) send(res, notFound());
  });
});

// ---- public text pages --------------------------------------------------------
// Opening the link only shows a gate; the text is revealed by a POST. That way link
// previews / crawlers (which only GET) can never read or burn a one-time text.
function liveText(token) {
  if (!token) return null;
  for (const t of Object.values(db.texts)) {
    if (t.token && t.token === token && !t.revoked && !t.consumed) {
      if (isExpired(t)) { deleteText(t); return null; }
      return t;
    }
  }
  return null;
}
function textGate(t, token, error) {
  const chips = `<span class="chip">${svg('text')}${faNum(t.chars)} نویسه</span>`
    + (t.expiresAt ? `<span class="chip">${svg('clock')}${esc(new Date(t.expiresAt).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }))}</span>` : '')
    + (t.protected ? `<span class="chip">${svg('lock')}رمزدار</span>` : '')
    + (t.burn ? `<span class="chip">${svg('flame')}یک‌بار مصرف</span>` : '');
  const head = `<div class="tile g">${svg('text')}</div><h1><bdi>${esc(t.title || 'متن امن')}</bdi></h1><div class="chips">${chips}</div>`;
  const warn = t.burn ? '<p class="warn">این متن بعد از نمایش برای همیشه حذف می‌شود.</p>' : '';
  const body = `${head}${warn}<form method="post" action="/t/${esc(token)}">`
    + (t.protected ? '<input type="password" name="password" placeholder="رمز عبور متن" autocomplete="off" autofocus required>' : '')
    + `<div class="e" role="alert">${error ? esc(error) : ''}</div><button class="b" type="submit">${svg('eye')}نمایش متن</button></form>`;
  return page(t.title || 'متن امن', body, error ? 401 : 200, true);
}
function textView(t, text) {
  const body = `<div class="tile g">${svg('text')}</div><h1><bdi>${esc(t.title || 'متن امن')}</bdi></h1>`
    + `<pre class="txt" id="tx" dir="auto">${esc(text)}</pre>`
    + (t.burn ? '<p class="warn">این متن حذف شد و دیگر قابل دسترسی نیست. همین حالا آن را کپی کنید.</p>' : '')
    + `<button class="b" type="button" id="cp">${svg('text')}کپی متن</button>`
    + `<script>document.getElementById('cp').onclick=function(){var b=this,t=document.getElementById('tx').textContent;`
    + `(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.lastChild.textContent='کپی شد'},function(){`
    + `var r=document.createRange();r.selectNodeContents(document.getElementById('tx'));var s=getSelection();s.removeAllRanges();s.addRange(r)})}</script>`;
  return page(t.title || 'متن امن', body, 200, true);
}

app.get('/t/:token', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const t = liveText(req.params.token);
  send(res, t ? textGate(t, req.params.token) : notFound());
});

app.post('/t/:token', express.urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const token = req.params.token;
  const t = liveText(token);
  if (!t) return send(res, notFound());
  const key = 'tx:' + token + ':' + req.ip;
  if (limited(key)) return send(res, page('محدودیت', '<h1>تلاش‌های زیاد</h1><p class="m">چند دقیقه بعد دوباره امتحان کنید.</p>', 429));
  let plain;
  try {
    const blob = await fsp.readFile(path.join(TEXTS, t.id + '.enc'));
    plain = openText(blob, await textKey(t.protected ? (req.body || {}).password || '' : '', Buffer.from(t.salt, 'hex')), t.id);
  } catch (e) {
    if (t.protected && e.code !== 'ENOENT') { addFail(key); return send(res, textGate(t, token, 'رمز اشتباه است.')); }
    return send(res, notFound());
  }
  if (t.burn) { // claim synchronously so two simultaneous requests cannot both read it
    if (t.consumed) return send(res, notFound());
    t.consumed = true;
  }
  fails.delete(key);
  t.views++;
  send(res, textView(t, plain.toString('utf8')));
  if (t.burn) await deleteText(t); else save();
});

// ---- admin UI -----------------------------------------------------------------
// QR generator is served from node_modules so the page makes no third-party requests.
app.get('/vendor/qrcode.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=604800');
  res.type('js').sendFile(require.resolve('qrcode-generator'));
});
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
app.use((req, res) => res.status(404).type('text').send('Not found'));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.status === 413 ? 'حجم درخواست زیاد است.' : 'خطای سرور' });
});

// ---- periodic cleanup ------------------------------------------------------------
async function cleanup() {
  // drop stale rate-limiter entries so the map cannot grow without bound
  for (const [k, f] of fails) if (Date.now() - f.t > 15 * 60 * 1000 && (!f.until || f.until <= Date.now())) fails.delete(k);
  for (const r of Object.values(db.files)) {
    if (r.status === 'processing') continue;
    // failed records hold no usable file; drop them after a day so they stop counting against the quota
    if (isExpired(r) || (r.status === 'failed' && Date.now() - r.createdAt > 24 * 3600 * 1000)) await deleteRecord(r);
  }
  for (const t of Object.values(db.texts)) {
    if (isExpired(t) || t.consumed) await deleteText(t); // consumed = one-time text that was read
  }
  for (const u of Object.values(db.uploads)) {
    if (!finishing.has(u.id) && Date.now() - u.last > 24 * 3600 * 1000) {
      delete db.uploads[u.id];
      await unlinkQuiet(path.join(TMP, u.id + '.part'));
      save();
    }
  }
}
setInterval(() => cleanup().catch(console.error), 60 * 1000).unref();
cleanup().catch(console.error);

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log('Uploader listening on', port));
// large downloads and slow 5 MB chunks must not be cut off by Node's default timeouts
server.requestTimeout = 15 * 60 * 1000;
server.keepAliveTimeout = 65 * 1000;

// flush the database before exiting so a restart never loses the latest changes
let closing = false;
async function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(sig + ' received, shutting down');
  server.close();
  try { await save(); } catch { /* logged by save() */ }
  process.exit(0);
}
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => shutdown(s));
process.on('unhandledRejection', e => console.error('unhandled rejection', e));
