'use strict';
// End-to-end smoke test: starts the server on a temp data dir and exercises the main flows.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-test-'));
const CHUNK = 5 * 1024 * 1024;
let cookie = '';

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, ADMIN_USER: 'admin', ADMIN_PASS: 'test-password-123', SESSION_SECRET: 'x'.repeat(32), DATA_DIR: DATA, PORT: String(PORT), TRUST_PROXY: '0' },
  stdio: ['ignore', 'pipe', 'inherit']
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(url, { method = 'GET', json, body, headers = {}, redirect = 'manual' } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (json) h['content-type'] = 'application/json';
  const r = await fetch(BASE + url, { method, headers: h, body: json ? JSON.stringify(json) : body, redirect });
  const sc = r.headers.get('set-cookie');
  if (sc && /^sid=/.test(sc)) cookie = sc.split(';')[0];
  return r;
}
async function waitUp() {
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/me'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
}
async function upload(size, opts) {
  const data = Buffer.alloc(size, 7);
  const init = await (await req('/api/upload/init', { method: 'POST', json: { name: 'a.bin', size } })).json();
  for (let i = 0, off = 0; off < size; i++, off += CHUNK) {
    const r = await req(`/api/upload/${init.id}/${i}`, { method: 'PUT', body: data.subarray(off, Math.min(off + CHUNK, size)) });
    assert.strictEqual(r.status, 200, 'chunk ' + i);
  }
  const fin = await req(`/api/upload/${init.id}/finish`, { method: 'POST', json: opts });
  assert.strictEqual(fin.status, 200, 'finish');
  for (let i = 0; i < 100; i++) {
    const list = await (await req('/api/files')).json();
    const f = list.files.find(x => x.id === init.id);
    if (f && f.status !== 'processing') return { f, init, data };
    await sleep(100);
  }
  throw new Error('processing timeout');
}

(async () => {
  await waitUp();

  // auth
  assert.strictEqual((await req('/api/files')).status, 401, 'files require auth');
  assert.strictEqual((await req('/api/login', { method: 'POST', json: { username: 'admin', password: 'bad' } })).status, 401);
  assert.strictEqual((await req('/api/login', { method: 'POST', json: { username: 'admin', password: 'test-password-123' } })).status, 200);
  const hdr = (await req('/api/me')).headers;
  assert.ok(hdr.get('content-security-policy'), 'CSP header');
  assert.strictEqual(hdr.get('cache-control'), 'no-store', 'API no-store');

  // upload validation
  assert.strictEqual((await req('/api/upload/init', { method: 'POST', json: { name: 'x', size: '10' } })).status, 400, 'size must be a number');
  assert.strictEqual((await req('/api/upload/init', { method: 'POST', json: { name: 'x', size: -1 } })).status, 400);
  const bad = await (await req('/api/upload/init', { method: 'POST', json: { name: 'x', size: 100 } })).json();
  assert.strictEqual((await req(`/api/upload/${bad.id}/0`, { method: 'PUT', body: Buffer.alloc(50) })).status, 400, 'short chunk rejected');
  assert.strictEqual((await req(`/api/upload/${bad.id}/1`, { method: 'PUT', body: Buffer.alloc(100) })).status, 400, 'index out of range');
  assert.strictEqual((await req(`/api/upload/${bad.id}/finish`, { method: 'POST', json: {} })).status, 400, 'incomplete upload rejected');
  await req(`/api/upload/${bad.id}`, { method: 'DELETE' });

  // plain upload, multi-chunk, with link password
  const { f, data } = await upload(CHUNK * 2 + 123, { rename: true, name: 'hello.bin', password: 'pw1', expiresAt: Date.now() + 3600e3 });
  assert.strictEqual(f.status, 'ready');
  assert.strictEqual(f.name, 'hello.bin');
  assert.ok(f.hasPassword && f.link);

  // public side: password gate
  cookie = ''; // act as an anonymous visitor
  assert.strictEqual((await req(f.link)).status, 200, 'landing page');
  assert.strictEqual((await req(f.link + '/file')).status, 303, 'file needs password');
  const wrong = await req(f.link, { method: 'POST', body: 'password=nope', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(wrong.status, 401);
  const right = await req(f.link, { method: 'POST', body: 'password=pw1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(right.status, 303);
  const dl = right.headers.get('set-cookie').split(';')[0];
  const file = await fetch(BASE + f.link + '/file', { headers: { cookie: dl } });
  assert.strictEqual(file.status, 200);
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(data), 'downloaded bytes match');
  const part = await fetch(BASE + f.link + '/file', { headers: { cookie: dl, range: 'bytes=10-19' } });
  assert.strictEqual(part.status, 206, 'range supported');

  // admin: zip + encrypted zip, revoke / regenerate / delete
  await req('/api/login', { method: 'POST', json: { username: 'admin', password: 'test-password-123' } });
  const z = await upload(1000, { zip: true, zipPassword: 'secret' });
  assert.ok(z.f.zipped && z.f.zipEncrypted && /\.zip$/.test(z.f.name));
  assert.strictEqual((await req(`/api/files/${z.f.id}/revoke`, { method: 'POST' })).status, 200);
  assert.strictEqual((await fetch(BASE + z.f.link)).status, 404, 'revoked link is dead');
  const regen = await (await req(`/api/files/${z.f.id}/regenerate`, { method: 'POST' })).json();
  assert.strictEqual((await fetch(BASE + regen.link)).status, 200, 'new link works');
  const patch = await req(`/api/files/${z.f.id}`, { method: 'PATCH', json: { password: 'newpw' } });
  assert.strictEqual(patch.status, 200);
  assert.strictEqual((await req(`/api/files/${z.f.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await req(`/api/files/${f.id}`, { method: 'DELETE' })).status, 200);
  const left = await (await req('/api/files')).json();
  assert.strictEqual(left.files.length, 0);
  assert.deepStrictEqual(fs.readdirSync(path.join(DATA, 'files')), [], 'no files left on disk');

  // ---- multi-file bundle (one link, one zip) ----
  async function rawUpload(name, bytes) {
    const init = await (await req('/api/upload/init', { method: 'POST', json: { name, size: bytes.length } })).json();
    assert.strictEqual((await req(`/api/upload/${init.id}/0`, { method: 'PUT', body: bytes })).status, 200);
    return init.id;
  }
  const bid = [await rawUpload('same.txt', Buffer.from('one')), await rawUpload('same.txt', Buffer.from('two')), await rawUpload('b.bin', Buffer.alloc(300, 1))];
  assert.strictEqual((await req('/api/bundle/finish', { method: 'POST', json: { ids: [] } })).status, 400, 'empty bundle rejected');
  assert.strictEqual((await req('/api/bundle/finish', { method: 'POST', json: { ids: [bid[0], 'nope'] } })).status, 404, 'unknown upload rejected');
  const bf = await (await req('/api/bundle/finish', { method: 'POST', json: { ids: bid, rename: true, name: 'pack', password: 'bpw' } })).json();
  let brec;
  for (let i = 0; i < 100 && !(brec && brec.status !== 'processing'); i++) { await sleep(100); brec = (await (await req('/api/files')).json()).files.find(x => x.id === bf.id); }
  assert.strictEqual(brec.status, 'ready'); assert.strictEqual(brec.name, 'pack.zip'); assert.strictEqual(brec.bundle, 3);
  assert.strictEqual((await req('/api/bundle/finish', { method: 'POST', json: { ids: bid } })).status, 404, 'uploads are consumed by the bundle');
  const zipPath = path.join(DATA, 'files', bf.id + '.zip');
  const zbuf = fs.readFileSync(zipPath).toString('latin1');
  for (const n of ['same.txt', 'same (2).txt', 'b.bin']) assert.ok(zbuf.includes(n), 'zip contains ' + n);
  assert.deepStrictEqual(fs.readdirSync(path.join(DATA, 'tmp')), [], 'temp parts removed after zipping');
  assert.strictEqual((await req(`/api/files/${bf.id}`, { method: 'DELETE' })).status, 200);

  // ---- QR library is served locally ----
  const qrjs = await fetch(BASE + '/vendor/qrcode.js');
  assert.strictEqual(qrjs.status, 200); assert.ok((await qrjs.text()).includes('qrcode'));

  // ---- encrypted texts ----
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const secretText = 'سلام <b>x</b> & secret-marker-12345';
  assert.strictEqual((await req('/api/texts', { method: 'POST', json: { text: '   ' } })).status, 400, 'empty text rejected');
  assert.strictEqual((await req('/api/texts', { method: 'POST', json: { text: 'a'.repeat(1024 * 1024 + 1) } })).status, 413, 'oversize text rejected');
  const ct = await (await req('/api/texts', { method: 'POST', json: { text: secretText, title: 'Note: 1', password: 'tpw' } })).json();
  assert.ok(ct.link && ct.link.startsWith('/t/'));
  const enc = fs.readFileSync(path.join(DATA, 'texts', ct.id + '.enc'));
  assert.ok(!enc.includes('secret-marker-12345'), 'ciphertext on disk must not contain plaintext');
  assert.ok(!fs.readFileSync(path.join(DATA, 'db.json'), 'utf8').includes('secret-marker'), 'db must not contain plaintext');
  const anon = cookie; cookie = '';
  const gate = await req(ct.link);
  assert.strictEqual(gate.status, 200);
  assert.ok(!(await gate.text()).includes('secret-marker'), 'gate page must not show the text');
  assert.strictEqual((await req(ct.link, { method: 'POST', body: 'password=wrong', headers: form })).status, 401, 'wrong text password');
  const shown = await req(ct.link, { method: 'POST', body: 'password=tpw', headers: form });
  assert.strictEqual(shown.status, 200);
  const html = await shown.text();
  assert.ok(html.includes('secret-marker-12345') && html.includes('&lt;b&gt;x&lt;/b&gt;'), 'text shown and HTML-escaped');
  assert.strictEqual(shown.headers.get('cache-control'), 'private, no-store');

  // one-time text: GET (crawler) must not burn it; first POST shows it, second is gone
  cookie = anon;
  const once = await (await req('/api/texts', { method: 'POST', json: { text: 'burn me', burn: true } })).json();
  cookie = '';
  await req(once.link); await req(once.link);
  assert.strictEqual((await req(once.link, { method: 'POST', body: '', headers: form })).status, 200, 'first read works');
  assert.strictEqual((await req(once.link, { method: 'POST', body: '', headers: form })).status, 404, 'second read is gone');
  await sleep(200);
  cookie = anon;
  const tl = await (await req('/api/texts')).json();
  assert.strictEqual(tl.texts.length, 1, 'burned text removed from list');
  assert.ok(tl.texts[0].protected && tl.texts[0].views === 1);
  assert.strictEqual((await req(`/api/texts/${ct.id}/revoke`, { method: 'POST' })).status, 200);
  assert.strictEqual((await fetch(BASE + ct.link)).status, 404, 'revoked text link is dead');
  assert.strictEqual((await req(`/api/texts/${ct.id}`, { method: 'DELETE' })).status, 200);
  assert.deepStrictEqual(fs.readdirSync(path.join(DATA, 'texts')), [], 'no ciphertext left on disk');

  console.log('all smoke tests passed');
})().then(() => cleanup(0)).catch(e => { console.error(e); cleanup(1); });

function cleanup(code) {
  srv.kill('SIGTERM');
  setTimeout(() => { fs.rmSync(DATA, { recursive: true, force: true }); process.exit(code); }, 300);
}
