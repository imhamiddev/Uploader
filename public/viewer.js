/* Public viewer for end-to-end encrypted files and texts. All decryption happens here. */
(function () {
  'use strict';
  const box = document.getElementById('e2e');
  if (!box) return;
  const d = box.dataset, $ = id => document.getElementById(id);
  const go = $('e2eGo'), goText = go.querySelector('span'), err = $('e2eErr'), pwIn = $('e2ePw');
  const isFile = d.kind === 'file';
  const idleText = goText.textContent;
  const setErr = m => { err.textContent = m || ''; };
  const faNum = n => Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 1 });
  const fmtSize = b => { const u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return faNum(b) + ' ' + u[i]; };

  const fragKey = () => { const m = /(?:^|[#&])k=([A-Za-z0-9_-]+)/.exec(location.hash); return m && m[1]; };
  // the key comes from the link fragment (never sent to the server) or from the password
  async function getKey() {
    if (d.salt) {
      if (!pwIn.value) throw new Error('رمز را وارد کنید.');
      return E2E.unlockWithPassword(pwIn.value, d.salt, d.vfy);
    }
    const k = fragKey();
    if (!k) throw new Error('کلید رمزگشایی در لینک نیست. لینک را کامل (همراه با بخش #k=...) باز کنید.');
    return E2E.keyFromRaw(k);
  }
  const safeName = n => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'file';

  async function downloadFile() {
    const key = await getKey();
    const m = await E2E.openMeta(key, d.meta); // also proves the key/password is right
    $('e2eTitle').textContent = m.name;
    if ($('e2eSize') && m.size >= 0) $('e2eSize').lastChild.textContent = fmtSize(m.size);

    // stream straight to disk when the browser allows it (no RAM limit); otherwise buffer in a Blob
    let sink = null;
    if (window.showSaveFilePicker) {
      try { sink = await (await window.showSaveFilePicker({ suggestedName: safeName(m.name) })).createWritable(); }
      catch (e) { if (e && e.name === 'AbortError') throw new Error('ذخیره لغو شد.'); sink = null; }
    }
    const res = await fetch('/d/' + d.token + '/file', { cache: 'no-store' });
    if (!res.ok) { if (sink) await sink.abort().catch(() => {}); throw new Error(res.status === 404 ? 'این لینک دیگر معتبر نیست.' : 'دانلود ناموفق بود (' + res.status + ').'); }
    const total = Number(d.size), dec = E2E.createDecryptor(key, total), parts = [];
    let got = 0;
    const handle = async chunk => {
      got += chunk.length;
      for (const p of await dec.push(chunk)) { if (sink) await sink.write(p); else parts.push(p); }
      goText.textContent = 'در حال رمزگشایی… ' + faNum(Math.min(100, got / total * 100)) + '٪';
    };
    try {
      if (res.body && res.body.getReader) {
        const rd = res.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; await handle(value); }
      } else await handle(new Uint8Array(await res.arrayBuffer()));
      dec.done();
    } catch (e) { if (sink) await sink.abort().catch(() => {}); throw e; }
    if (sink) { await sink.close(); return; }
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: safeName(m.name) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function showText() {
    const key = await getKey();
    await E2E.openMeta(key, d.meta); // key check BEFORE asking the server, so a typo never burns a one-time text
    const r = await fetch('/t/' + d.token + '/reveal', { method: 'POST', cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'این متن دیگر در دسترس نیست.' : 'دریافت متن ناموفق بود (' + r.status + ').');
    const text = await E2E.openText(key, E2E.b64uDec((await r.json()).payload));
    const out = $('e2eOut');
    out.textContent = text; out.hidden = false;
    go.hidden = true; if (pwIn) pwIn.hidden = true;
    const cp = $('e2eCopy'); cp.hidden = false;
    cp.onclick = async () => {
      try { await navigator.clipboard.writeText(text); cp.textContent = 'کپی شد'; }
      catch { const rg = document.createRange(); rg.selectNodeContents(out); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
    };
    if (d.burn === '1') setErr('این متن از سرور حذف شد. همین حالا آن را کپی کنید.');
  }

  let busy = false;
  async function run() {
    if (busy) return;
    busy = true; go.disabled = true; setErr('');
    goText.textContent = 'در حال پردازش…';
    try { await (isFile ? downloadFile() : showText()); goText.textContent = isFile ? 'دانلود انجام شد' : idleText; }
    catch (e) { setErr(e && e.message ? e.message : 'خطای ناشناخته'); goText.textContent = idleText; }
    busy = false; go.disabled = false;
  }
  go.addEventListener('click', run);
  if (pwIn) pwIn.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

  // no password: show the real file name/size as soon as the page opens (the key is in the fragment)
  if (isFile && !d.salt && fragKey()) {
    getKey().then(k => E2E.openMeta(k, d.meta)).then(m => {
      $('e2eTitle').textContent = m.name;
      if ($('e2eSize') && m.size >= 0) $('e2eSize').lastChild.textContent = fmtSize(m.size);
    }).catch(() => {});
  }
})();
