// 申請書ドリル。data.json（build/build_shinsei.js が作る）を読み、土地／建物 → 事例 の順に出す。
// マスク: 登記の目的・添付情報（ひとまとめ）・申請人（ひとまとめ）・表示欄の各セル（空欄も）。申請日・登記所・代理人・職印はマスクしない（2026-09-13 管理人）。
// スマホ前提: 改行は模範解答にある所だけ。表は列に最小幅を持たせて横スクロール（2026-09-14 管理人）。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const selKind = $('sh-kind'), selIt = $('sh-item'), main = $('sh-main');
  let DATA = { chapters: [], items: [] }, cur = 0;

  const esc = s => String(s == null ? '' : s);
  // 表の列の最小幅は中身から決める: いちばん長い行が 1 行に収まる幅（全角 1 字 = フォント 1 つ分、上限あり）。足りない分は表ごと横スクロール。
  const CAP = { 原因: 250, 登記原因及びその日付: 250, 附属建物: 200, 権利: 200, 備考: 170, 現況: 150, 用途: 150 };
  const textW = s => { let w = 0; for (const ch of String(s)) w += ch.charCodeAt(0) < 0x2000 ? 0.56 : 1; return w; };   // 半角は全角の 0.56 倍として数える（①②③・㎡は全角）
  function colMin(key, rows, px) {
    let w = textW(key) * 0.92;
    for (const r of rows) { const v = fmtCell(key, r[key]); for (const line of String(v == null ? '' : v).split(String.fromCharCode(10))) w = Math.max(w, textW(line)); }
    return Math.min(Math.round(w * px) + 26, CAP[key] || 240) + 'px';
  }
  // 見せ方だけの整形。床面積は答案用紙と同じく階ごとに改行（データは 1 行のまま）。
  const fmtCell = (k, v) => (k === '床面積' || k === '一棟の床面積') && typeof v === 'string' ? v.replace(/ (?=\d+階)/g, '\n') : v;
  // 空欄もマスクする（空けるかどうかが論点）。開くと「空欄」と薄く出る。
  function mask(v, cls) {
    const b = document.createElement('span'); b.setAttribute('role', 'button'); b.tabIndex = 0;
    const empty = v == null || v === '';
    b.className = 'mask' + (empty ? ' empty' : '') + (cls ? ' ' + cls : ''); b.textContent = empty ? '空欄' : esc(v);
    const tog = () => b.classList.toggle('open');
    b.addEventListener('click', tog);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } });
    return b;
  }
  // 欄。k が空なら見出し無しの全幅（申請人の枠の中に「申請人」と書く様式のとき）。
  function row(k, vals, col) {
    const d = document.createElement('div'); d.className = 'sh-row' + (k ? '' : ' full');
    if (k) { const kk = document.createElement('div'); kk.className = 'k'; kk.textContent = k; d.appendChild(kk); }
    const vv = document.createElement('div'); vv.className = 'v' + (col ? ' col' : '');
    for (const v of vals) { if (v == null || v === '') continue; vv.appendChild(typeof v === 'string' ? mask(v) : v); }
    d.appendChild(vv); return d;
  }
  function textLine(parts) {
    const s = document.createElement('span'); s.className = 'sh-line';
    s.textContent = parts.filter(Boolean).join(' ');
    return s;
  }
  const th = (label, key, rows, px) => { const h = document.createElement('th'); h.textContent = label; if (rows) h.style.minWidth = colMin(key || label, rows, px || 13); return h; };
  // 表は横スクロールの箱に入れる（スマホで列を潰さない）
  function scrollWrap(t) { const d = document.createElement('div'); d.className = 'sh-tw'; d.appendChild(t); return d; }
  // 表示欄の表。セルは空欄も含めて全部マスク。
  function table(rows, cols, cap) {
    const t = document.createElement('table');
    if (cap) { const c = document.createElement('caption'); c.textContent = cap; t.appendChild(c); }
    const tr = document.createElement('tr');
    for (const c of cols) tr.appendChild(th(c, c, rows));
    t.appendChild(tr);
    for (const r of rows) {
      const tr2 = document.createElement('tr');
      for (const c of cols) { const td = document.createElement('td'); td.appendChild(mask(fmtCell(c, r[c]))); tr2.appendChild(td); }
      t.appendChild(tr2);
    }
    return scrollWrap(t);
  }
  // 答案用紙と同じ横並びの 1 行表（一棟の建物の表示など）。
  function kvTable(obj, cap) {
    const keys = Object.keys(obj).filter(k => typeof obj[k] === 'string');
    return table([obj], keys, cap);
  }
  const colsOf = rows => { const s = []; for (const r of rows) for (const k of Object.keys(r)) if (!s.includes(k)) s.push(k); return s; };

  // 登記記録。土地と建物が混ざるときは表を分ける。表題登記（記録なし）は出さない。
  function renderRecords(recs, body) {
    const kindOf = r => r.種別 || (r.家屋番号 != null || r.種類 ? '建物' : '土地');
    const groups = [];
    for (const r of recs) { const k = kindOf(r); let g = groups.find(x => x.k === k); if (!g) { g = { k, rows: [] }; groups.push(g); } g.rows.push(r); }
    for (const g of groups) {
      head(body, '現在登記されている事項（' + g.k + '）');
      const cols = colsOf(g.rows).filter(c => c !== '権利' && c !== '種別' && c !== '未登記' && g.rows.some(r => r[c]));
      const t = document.createElement('table'); t.className = 'rec';
      const tr = document.createElement('tr'); for (const c of cols) tr.appendChild(th(c, c, g.rows, 12.5)); t.appendChild(tr);
      for (const r of g.rows) { const tr2 = document.createElement('tr'); for (const c of cols) { const td = document.createElement('td'); td.textContent = esc(fmtCell(c, r[c])); tr2.appendChild(td); } t.appendChild(tr2); }
      body.appendChild(scrollWrap(t));
      // 権利の行。所有者の列と同じ「所有権 ○○」だけなら重ねて出さない
      for (const r of g.rows) { if (!r.権利 || r.権利 === '所有権 ' + (r.所有者 || '')) continue; const p = document.createElement('p'); p.className = 'sh-right'; p.textContent = (g.rows.length > 1 ? (r.地番 || r.家屋番号 || '') + '　' : '') + r.権利; body.appendChild(p); }
    }
  }

  // 事例カード（2026-09-23 新形式）: 現在登記されている事項 → 関係人 → 調査の結果 → 事実 → 依頼。
  // 申請書を埋めるのに要る値は必ずこのどこかにある（住所は関係人、変更後の数値は調査の結果、日付・承諾・持分は事実）。
  function plainTable(rows, cls, px) {
    const cols = colsOf(rows).filter(c => rows.some(r => r[c] != null && r[c] !== ''));
    const t = document.createElement('table'); t.className = cls;
    const tr = document.createElement('tr'); for (const c of cols) tr.appendChild(th(c, c, rows, px || 12.5)); t.appendChild(tr);
    for (const r of rows) { const tr2 = document.createElement('tr'); for (const c of cols) { const td = document.createElement('td'); td.textContent = esc(fmtCell(c, r[c])); tr2.appendChild(td); } t.appendChild(tr2); }
    return scrollWrap(t);
  }
  const head = (body, text) => { const h = document.createElement('div'); h.className = 'sh-rec-h'; h.textContent = text; body.appendChild(h); };

  // 略図（2026-09-23）。申請書例の本の図にならい、土地は平行四辺形、建物は四角、地番・家屋番号と短い注記だけ。前 → 後。
  // 指定: figure = { before: {lands, bldgs}, after: {lands, bldgs}, note }
  //   lands: [{n:'1番1', sub:'宅地 200.00', w:1, style:'new'|'gone'|'unreg', parts:[{n:'(イ)1番1', sub:'100.00', w:1}]}]
  //   bldgs: [{n:'1番1', sub:'居宅', land:[0,1], x:.1, w:.8, style, parts:[{n,sub,w}], dir:'v'|'h'}]
  const NS = 'http://www.w3.org/2000/svg';
  const LW = 78, LH = 64, SK = 12, GAP = 8;
  function el(tag, attrs, text) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; }
  function styleAttr(st) { return st === 'new' ? { stroke: 'var(--seal)', 'stroke-width': 2 } : st === 'gone' ? { stroke: 'currentColor', 'stroke-dasharray': '4 3', opacity: .45 } : st === 'unreg' ? { stroke: 'currentColor', 'stroke-dasharray': '4 3' } : { stroke: 'currentColor', 'stroke-width': 1 }; }
  function drawSide(g, side, ox) {
    const lands = side.lands || [], bl = side.bldgs || [];
    let x = ox; const spans = [];
    for (const L of lands) {
      const w = (L.w || 1) * LW;
      g.appendChild(el('polygon', Object.assign({ points: (x + SK) + ',0 ' + (x + w + SK) + ',0 ' + (x + w) + ',' + LH + ' ' + x + ',' + LH, fill: 'none' }, styleAttr(L.style))));
      spans.push([x, x + w]);
      if (L.parts) {   // 分筆・合併の区画: 破線で分け、区画ごとに符号と数値
        let px = x; const tot = L.parts.reduce((a, p) => a + (p.w || 1), 0);
        L.parts.forEach((P, i) => { const pw = w * (P.w || 1) / tot; if (i) g.appendChild(el('line', { x1: px + SK, y1: 0, x2: px, y2: LH, stroke: 'currentColor', 'stroke-dasharray': '3 3', opacity: .7 }));
          g.appendChild(el('text', { x: px + pw / 2 + SK / 2, y: LH - 18, 'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor' }, P.n || ''));
          if (P.sub) g.appendChild(el('text', { x: px + pw / 2 + SK / 2, y: LH - 6, 'text-anchor': 'middle', 'font-size': 8.5, fill: 'currentColor', opacity: .8 }, P.sub));
          px += pw; });
      } else {
        g.appendChild(el('text', { x: x + 4, y: LH - 5, 'font-size': 10, fill: 'currentColor' }, L.n || ''));
        if (L.sub) g.appendChild(el('text', { x: x + w + SK - 3, y: LH - 5, 'text-anchor': 'end', 'font-size': 8.5, fill: 'currentColor', opacity: .8 }, L.sub));
      }
      x += w + GAP;
    }
    for (const B of bl) {
      const idx = B.land || [0]; const s0 = spans[idx[0]] || [ox, ox + LW], s1 = spans[idx[idx.length - 1]] || s0;
      const span = s1[1] - s0[0]; const bx = s0[0] + SK * 0.6 + span * (B.x != null ? B.x : .15), bw = span * (B.w != null ? B.w : .7);
      const by = B.y != null ? B.y : 6, bh = B.h != null ? B.h : 36;
      g.appendChild(el('rect', Object.assign({ x: bx, y: by, width: bw, height: bh, fill: 'var(--card)' }, styleAttr(B.style))));
      if (B.parts) {   // 区分・合体前の区画
        const tot = B.parts.reduce((a, p) => a + (p.w || 1), 0); let q = 0;
        B.parts.forEach((P, i) => { const f = (P.w || 1) / tot;
          if (B.dir === 'h') { const py = by + bh * q; if (i) g.appendChild(el('line', { x1: bx, y1: py, x2: bx + bw, y2: py, stroke: 'currentColor', 'stroke-dasharray': '3 2' }));
            g.appendChild(el('text', { x: bx + bw / 2, y: py + bh * f / 2 + 3.5, 'text-anchor': 'middle', 'font-size': 9, fill: 'currentColor' }, P.n || '')); }
          else { const px = bx + bw * q; if (i) g.appendChild(el('line', { x1: px, y1: by, x2: px, y2: by + bh, stroke: 'currentColor', 'stroke-dasharray': '3 2' }));
            g.appendChild(el('text', { x: px + bw * f / 2, y: by + bh / 2 - 1, 'text-anchor': 'middle', 'font-size': 9, fill: 'currentColor' }, P.n || ''));
            if (P.sub) g.appendChild(el('text', { x: px + bw * f / 2, y: by + bh / 2 + 10, 'text-anchor': 'middle', 'font-size': 8, fill: 'currentColor', opacity: .8 }, P.sub)); }
          q += f; });
        if (B.n) g.appendChild(el('text', { x: bx + bw / 2, y: by - 1, 'text-anchor': 'middle', 'font-size': 8.5, fill: 'currentColor', opacity: .8 }, B.n));
      } else {
        g.appendChild(el('text', { x: bx + bw / 2, y: by + (B.sub ? bh / 2 - 1 : bh / 2 + 4), 'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor', 'font-weight': B.style === 'new' ? 700 : 400 }, B.n || ''));
        if (B.sub) g.appendChild(el('text', { x: bx + bw / 2, y: by + bh / 2 + 10, 'text-anchor': 'middle', 'font-size': 8.5, fill: 'currentColor', opacity: .8 }, B.sub));
      }
    }
  }
  const sideW = side => (side.lands || []).reduce((a, L) => a + (L.w || 1) * LW + GAP, 0) - GAP + SK;
  function figureSVG(fig) {
    const wb = sideW(fig.before || {}), wa = sideW(fig.after || {}); const AR = 34;
    const W = wb + AR + wa, H = LH + 18;   // 上に 14: 建物の上の見出し（一棟の名など）の分
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sh-fig', role: 'img', 'aria-label': '略図' });
    svg.style.maxWidth = Math.round(W * 1.15) + 'px';
    const g1 = el('g', { transform: 'translate(0,14)' }); drawSide(g1, fig.before || {}, 0); svg.appendChild(g1);
    const ax = wb + 6, ay = LH / 2 + 14;
    svg.appendChild(el('path', { d: 'M' + ax + ',' + ay + ' h' + (AR - 16) + ' m-6,-6 l6,6 l-6,6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));
    const g2 = el('g', { transform: 'translate(' + (wb + AR) + ',14)' }); drawSide(g2, fig.after || {}, 0); svg.appendChild(g2);
    const d = document.createElement('div'); d.className = 'sh-fig-wrap'; d.appendChild(svg);
    if (fig.note) { const p = document.createElement('div'); p.className = 'sh-fig-note'; p.textContent = fig.note; d.appendChild(p); }
    return d;
  }
  function renderScene(it) {
    $('sh-tag').textContent = it.title || it.chapter;
    $('sh-src').textContent = it.year + (it.part ? '　' + it.part : '');
    const body = $('sh-rec-body'); body.innerHTML = '';
    if (it.figure) body.appendChild(figureSVG(it.figure));   // 略図（本の図のように、何が起きるかを先に見せる）
    renderRecords(it.records || [], body);
    // 関係人は表にせず 1 人 1 行（氏名・住所・備考）。スマホで備考が切れないように折り返す
    if ((it.people || []).length) { head(body, '関係人'); for (const p of it.people) { const d = document.createElement('p'); d.className = 'sh-person'; const b = document.createElement('b'); b.textContent = esc(p.氏名); d.appendChild(b); if (p.住所) d.appendChild(document.createTextNode('　' + p.住所)); if (p.備考) { const sm = document.createElement('span'); sm.className = 'sh-note'; sm.textContent = '（' + p.備考 + '）'; d.appendChild(sm); } body.appendChild(d); } }
    for (const sv of it.survey || []) {
      if (!(sv.rows || []).length) continue;
      head(body, '調査の結果' + (sv.title ? '（' + sv.title + '）' : ''));
      body.appendChild(plainTable(sv.rows, 'rec survey'));
    }
    const facts = Array.isArray(it.facts) ? it.facts : (it.facts ? [it.facts] : []);
    const fb = $('sh-facts'); fb.innerHTML = '';
    if (facts.length) { head(fb, '事実'); const ul = document.createElement('ul'); for (const t of facts) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); } fb.appendChild(ul); }
    $('sh-req').textContent = it.request || '';
  }

  // 表示欄。答案用紙の様式に寄せる: 所在（2 行）→ ①地番 ②地目 ③地積 登記原因及びその日付。建物は 所在 → 家屋番号 → 主／附属 ①種類 ②構造 ③床面積 原因。
  function hyojiTable(hy) {
    const kind = hy.kind || '土地';
    const rows = hy.rows || [];
    const wrap = document.createElement('table'); wrap.className = 'hyoji';
    const cap = document.createElement('caption'); cap.textContent = kind + 'の表示'; wrap.appendChild(cap);
    const shozai = [hy.所在 != null ? hy.所在 : (rows[0] ? rows[0].所在 : '')];
    for (const r of rows.slice(1)) if (r.所在 && r.所在 !== shozai[0]) shozai.push(r.所在);
    if (hy.所在変更後) shozai.push(hy.所在変更後);
    if (shozai.length < 2) shozai.push('');
    const perRowPlace = kind === '建物' && rows.some(r => r.地番 || r.所在 || r.家屋番号);   // 合体・分割など、建物ごとに所在・家屋番号を書く様式
    let cols;
    if (kind === '土地') cols = [['地番', '①地番'], ['地目', '②地目'], ['地積', '③地積 ㎡'], ['原因', '登記原因及びその日付']];
    else {
      cols = [];
      if (perRowPlace) { if (rows.some(r => r.所在)) cols.push(['所在', '所在']); if (rows.some(r => r.地番)) cols.push(['地番', '地番']); cols.push(['家屋番号', '家屋番号']); }
      cols.push(['区分', '主・附属'], ['種類', '①種類'], ['構造', '②構造'], ['床面積', '③床面積 ㎡'], ['原因', '登記原因及びその日付']);
    }
    const extra = colsOf(rows).filter(k => !cols.some(c => c[0] === k) && !['所在', '地番', '家屋番号'].includes(k));
    for (const k of extra) cols.push([k, k]);
    const span = cols.length - 1;
    if (!perRowPlace || hy.所在 != null) for (const sz of (perRowPlace ? [shozai[0]] : shozai)) { const tr = document.createElement('tr'); const h = document.createElement('th'); h.textContent = '所在'; const td = document.createElement('td'); td.colSpan = span; td.appendChild(mask(sz)); if (hy.所在原因 && sz === shozai[1]) td.appendChild(mask(hy.所在原因)); tr.append(h, td); wrap.appendChild(tr); }
    if (kind === '建物' && !perRowPlace) { const tr = document.createElement('tr'); const h = document.createElement('th'); h.textContent = '家屋番号'; const td = document.createElement('td'); td.colSpan = span; td.appendChild(mask(hy.家屋番号 != null ? hy.家屋番号 : (rows[0] ? rows[0].家屋番号 : ''))); tr.append(h, td); wrap.appendChild(tr); }
    const trh = document.createElement('tr'); for (const [k, label] of cols) trh.appendChild(th(label, k, rows)); wrap.appendChild(trh);
    const n = Math.max(rows.length, 3);
    for (let i = 0; i < n; i++) { const r = rows[i] || {}; const tr = document.createElement('tr'); for (const [k] of cols) { const td = document.createElement('td'); td.appendChild(mask(fmtCell(k, r[k]))); tr.appendChild(td); } wrap.appendChild(tr); }
    if (hy.備考 != null) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = cols.length; td.appendChild(mask(hy.備考)); tr.appendChild(td); wrap.appendChild(tr); }   // 地役権設定の範囲など、表の最下段
    return scrollWrap(wrap);
  }

  function renderForm(fm) {
    const f = document.createElement('div'); f.className = 'sh-form';
    const h = document.createElement('h2'); h.textContent = '登記申請書'; f.appendChild(h);
    const goals = Array.isArray(fm.目的) ? fm.目的 : [fm.目的];
    f.appendChild(row('登記の目的', goals, true));
    f.appendChild(row('添付情報', [mask((fm.添付情報 || []).join('\n'), 'block')], true));   // ひとまとめに 1 つのマスク
    // 申請日・登記所はマスクしない
    const ap0 = document.createElement('p'); ap0.className = 'sh-apply'; ap0.textContent = (fm.申請日 ? fm.申請日 + '申請　' : '') + (fm.登記所 || ''); f.appendChild(ap0);
    // 申請人はまとめて 1 つの枠にマスク。改行と字下げは模範解答のまま（折り返さず横スクロール）。
    const lines = [];
    if (Array.isArray(fm.申請人欄) && fm.申請人欄.length) lines.push(...fm.申請人欄);   // 模範解答の枠の中をそのまま（検証済みの事例）
    else for (const p of fm.申請人 || []) {
      lines.push([p.肩書, p.住所, p.持分, p.氏名].filter(Boolean).join(' '));
      if (p.会社法人等番号) lines.push('（会社法人等番号 ' + p.会社法人等番号 + '）');
      if (p.代表者) lines.push(p.代表者);
    }
    // 枠の中に「申請人」と書く様式（代位・相続人申請）は左の見出しを出さない（二重に出さない）。
    // 行が長いときは見出しを枠の上に置いて枠を全幅にする（スマホで名前が切れないように）。
    const inBox = lines.some(l => l.includes('申請人'));
    const long = Math.max(0, ...lines.map(textW)) > 16;
    const box = mask(lines.join('\n'), 'block pre');
    if (inBox) f.appendChild(row('', [box], true));
    else if (long) { const cap = document.createElement('div'); cap.className = 'sh-cap'; cap.textContent = '申請人'; f.appendChild(cap); f.appendChild(row('', [box], true)); }
    else f.appendChild(row('申請人', [box], true));
    // 代理人はマスクしない
    if (fm.代理人) f.appendChild(row('代理人', [textLine([fm.代理人.住所, fm.代理人.氏名 + ' ㊞']), fm.代理人.電話 ? textLine(['（連絡先 ' + fm.代理人.電話 + '）']) : null], true));
    // 様式に無い欄（登録免許税、被相続人、代位原因など）はマスクして出す
    const KNOWN = ['title', 'chapter', '目的', '添付情報', '申請日', '登記所', '申請人', '申請人欄', '代理人', '表示', 'kind', 'verified', 'facts', 'request', 'records', 'people', 'survey', 'figure', 'skip', '所有者', '欄名'];
    const after = [];   // 表示欄のあとに置くもの（合体の特定事項・所有権保存の登記など、答案用紙で表示欄の下にある欄）
    for (const [k, v] of Object.entries(fm)) {
      if (KNOWN.includes(k)) continue;
      const label = (fm.欄名 || {})[k] || k;
      if (typeof v === 'string' && v) f.appendChild(row(label, [v]));
      else if (Array.isArray(v) && v.every(x => typeof x === 'string')) f.appendChild(row(label, v, true));
      else if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object')) after.push(() => { const sec = document.createElement('div'); sec.className = 'sh-section'; sec.textContent = label; f.appendChild(sec); f.appendChild(table(v, colsOf(v))); });   // 合体: 所有権登記特定事項・存続登記特定事項（模範解答の後半）
      else if (v && typeof v === 'object') after.push(() => { const sec = document.createElement('div'); sec.className = 'sh-section'; sec.textContent = label; f.appendChild(sec); for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'string') f.appendChild(row(k2 === '根拠' ? '' : k2, [v2], true)); });   // 所有権保存の登記（根拠・課税価格・登録免許税）
    }
    const hy = fm.表示 || {};
    if (hy.kind === '土地' || hy.kind === '建物') f.appendChild(hyojiTable(hy));
    else {   // 区分建物: 各表示を枠つきで順に
      const sec = document.createElement('div'); sec.className = 'sh-section'; sec.textContent = (hy.kind || '') + 'の表示'; f.appendChild(sec);
      const top = {}; for (const [k, v] of Object.entries(hy)) if (typeof v === 'string' && k !== 'kind') top[k] = v;
      if (Object.keys(top).length) f.appendChild(kvTable(top));
      for (const [k, v] of Object.entries(hy)) {
        if (k === 'kind' || typeof v === 'string') continue;
        if (Array.isArray(v)) { f.appendChild(table(v, colsOf(v), k === 'rows' ? '' : k)); continue; }
        if (v && typeof v === 'object') {
          const strs = {}; for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'string') strs[k2] = v2;
          if (Object.keys(strs).length) f.appendChild(kvTable(strs, k));
          for (const [k2, v2] of Object.entries(v)) if (Array.isArray(v2)) f.appendChild(table(v2, colsOf(v2), Object.keys(strs).length ? '' : k));
        }
      }
    }
    for (const fn of after) fn();
    if (fm.代理人) { const foot = document.createElement('div'); foot.className = 'sh-sign'; foot.textContent = '土地家屋調査士　' + fm.代理人.氏名 + '　職印'; f.appendChild(foot); }
    return f;
  }

  // 修正の報告（2026-09-24 管理人）。報告先は過去問ノート・出題画面と同じ。questionId は「shinsei:<事例id>」
  const FEEDBACK = 'https://script.google.com/macros/s/AKfycbykTsPoM-VFHtSWZUmS-TTqZyi7gtJd637B94mw5i_rDgeNtd6_XCRLLTQQ7Z6Fj_x9/exec';
  function renderReport(it) {
    const d = document.createElement('details'); d.className = 'sh-rep';
    const sm = document.createElement('summary'); sm.textContent = 'この事例の誤りを報告'; d.appendChild(sm);
    const f = document.createElement('form');
    const ta = document.createElement('textarea'); ta.name = 'c'; ta.maxLength = 500; ta.rows = 3; ta.placeholder = 'どの欄が、どう違うか（模範解答や条文があれば）';
    const b = document.createElement('button'); b.type = 'submit'; b.textContent = '送る';
    const st = document.createElement('span'); st.className = 'st';
    f.append(ta, b, st); d.appendChild(f);
    f.addEventListener('submit', async e => {
      e.preventDefault(); const c = ta.value.trim(); if (!c) { st.textContent = '内容を書いてください'; return; }
      b.disabled = true; st.textContent = '送信中…';
      try { await fetch(FEEDBACK, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ questionId: 'shinsei:' + it.id, comment: c.slice(0, 500) }) }); st.textContent = '報告しました。ありがとうございます。'; ta.value = ''; }
      catch (err) { st.textContent = '送信できませんでした'; b.disabled = false; }
    });
    return d;
  }
  function fillItems(kind) {
    selIt.innerHTML = '';
    DATA.items.forEach((it, i) => {
      if (it.kind !== kind) return;
      const o = document.createElement('option'); o.value = String(i); o.textContent = it.year + (it.part ? '-' + it.part.split('/')[0] : '') + '　' + it.chapter; selIt.appendChild(o);
    });
  }
  function show(i) {
    if (!DATA.items.length) { main.innerHTML = '<p class="sh-empty">まだ事例がありません。</p>'; return; }
    cur = Math.max(0, Math.min(DATA.items.length - 1, i));
    const it = DATA.items[cur];
    renderScene(it); main.innerHTML = '';
    for (const fm of it.forms || []) main.appendChild(renderForm(fm));
    main.appendChild(renderReport(it));
    // 書き方の要点は出さない（2026-09-13 管理人: 様式と模範解答だけを見せる）
    selKind.value = it.kind; fillItems(it.kind); selIt.value = String(cur);
    try { localStorage.setItem('shinsei.cur', it.id); } catch (e) { /* 使えない環境でも動く */ }
    window.scrollTo(0, 0);
  }
  function init() {
    for (const k of ['土地', '建物']) { const n = DATA.items.filter(it => it.kind === k).length; if (!n) continue; const o = document.createElement('option'); o.value = k; o.textContent = k + '（' + n + '）'; selKind.appendChild(o); }
    selKind.addEventListener('change', () => { const i = DATA.items.findIndex(it => it.kind === selKind.value); if (i >= 0) show(i); });
    selIt.addEventListener('change', () => show(parseInt(selIt.value, 10)));
    let start = 0;
    let want = new URLSearchParams(location.search).get('id');
    if (!want) { try { want = localStorage.getItem('shinsei.cur'); } catch (e) { /* 無ければ先頭 */ } }
    if (want) { const i = DATA.items.findIndex(it => it.id === want); if (i >= 0) start = i; }
    show(start);
  }
  fetch('data.json?v=' + Date.now()).then(r => r.json()).then(d => { DATA = d; init(); }).catch(() => { main.innerHTML = '<p class="sh-empty">データを読めませんでした。</p>'; });
})();
