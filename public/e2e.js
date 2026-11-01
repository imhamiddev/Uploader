/*
 * End-to-end encryption helpers (WebCrypto, AES-256-GCM). Runs in the browser and in Node.
 * The server only ever stores/serves the output of these functions; keys live in the
 * link fragment (#k=...) or are derived from a password and never reach the server.
 *
 * File format (ciphertext):  prefix(8 random bytes) | block0 | block1 | ...
 *   block i = AES-GCM(iv = prefix || uint32(i), aad = uint32(i) || final-flag) of up to 1 MiB
 * The final flag + counter in the AAD make truncation, reordering and block swaps detectable.
 */
(function (root) {
  'use strict';
  const cr = root.crypto || (typeof require === 'function' ? require('crypto').webcrypto : undefined);
  const subtle = () => {
    if (!cr || !cr.subtle) throw new Error('رمزگذاری سرتاسری فقط روی HTTPS (یا localhost) کار می‌کند.');
    return cr.subtle;
  };
  const te = new TextEncoder(), td = new TextDecoder();
  const BLOCK = 1024 * 1024, TAG = 16, HEAD = 8, PBKDF2_ITER = 600000;
  const BAD = 'رمزگشایی ناموفق بود؛ کلید یا رمز اشتباه است یا داده خراب شده.';

  function b64uEnc(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDec(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  const rand = n => cr.getRandomValues(new Uint8Array(n));
  const importKey = raw => subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  // random 256-bit key; `raw` goes into the link fragment
  async function newKey() { const raw = rand(32); return { key: await importKey(raw), raw: b64uEnc(raw) }; }
  async function keyFromRaw(s) {
    const raw = b64uDec(s);
    if (raw.length !== 32) throw new Error('کلید داخل لینک نامعتبر است.');
    return importKey(raw);
  }

  // password -> key (PBKDF2-SHA256) plus a verifier so a typo can be caught before anything is consumed
  async function keyFromPassword(pw, salt) {
    salt = salt || rand(16);
    const base = await subtle().importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, base, 512));
    const vfy = new Uint8Array(await subtle().digest('SHA-256', bits.subarray(32)));
    return { key: await importKey(bits.slice(0, 32)), salt: b64uEnc(salt), vfy: b64uEnc(vfy) };
  }
  async function unlockWithPassword(pw, saltB64, vfyB64) {
    const d = await keyFromPassword(pw, b64uDec(saltB64));
    if (d.vfy !== vfyB64) throw new Error('رمز اشتباه است.');
    return d.key;
  }

  // small payloads (text, file metadata)
  async function seal(key, bytes, aad) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, bytes));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    return out;
  }
  async function open(key, bytes, aad) {
    if (bytes.length < 12 + TAG) throw new Error(BAD);
    try { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: te.encode(aad) }, key, bytes.subarray(12))); }
    catch { throw new Error(BAD); }
  }
  const sealText = async (key, str) => seal(key, te.encode(str), 'text');
  const openText = async (key, bytes) => td.decode(await open(key, bytes, 'text'));
  const sealMeta = async (key, obj) => b64uEnc(await seal(key, te.encode(JSON.stringify(obj)), 'meta'));
  const openMeta = async (key, str) => JSON.parse(td.decode(await open(key, b64uDec(str), 'meta')));

  // files
  const cipherSize = size => HEAD + size + TAG * Math.max(1, Math.ceil(size / BLOCK));
  const blockIv = (prefix, i) => { const iv = new Uint8Array(12); iv.set(prefix); new DataView(iv.buffer).setUint32(8, i); return iv; };
  const blockAad = (i, final) => { const a = new Uint8Array(5); new DataView(a.buffer).setUint32(0, i); a[4] = final ? 1 : 0; return a; };

  // yields ciphertext in chunks of exactly `chunkSize` bytes (the last one may be shorter)
  async function* encryptChunks(key, file, chunkSize) {
    const prefix = rand(HEAD), n = Math.max(1, Math.ceil(file.size / BLOCK));
    let buf = new Uint8Array(chunkSize), fill = 0;
    function* put(u8) {
      for (let o = 0; o < u8.length;) {
        const take = Math.min(chunkSize - fill, u8.length - o);
        buf.set(u8.subarray(o, o + take), fill); fill += take; o += take;
        if (fill === chunkSize) { yield buf; buf = new Uint8Array(chunkSize); fill = 0; }
      }
    }
    yield* put(prefix);
    for (let i = 0; i < n; i++) {
      const plain = new Uint8Array(await file.slice(i * BLOCK, Math.min(file.size, (i + 1) * BLOCK)).arrayBuffer());
      const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: blockIv(prefix, i), additionalData: blockAad(i, i === n - 1) }, key, plain));
      yield* put(ct);
    }
    if (fill) yield buf.slice(0, fill);
  }

  // streaming decryptor: push(chunk) -> array of plaintext pieces; done() throws if the stream was cut/extended
  function createDecryptor(key, total) {
    const dataLen = total - HEAD, full = BLOCK + TAG;
    if (!(dataLen >= TAG)) throw new Error(BAD);
    const nFull = Math.floor(dataLen / full), rem = dataLen % full;
    if (rem && rem < TAG) throw new Error(BAD);
    const nBlocks = nFull + (rem ? 1 : 0), blockLen = i => (i < nFull ? full : rem);
    let buf = new Uint8Array(0), prefix = null, i = 0;
    return {
      async push(chunk) {
        const nb = new Uint8Array(buf.length + chunk.length);
        nb.set(buf); nb.set(chunk, buf.length); buf = nb;
        const out = [];
        if (!prefix) { if (buf.length < HEAD) return out; prefix = buf.slice(0, HEAD); buf = buf.subarray(HEAD); }
        while (i < nBlocks && buf.length >= blockLen(i)) {
          const len = blockLen(i), c = buf.slice(0, len);
          buf = buf.subarray(len);
          try {
            out.push(new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: blockIv(prefix, i), additionalData: blockAad(i, i === nBlocks - 1) }, key, c)));
          } catch { throw new Error(BAD); }
          i++;
        }
        return out;
      },
      done() { if (i !== nBlocks || buf.length) throw new Error(BAD); }
    };
  }

  const api = { BLOCK, PBKDF2_ITER, b64uEnc, b64uDec, newKey, keyFromRaw, keyFromPassword, unlockWithPassword,
    sealText, openText, sealMeta, openMeta, cipherSize, encryptChunks, createDecryptor };
  root.E2E = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
