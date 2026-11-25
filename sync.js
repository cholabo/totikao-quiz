// ログインと端末間の同期（2026-11-16）。設計は analysis/login_design_20261113.md、Worker は account/worker。
// 端末の中（localStorage）が正で、サーバーは控え。通信が無くても解くことには影響しない。
// 今のアプリの保存処理には手を入れず、ここが localStorage を外から読んで混ぜる。
//
// 混ぜ方は三方向: 最後に同期した時点の写し（sync.base）と、端末・サーバーを項目ごとに比べる。
//   端末が写しと同じ → サーバーを採る / サーバーが写しと同じ → 端末を採る / 両方変わった → 種類ごとの決まり
// 初めてのログイン（写しが無い）は足し合わせる。
//
// ページを開いたときに他の端末の分が入ってきたら、まだ何も触っていなければ書き換えて 1 回だけ読み直す。
// 触った後なら端末は書き換えず、混ぜたものをサーバーにだけ送る（画面が持っている古い記録で上書きされないように）。次に開いたときに入る。
(function () {
  "use strict";

  // ---- 同期する項目（キー → 種類） ----
  // map:newer 肢ごと、両方変わったら lastAnsweredAt が新しいほう / map:union 中身の配列を足し合わせる
  // set 要素ごと / max 大きいほう / scalar 丸ごと、両方変わったら端末のほう
  // …:keep 片方に無いことを「消された」とみなさない（古い sync.js を開いたままの端末が、知らないキーを落として書いても記録が消えないように）
  const SPEC = [
    ["learningStateByLabel", "map:newer"],
    ["bookmarkedLabels", "set"],
    ["yearModePassCount", "max"],
    ["yearModeStartLabel", "scalar"],
    ["yearModeResumeLabel", "scalar"],
    ["tagModeResume", "scalar"],
    ["quizMode", "scalar"],
    ["shinsei.bm", "set"],
    ["shinsei.cur", "scalar"],
    [/^sh2-/, "scalar"],            // 申請書例の文字欄・続き・モード
    ["keisan-calc", "scalar"],
    ["keisan-set", "scalar"],
    ["yasashii.read", "map:union"],
    ["yasashii.pos", "scalar"],
    // 測量士補（app/sokuryo/、2026-11-25）
    ["sk.learningState", "map:newer:keep"],
    ["sk.position", "map:local:keep"],
    ["sk.yearModePassCount", "max"],
    ["sk.yearModeStartLabel", "scalar"],
    ["sk.yearModeResumeLabel", "scalar:keep"],
    ["sk.lastSet", "scalar:keep"],
    ["sk.quizMode", "scalar:keep"],
  ];
  const kindOf = k => { for (const [m, t] of SPEC) if (typeof m === "string" ? m === k : m.test(k)) return t; return null; };

  // ---- 混ぜる（純粋な関数。account/test_merge.js で試す） ----
  const parse = (s, d) => { if (s == null) return d; try { const v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function mergeScalar(l, s, b, hasBase) {
    if (l === s) return l;
    if (hasBase) { if (l === b) return s; if (s === b) return l; }
    return l != null ? l : s;
  }
  function mergeSet(l, s, b, hasBase) {
    const L = parse(l, []), S = parse(s, []), B = parse(b, []);
    if (!Array.isArray(L) || !Array.isArray(S)) return l != null ? l : s;
    const inL = new Set(L), inS = new Set(S), inB = new Set(Array.isArray(B) ? B : []);
    const out = [];
    for (const e of [...L, ...S.filter(x => !inL.has(x))]) {
      const keep = !hasBase ? true : (inL.has(e) === inB.has(e) ? inS.has(e) : inL.has(e));
      if (keep && !out.includes(e)) out.push(e);
    }
    if (l == null && s == null) return null;
    return JSON.stringify(out);
  }
  function mergeMap(l, s, b, hasBase, rule, keep) {
    const L = parse(l, {}), S = parse(s, {}), B = parse(b, {});
    if (typeof L !== "object" || typeof S !== "object" || Array.isArray(L) || Array.isArray(S)) return l != null ? l : s;
    const out = {};
    for (const k of new Set([...Object.keys(L), ...Object.keys(S)])) {
      const lv = L[k], sv = S[k], bv = B && typeof B === "object" ? B[k] : undefined;
      let v;
      if (same(lv, sv)) v = lv;
      else if (keep && (lv === undefined || sv === undefined)) v = lv === undefined ? sv : lv;
      else if (hasBase && same(lv, bv)) v = sv;
      else if (hasBase && same(sv, bv)) v = lv;
      else if (lv === undefined) v = sv;
      else if (sv === undefined) v = lv;
      else if (rule === "newer") v = String(sv.lastAnsweredAt || "") > String(lv.lastAnsweredAt || "") ? sv : lv;
      else if (rule === "union" && Array.isArray(lv) && Array.isArray(sv)) v = [...lv, ...sv.filter(x => !lv.includes(x))];
      else v = lv;
      if (v !== undefined) out[k] = v;
    }
    if (l == null && s == null) return null;
    return JSON.stringify(out);
  }
  // local, server, base は { キー: 文字列 }。base が null なら初めての同期
  function merge(local, server, base) {
    const hasBase = !!base;
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(server)])) {
      const t = kindOf(k); if (!t) continue;
      const l = local[k] ?? null, s = server[k] ?? null, b = hasBase ? (base[k] ?? null) : null;
      let v;
      if (t === "scalar:keep" && (l == null || s == null)) v = l != null ? l : s;
      else if (t === "scalar" || t === "scalar:keep") v = mergeScalar(l, s, b, hasBase);
      else if (t === "max") v = l == null ? s : s == null ? l : String(Math.max(Number(l) || 0, Number(s) || 0));
      else if (t === "set") v = mergeSet(l, s, b, hasBase);
      else v = mergeMap(l, s, b, hasBase, t.split(":")[1], t.split(":")[2] === "keep");
      if (v != null) out[k] = v;
    }
    return out;
  }

  if (typeof window === "undefined") { module.exports = { merge, kindOf }; return; }

  // ---- 設定 ----
  // GOOGLE_CLIENT_ID が空のあいだはログインの入口を出さない（公開しても何も変わらない）。
  // 手元で試すときは devtools で localStorage.setItem("acct.endpoint", "http://localhost:8788")（試験ログインが出る）
  const GOOGLE_CLIENT_ID = "898353357589-h7qrth2v8n8r5uag0bn50ce7asd00d3t.apps.googleusercontent.com";   // Google Cloud プロジェクト cholabo（2026-11-16）
  const ENDPOINT_DEFAULT = "https://cholabo-account.cholabo.workers.dev";
  const LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const get = k => { try { return LS ? LS.getItem(k) : null; } catch (e) { return null; } };
  const DEV_ENDPOINT = get("acct.endpoint");
  const ENDPOINT = (DEV_ENDPOINT || ENDPOINT_DEFAULT).replace(/\/$/, "");
  const ENABLED = !!(GOOGLE_CLIENT_ID || DEV_ENDPOINT);

  const K = { token: "acct.token", user: "acct.user", base: "sync.base", rev: "sync.rev", at: "sync.at" };
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const put = (k, v) => { try { v == null ? rawRemove.call(LS, k) : rawSet.call(LS, k, v); } catch (e) { /* 容量不足など */ } };

  function snapshot() {
    const o = {};
    if (!LS) return o;
    for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && kindOf(k)) o[k] = LS.getItem(k); }
    return o;
  }

  // ---- 状態 ----
  let interacted = false, dirty = false, busy = null, timer = null, applying = false;
  const token = () => get(K.token);
  const user = () => parse(get(K.user), null);
  function emit(state, extra) {
    try { window.dispatchEvent(new CustomEvent("cholabo-sync", { detail: Object.assign({ state, at: get(K.at), user: user() }, extra || {}) })); } catch (e) {}
  }

  // 触ったか（触った後は端末を書き換えない）
  ["pointerdown", "keydown", "touchstart"].forEach(t => window.addEventListener(t, () => { interacted = true; }, { capture: true, passive: true }));

  // 同期する項目が書かれたら、少し待ってまとめて送る
  function onWrite(store, k) {
    if (applying || store !== LS || !kindOf(k) || !token()) return;
    // 30 秒まとめる（1 問ごとに送ると Workers の無料枠 1 日 10 万回を早く使う）。ページを離れるときは待たずに送る
    dirty = true; clearTimeout(timer); timer = setTimeout(() => syncNow(), 30000);
  }
  Storage.prototype.setItem = function (k, v) { const r = rawSet.call(this, k, v); onWrite(this, String(k)); return r; };
  Storage.prototype.removeItem = function (k) { const r = rawRemove.call(this, k); onWrite(this, String(k)); return r; };

  // ---- 通信 ----
  async function api(method, path, body, headers, keepalive) {
    const h = Object.assign({}, headers || {});
    const t = token(); if (t) h.authorization = "Bearer " + t;
    const r = await fetch(ENDPOINT + path, { method, headers: h, body, keepalive: !!keepalive, cache: "no-store" });
    const nt = r.headers.get("x-token"); if (nt) put(K.token, nt);
    if (r.status === 401 && t) { forget(false); emit("signedout"); throw new Error("unauthorized"); }
    return r;
  }
  async function pack(obj) {
    const text = JSON.stringify(obj);
    if (typeof CompressionStream === "function") {
      try { return { body: await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(), enc: "gzip" }; } catch (e) {}
    }
    return { body: text, enc: "json" };
  }
  async function unpack(r) {
    if (r.headers.get("x-enc") === "gzip") return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text());
    return r.json();
  }

  // ---- 同期 ----
  function syncNow(opts) {
    if (!ENABLED || !token()) return Promise.resolve(null);
    if (busy) { busy.then(() => { if (dirty) syncNow(); }); return busy; }
    busy = run(opts || {}).catch(e => { emit(navigator.onLine === false ? "offline" : "error", { error: String(e.message || e) }); return null; }).finally(() => { busy = null; });
    return busy;
  }
  async function run(opts) {
    dirty = false;
    emit("syncing");
    // 近道: 前の同期から他の端末が書いていなければ（rev が写しと同じ）、取ってこずに端末の分だけ送る。食い違えば 409 で下の通常の道へ。
    // 写しは「サーバーと揃っていると分かっている時点」でしか更新しないので、写しの rev で送れば他の端末の分を消すことはない
    if (!opts.initial && opts.apply !== "always") {
      const baseDoc = parse(get(K.base), null);
      if (baseDoc && baseDoc.rev) {
        const local = snapshot();
        if (same(sortKeys(local), sortKeys(baseDoc.keys))) { put(K.at, new Date().toISOString()); emit("ok", { changed: 0, applied: true }); return { changed: 0 }; }
        const p = await pack({ v: 1, keys: local, at: Date.now() });
        const w = await api("PUT", "/sync?rev=" + baseDoc.rev, p.body, { "x-enc": p.enc }, opts.keepalive);
        if (w.ok) {
          const newRev = (await w.json()).rev;
          put(K.base, JSON.stringify({ rev: newRev, keys: local })); put(K.rev, String(newRev)); put(K.at, new Date().toISOString());
          emit("ok", { changed: 0, applied: true });
          return { changed: 0 };
        }
        if (w.status !== 409) throw new Error("sync put " + w.status);
      }
    }
    for (let tries = 0; tries < 4; tries++) {
      const r = await api("GET", "/sync");
      if (!r.ok && r.status !== 204) throw new Error("sync " + r.status);
      const rev = parseInt(r.headers.get("x-rev") || "0", 10);
      const doc = r.status === 204 ? null : await unpack(r);
      const server = (doc && doc.keys) || {};
      const local = snapshot();
      const baseDoc = parse(get(K.base), null);
      const merged = merge(local, server, baseDoc && baseDoc.keys);
      let newRev = rev;
      if (!doc || !same(sortKeys(merged), sortKeys(server))) {
        const p = await pack({ v: 1, keys: merged, at: Date.now() });
        const w = await api("PUT", "/sync?rev=" + rev, p.body, { "x-enc": p.enc }, opts.keepalive);
        if (w.status === 409) continue;        // 他の端末が先に書いた。取り直して混ぜ直す
        if (!w.ok) throw new Error("sync put " + w.status);
        newRev = (await w.json()).rev;
      }
      const changed = Object.keys({ ...local, ...merged }).filter(k => (local[k] ?? null) !== (merged[k] ?? null));
      const canApply = opts.apply === "always" || (opts.initial && !interacted) || window.SYNC_SAFE_APPLY;
      if (!changed.length || canApply) {
        if (changed.length) {
          applying = true;
          try { for (const k of changed) put(k, merged[k] ?? null); } finally { applying = false; }
        }
        put(K.base, JSON.stringify({ rev: newRev, keys: merged }));
      }
      put(K.rev, String(newRev));
      put(K.at, new Date().toISOString());
      emit("ok", { changed: changed.length, applied: !changed.length || canApply });
      // 入ってきた分を画面に出すため 1 回だけ読み直す（続けて読み直さない）
      if (changed.length && canApply && opts.initial && !window.SYNC_SAFE_APPLY) {
        let last = 0; try { last = Number(sessionStorage.getItem("sync.reloaded")) || 0; } catch (e) {}
        if (Date.now() - last > 15000) { try { sessionStorage.setItem("sync.reloaded", String(Date.now())); } catch (e) {} location.reload(); }
      }
      return { changed: changed.length };
    }
    throw new Error("sync conflict");
  }
  const sortKeys = o => Object.keys(o).sort().map(k => [k, o[k]]);

  // ページを離れるときに残りを送る
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty && token()) { clearTimeout(timer); syncNow({ keepalive: true }); }
  });

  // ---- ログイン・ログアウト ----
  async function finishLogin(r) {
    const j = await r.json();
    if (!r.ok || !j.token) throw new Error(j.error || "login " + r.status);
    put(K.token, j.token); put(K.user, JSON.stringify(j.user));
    put(K.base, null); put(K.rev, null);      // 初めての同期として足し合わせる
    await syncNow({ apply: "always" });
    emit("ok");
    return j;
  }
  // 端末の記録は残す。clearLocal なら同期する項目も消す（共用の端末向け）
  function forget(clearLocal) {
    [K.token, K.user, K.base, K.rev, K.at].forEach(k => put(k, null));
    if (clearLocal) for (const k of Object.keys(snapshot())) put(k, null);
  }

  window.CholaboSync = {
    enabled: ENABLED,
    googleClientId: GOOGLE_CLIENT_ID,
    devMode: !!DEV_ENDPOINT,
    user, token,
    signedIn: () => !!token(),
    lastSync: () => get(K.at),
    authHeader: () => (token() ? { authorization: "Bearer " + token() } : {}),
    syncNow: () => syncNow({ apply: window.SYNC_SAFE_APPLY ? "always" : undefined }),
    loginWithGoogle: credential => fetch(ENDPOINT + "/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential }) }).then(finishLogin),
    devLogin: sub => fetch(ENDPOINT + "/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub }) }).then(finishLogin),
    logout(clearLocal) { forget(!!clearLocal); emit("signedout"); },
    async me() { const r = await api("GET", "/me"); if (!r.ok) throw new Error("me " + r.status); const j = await r.json(); put(K.user, JSON.stringify(j.user)); return j.user; },
    async saveProfile(profile) { const r = await api("PUT", "/me", JSON.stringify({ profile }), { "content-type": "application/json" }); if (!r.ok) throw new Error("profile " + r.status); const j = await r.json(); const u = user(); if (u) { u.profile = j.profile; put(K.user, JSON.stringify(u)); } return j.profile; },
    async deleteAccount() { const r = await api("DELETE", "/me"); if (!r.ok) throw new Error("delete " + r.status); forget(false); emit("signedout"); },
  };

  // 開いたら取ってくる
  if (ENABLED && token()) syncNow({ initial: true });
})();
