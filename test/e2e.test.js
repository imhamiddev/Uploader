'use strict';
// Unit tests for the browser-side end-to-end encryption helpers (public/e2e.js).
const assert = require('assert');
const E = require('../public/e2e.js');

async function encryptAll(key, bytes, chunkSize) {
  const out = [];
  for await (const c of E.encryptChunks(key, new Blob([bytes]), chunkSize)) out.push(Buffer.from(c));
  return Buffer.concat(out);
}
async function decryptAll(key, ct, step) {
  const d = E.createDecryptor(key, ct.length), parts = [];
  for (let o = 0; o < ct.length; o += step) for (const p of await d.push(ct.subarray(o, o + step))) parts.push(Buffer.from(p));
  d.done();
  return Buffer.concat(parts);
}
const fails = async (fn, msg) => { let ok = false; try { await fn(); } catch { ok = true; } assert.ok(ok, msg); };

(async () => {
  const { key, raw } = await E.newKey();
  assert.strictEqual(E.b64uDec(raw).length, 32);
  const key2 = await E.keyFromRaw(raw);

  // text + metadata
  const txt = 'سلام دنیا 🌍 <script>alert(1)</script>';
  const sealed = await E.sealText(key, txt);
  assert.strictEqual(await E.openText(key2, sealed), txt, 'text round-trip with re-imported key');
  assert.notStrictEqual(Buffer.from(sealed).toString('hex'), Buffer.from(await E.sealText(key, txt)).toString('hex'), 'fresh IV every time');
  const other = (await E.newKey()).key;
  await fails(() => E.openText(other, sealed), 'wrong key must fail');
  const bad = Uint8Array.from(sealed); bad[bad.length - 1] ^= 1;
  await fails(() => E.openText(key, bad), 'tampered text must fail');
  const meta = await E.sealMeta(key, { name: 'راز.pdf', size: 5, type: 'application/pdf' });
  assert.strictEqual((await E.openMeta(key, meta)).name, 'راز.pdf');
  await fails(() => E.openText(key, E.b64uDec(meta)), 'meta cannot be opened as text (AAD binding)');

  // password -> key, verifier catches typos
  const pk = await E.keyFromPassword('correct horse');
  const unlocked = await E.unlockWithPassword('correct horse', pk.salt, pk.vfy);
  assert.strictEqual(await E.openText(unlocked, await E.sealText(pk.key, 'x')), 'x');
  await fails(() => E.unlockWithPassword('wrong', pk.salt, pk.vfy), 'wrong password rejected by verifier');
  assert.notStrictEqual((await E.keyFromPassword('correct horse')).salt, pk.salt, 'random salt per call');

  // files: sizes around the block boundary, odd chunk sizes
  const B = E.BLOCK;
  for (const size of [0, 1, 100, B - 1, B, B + 1, 2 * B, 2 * B + 777]) {
    const plain = Buffer.alloc(size); for (let i = 0; i < size; i += 4099) plain[i] = (i / 4099) & 255;
    for (const chunk of [5 * 1024 * 1024, 300007]) {
      const ct = await encryptAll(key, plain, chunk);
      assert.strictEqual(ct.length, E.cipherSize(size), `cipherSize ${size}`);
      for (const step of [ct.length, 65537]) assert.ok((await decryptAll(key, ct, step)).equals(plain), `round-trip size=${size} chunk=${chunk} step=${step}`);
    }
  }
  const sample = Buffer.alloc(2 * B + 500, 9);
  const ct = await encryptAll(key, sample, 5 * 1024 * 1024);
  assert.ok(!ct.includes(Buffer.alloc(64, 9)), 'ciphertext does not contain plaintext runs');

  // integrity: tamper, truncate, extend, swap blocks, wrong key
  const flip = Buffer.from(ct); flip[100] ^= 1;
  await fails(() => decryptAll(key, flip, 65537), 'bit flip detected');
  await fails(() => decryptAll(key, ct.subarray(0, ct.length - 5), 65537), 'truncation detected');
  await fails(() => decryptAll(key, Buffer.concat([ct, Buffer.from([0])]), 65537), 'extra bytes detected');
  await fails(() => decryptAll(other, ct, 65537), 'wrong key detected');
  const full = B + 16, swapped = Buffer.from(ct);
  ct.subarray(8, 8 + full).copy(swapped, 8 + full); ct.subarray(8 + full, 8 + 2 * full).copy(swapped, 8);
  await fails(() => decryptAll(key, swapped, 65537), 'block reordering detected');
  // dropping the last block from a stream that ends on a block boundary must not look valid
  const two = await encryptAll(key, Buffer.alloc(2 * B, 3), 5 * 1024 * 1024);
  const cut = two.subarray(0, 8 + full);
  await fails(() => decryptAll(key, cut, 65537), 'cutting at a block boundary detected (final flag)');

  console.log('e2e crypto tests passed');
})().catch(e => { console.error(e); process.exit(1); });
