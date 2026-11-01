'use strict';
// Browser-level test of the public E2E viewer (public/viewer.js) using jsdom.
// Optional: skipped when jsdom is not installed (it is not a runtime dependency).
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { console.log('viewer test skipped (jsdom not installed)'); process.exit(0); }
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { webcrypto } = require('crypto');
const E2E = require('../public/e2e.js');

const PORT = 4100 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-view-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, ADMIN_USER: 'a', ADMIN_PASS: 'pass-pass-1', SESSION_SECRET: 'y'.repeat(32), DATA_DIR: DATA, PORT: String(PORT), TRUST_PROXY: '0' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';
async function req(url, o = {}) {
  const h = { ...(o.headers || {}) }; if (cookie) h.cookie = cookie;
  if (o.json) h['content-type'] = 'application/json';
  const r = await fetch(BASE + url, { method: o.method, headers: h, body: o.json ? JSON.stringify(o.json) : o.body });
  const sc = r.headers.get('set-cookie'); if (sc && /^sid=/.test(sc)) cookie = sc.split(';')[0];
  return r;
}

// open a landing page in jsdom like a visitor would (key lives in the URL fragment)
async function visit(link, hash) {
  const html = await (await fetch(BASE + link)).text();
  const downloads = [];
  const dom = new JSDOM(html, { url: BASE + link + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, val] of Object.entries({ crypto: webcrypto, TextEncoder, TextDecoder, Blob, Uint8Array, atob, btoa })) {
    Object.defineProperty(w, k, { value: val, configurable: true, writable: true });
  }
  w.fetch = (u, o) => fetch(new URL(u, BASE), o);
  w.URL.createObjectURL = b => { downloads.push(b); return 'blob:test'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  w.navigator.clipboard = { writeText: async () => {} };
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'e2e.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'viewer.js'), 'utf8'));
  return { w, d: w.document, downloads };
}
async function until(fn, ms = 8000) { for (let t = 0; t < ms; t += 50) { if (await fn()) return; await sleep(50); } throw new Error('timeout'); }

(async () => {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await sleep(100); } }
  await req('/api/login', { method: 'POST', json: { username: 'a', password: 'pass-pass-1' } });

  // --- E2E file protected by a password ---
  const plain = Buffer.alloc(E2E.BLOCK * 2 + 321, 11);
  const pk = await E2E.keyFromPassword('pa55word');
  const meta = await E2E.sealMeta(pk.key, { name: 'تست رمز.bin', type: 'application/octet-stream', size: plain.length });
  const init = await (await req('/api/upload/init', { method: 'POST', json: { name: 'encrypted.bin', size: E2E.cipherSize(plain.length) } })).json();
  let i = 0;
  for await (const c of E2E.encryptChunks(pk.key, new Blob([plain]), init.chunkSize)) await req(`/api/upload/${init.id}/${i++}`, { method: 'PUT', body: c });
  await req(`/api/upload/${init.id}/finish`, { method: 'POST', json: { e2e: { meta, salt: pk.salt, vfy: pk.vfy } } });
  await sleep(400);
  const rec = (await (await req('/api/files')).json()).files.find(f => f.id === init.id);

  let v = await visit(rec.link, '');
  v.d.getElementById('e2ePw').value = 'wrong';
  v.d.getElementById('e2eGo').click();
  await until(() => v.d.getElementById('e2eErr').textContent.includes('رمز اشتباه'));
  assert.strictEqual(v.downloads.length, 0, 'no download after wrong password');
  v.d.getElementById('e2ePw').value = 'pa55word';
  v.d.getElementById('e2eGo').click();
  await until(() => v.downloads.length === 2);
  const [blob, fname] = v.downloads;
  assert.strictEqual(fname, 'تست رمز.bin', 'real name recovered from encrypted metadata');
  assert.ok(Buffer.from(await blob.arrayBuffer()).equals(plain), 'decrypted download equals the original');

  // --- key in fragment: wrong / missing key ---
  const fk = await E2E.newKey();
  const meta2 = await E2E.sealMeta(fk.key, { name: 'k.txt', type: '', size: 3 });
  const init2 = await (await req('/api/upload/init', { method: 'POST', json: { name: 'encrypted.bin', size: E2E.cipherSize(3) } })).json();
  i = 0; for await (const c of E2E.encryptChunks(fk.key, new Blob(['abc']), init2.chunkSize)) await req(`/api/upload/${init2.id}/${i++}`, { method: 'PUT', body: c });
  await req(`/api/upload/${init2.id}/finish`, { method: 'POST', json: { e2e: { meta: meta2 } } });
  await sleep(300);
  const rec2 = (await (await req('/api/files')).json()).files.find(f => f.id === init2.id);
  v = await visit(rec2.link, '');
  v.d.getElementById('e2eGo').click();
  await until(() => v.d.getElementById('e2eErr').textContent.includes('کلید'));
  v = await visit(rec2.link, '#k=' + (await E2E.newKey()).raw);
  v.d.getElementById('e2eGo').click();
  await until(() => v.d.getElementById('e2eErr').textContent.includes('رمزگشایی ناموفق'));
  v = await visit(rec2.link, '#k=' + fk.raw);
  await until(() => v.d.getElementById('e2eTitle').textContent === 'k.txt'); // name shown on load
  v.d.getElementById('e2eGo').click();
  await until(() => v.downloads.length === 2);

  // --- one-time E2E text: a wrong password must NOT burn it ---
  const tpk = await E2E.keyFromPassword('tp');
  const tr = await (await req('/api/texts', { method: 'POST', json: { e2e: true, burn: true, chars: 5, salt: tpk.salt, vfy: tpk.vfy,
    payload: E2E.b64uEnc(await E2E.sealText(tpk.key, 'hello <i>e2e</i>')), meta: await E2E.sealMeta(tpk.key, { v: 1 }) } })).json();
  v = await visit(tr.link, '');
  v.d.getElementById('e2ePw').value = 'nope'; v.d.getElementById('e2eGo').click();
  await until(() => v.d.getElementById('e2eErr').textContent.includes('رمز اشتباه'));
  assert.ok(v.d.getElementById('e2eOut').hidden, 'text stays hidden');
  v.d.getElementById('e2ePw').value = 'tp'; v.d.getElementById('e2eGo').click();
  await until(() => !v.d.getElementById('e2eOut').hidden);
  assert.strictEqual(v.d.getElementById('e2eOut').textContent, 'hello <i>e2e</i>');
  assert.strictEqual(v.d.getElementById('e2eOut').children.length, 0, 'text rendered as text, not HTML');
  const again = await visit(tr.link, '');
  assert.ok(again.d.body.textContent.includes('معتبر نیست'), 'burned after the first successful read');

  console.log('viewer tests passed');
})().then(() => done(0)).catch(e => { console.error(e); done(1); });
function done(c) { srv.kill('SIGTERM'); setTimeout(() => { fs.rmSync(DATA, { recursive: true, force: true }); process.exit(c); }, 300); }
