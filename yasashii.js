// やさしい版（2026-11-10）: 厳選テーマ別の各群を、初学者が 1 周目に流して読めるように書き直したもの。
// yasashii.html は群の一覧、yasashii.html?g=g27&i=0 はその群の i 番目の肢を読む画面。
// データは build/yasashii.py app → data/yasashii/（index.json・gNN.json・glossary.json）。文の中の 〔語〕 が用語の小窓。
// 記録は「どこまで読んだか」だけ（localStorage。正誤・ブックマーク・復習は付けない。管理人 11/10）。

const YS_DATA = "data/yasashii/";
const YS_V = "?v=20261110a";
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても読める */ } },
};
const readOf = () => store.get("yasashii.read", {});           // { 群 id: [読んだ肢の label …] }
const params = new URLSearchParams(location.search);
let GL = { alias: {}, entries: {} };

const getJSON = name => fetch(YS_DATA + name + YS_V).then(r => { if (!r.ok) throw new Error(name); return r.json(); });

Promise.all([getJSON("index.json"), getJSON("glossary.json")])
  .then(([index, gl]) => {
    GL = gl;
    if (params.get("g")) openGroup(index, params.get("g"), Number(params.get("i") || 0));
    else renderList(index);
  })
  .catch(() => {
    document.getElementById("ys-list").classList.remove("hidden");
    document.getElementById("ys-progress").textContent = "データを読み込めませんでした。";
  });

// ---- 群の一覧 ----
function renderList(index) {
  document.getElementById("ys-list").classList.remove("hidden");
  const read = readOf();
  const total = index.groups.reduce((s, g) => s + g.n, 0);
  const done = index.groups.reduce((s, g) => s + Math.min((read[g.id] || []).length, g.n), 0);
  document.getElementById("ys-count").textContent = total.toLocaleString("ja-JP");
  document.getElementById("ys-progress").textContent = `全${total}肢 / 読んだ${done}肢`;

  const pos = store.get("yasashii.pos", null);
  const pg = pos && index.groups.find(g => g.id === pos.g);
  if (pg) {
    const btn = document.getElementById("ys-resume");
    btn.textContent = `続きから（${pg.name}・${pos.i + 1}肢目）`;
    btn.classList.remove("hidden");
    btn.addEventListener("click", () => go(pg.id, pos.i));
  }

  const root = document.getElementById("ys-groups");
  [...new Set(index.groups.map(g => g.area))].forEach(area => {
    const groups = index.groups.filter(g => g.area === area);
    const section = document.createElement("section");
    section.className = "topic-panel tagmode-area";
    const h = document.createElement("h2");
    h.className = "topic-panel-title";
    const n = groups.reduce((s, g) => s + g.n, 0);
    const d = groups.reduce((s, g) => s + Math.min((read[g.id] || []).length, g.n), 0);
    h.textContent = `${area}（${d} / ${n}）`;
    section.appendChild(h);
    groups.forEach(g => {
      const r = Math.min((read[g.id] || []).length, g.n);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "topic-row tagmode-row";
      row.innerHTML = '<span class="topic-name"></span><span class="topic-bar"><span class="topic-fill"></span></span><span class="topic-num"></span>';
      row.querySelector(".topic-name").textContent = g.name;
      row.querySelector(".topic-fill").style.width = Math.round((r / g.n) * 100) + "%";
      row.querySelector(".topic-num").textContent = `${r} / ${g.n}`;
      row.addEventListener("click", () => go(g.id, 0));
      section.appendChild(row);
    });
    root.appendChild(section);
  });
}

function go(gid, i) { location.href = `yasashii.html?g=${encodeURIComponent(gid)}&i=${i}`; }

// ---- 読む画面 ----
function openGroup(index, gid, i) {
  const meta = index.groups.find(g => g.id === gid);
  if (!meta) { location.href = "yasashii.html"; return; }
  document.getElementById("ys-read").classList.remove("hidden");
  document.getElementById("ys-back").addEventListener("click", () => { location.href = "yasashii.html"; });
  getJSON(gid + ".json").then(group => {
    document.getElementById("ys-group").textContent = `${group.area} › ${group.name}`;
    const next = index.groups[index.groups.indexOf(meta) + 1];
    if (i >= group.items.length) showEnd(group, next);
    else showItem(group, i);
  });
}

function showItem(group, i) {
  const it = group.items[i];
  store.set("yasashii.pos", { g: group.id, i });
  document.getElementById("ys-pos").textContent = `${i + 1} / ${group.items.length}`;
  fillTerms(document.getElementById("ys-q"), it.q);
  const answer = document.getElementById("ys-answer");
  document.querySelectorAll("#ys-choices .choice").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#ys-choices .choice").forEach(b => {
      b.disabled = true;
      if (b.dataset.choice === it.ans) b.classList.add("is-answer");
      else if (b === btn) b.classList.add("is-miss");
    });
    fillTerms(document.getElementById("ys-a"), it.a);
    const map = document.getElementById("ys-map");
    if (it.map) { map.textContent = "元の問題との対応: " + it.map; map.classList.remove("hidden"); }
    const oc = document.getElementById("ys-oc");
    if (it.oc) { markKiku(oc, it.oc, it.kiku); oc.classList.remove("hidden"); }
    markKiku(document.getElementById("ys-ot"), it.ot, it.kiku);
    document.getElementById("ys-exp-link").href = "quiz.html?start=" + encodeURIComponent(it.label);
    answer.classList.remove("hidden");
    const read = readOf();
    read[group.id] = [...new Set([...(read[group.id] || []), it.label])];
    store.set("yasashii.read", read);
    const nx = document.getElementById("ys-next");
    nx.textContent = i + 1 < group.items.length ? "次へ" : "このテーマのまとめへ";
    nx.classList.remove("hidden");
    nx.onclick = () => go(group.id, i + 1);
  }, { once: true }));
}

function showEnd(group, next) {
  document.getElementById("ys-item").classList.add("hidden");
  document.getElementById("ys-pos").textContent = "まとめ";
  const tb = document.getElementById("ys-pairs");
  group.pairs.forEach(([k, v]) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th"); th.textContent = k;
    const td = document.createElement("td"); td.textContent = v;
    tr.append(th, td); tb.appendChild(tr);
  });
  const btn = document.getElementById("ys-next-group");
  if (next) { btn.textContent = `次のテーマへ（${next.name}）`; btn.onclick = () => go(next.id, 0); }
  else { btn.textContent = "テーマの一覧へ"; btn.onclick = () => { location.href = "yasashii.html"; }; }
  document.getElementById("ys-end").classList.remove("hidden");
  store.set("yasashii.pos", next ? { g: next.id, i: 0 } : null);
}

// 〔語〕 を小窓のボタンに。用語集に無い語はそのまま文字で出す
function fillTerms(el, text) {
  el.textContent = "";
  text.split(/(〔[^〕]+〕)/).forEach(part => {
    const m = part.match(/^〔([^〕]+)〕$/);
    const id = m && GL.alias[m[1]];
    if (!id) { el.appendChild(document.createTextNode(m ? m[1] : part)); return; }
    const b = document.createElement("button");
    b.type = "button"; b.className = "ys-term"; b.textContent = m[1];
    b.addEventListener("click", ev => { ev.stopPropagation(); openPop(b, GL.entries[id]); });
    el.appendChild(b);
  });
}

// 元の問題の中の効く語に印を付ける（「…」で離れた 2 か所は別々に）
function markKiku(el, text, kiku) {
  el.textContent = "";
  const parts = (kiku || []).flatMap(k => k.split("…")).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!parts.length) { el.textContent = text; return; }
  const rx = new RegExp("(" + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")");
  text.split(rx).forEach(s => {
    if (parts.includes(s)) { const mk = document.createElement("mark"); mk.className = "ys-kiku"; mk.textContent = s; el.appendChild(mk); }
    else el.appendChild(document.createTextNode(s));
  });
}

// ---- 用語の小窓 ----
const pop = document.getElementById("ys-pop");
function openPop(anchor, e) {
  document.getElementById("ys-pop-t").textContent = e.t;
  document.getElementById("ys-pop-m").textContent = e.m;
  const ex = document.getElementById("ys-pop-e");
  ex.textContent = e.e ? "例: " + e.e : "";
  ex.classList.toggle("hidden", !e.e);
  pop.classList.remove("hidden");
  const r = anchor.getBoundingClientRect();
  const w = Math.min(360, document.documentElement.clientWidth - 24);
  pop.style.width = w + "px";
  pop.style.left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - w - 12)) + "px";
  pop.style.top = (r.bottom + window.scrollY + 6) + "px";
}
function closePop() { pop.classList.add("hidden"); }
document.getElementById("ys-pop-close").addEventListener("click", closePop);
document.addEventListener("click", ev => { if (!pop.contains(ev.target)) closePop(); });
document.addEventListener("keydown", ev => { if (ev.key === "Escape") closePop(); });
