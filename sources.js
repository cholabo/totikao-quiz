// 解説の「関連法令」欄から飛んでくる資料置き場。
// 準則（法務省訓令）と通達は著作権法13条2号により権利の目的とならないので原文をそのまま置ける。
// 別表は政令の一部だが、e-Gov では項ごとに位置を指定して開けないためここに写している。
//
// 2026-09-05 一覧を「通達」「別表」の2節に分け、各件は見出しだけを出して押すと本文が開く形に。
// 解説から #<id> で来たときは、その1件を先頭で開いて出す（従来どおり）。
let sources = {};

const listEl = document.getElementById("src-list");
const focusEl = document.getElementById("src-focus");
const emptyEl = document.getElementById("src-empty");
const searchEl = document.getElementById("src-search");

const KIND_ORDER = ["通達", "別表"];
const KIND_LEAD = {
  "通達": "法務省民事局長通達。年代順。",
  "別表": "不動産登記令別表・規則別表・登録免許税法別表。項の順。"
};

fetch("sources.json")
  .then(res => res.json())
  .then(data => {
    sources = data;
    render();
    focusFromHash();
  })
  .catch(() => {
    listEl.textContent = "";
    emptyEl.textContent = "資料を読み込めませんでした。";
    emptyEl.classList.remove("hidden");
  });

function entries() {
  return Object.keys(sources).map(id => ({ id, ...sources[id] }));
}

// 通達は元号年月日で、別表は「令別表 12項」の数字で並べる
function sortKey(e) {
  if (e.kind === "通達") {
    const m = e.title.match(/^(明|大|昭|平|令)(\d+)\.(\d+)\.(\d+)/);
    if (!m) return 9e9;
    const era = { 明: 1867, 大: 1911, 昭: 1925, 平: 1988, 令: 2018 }[m[1]];
    return (era + +m[2]) * 10000 + (+m[3]) * 100 + (+m[4]);
  }
  const grp = /^令別表/.test(e.title) ? 0 : /^規則別表/.test(e.title) ? 1 : 2;
  if (grp === 2) {
    const KAN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15 };
    const k = e.title.match(/（([一二三四五六七八九十]+)）/);
    const sub = e.title.match(/^登録免許税法別表第一\s*(?:（[^）]*）)?\s*([イロハニ])/);
    // イ・ロだけの見出し（十三の項の枝）は 13 として扱う
    const num = k ? KAN[k[1]] || 99 : sub ? 13 : 99;
    return grp * 1e6 + num * 100 + (sub ? "イロハニ".indexOf(sub[1]) + 1 : 0);
  }
  const n = (e.title.match(/(\d+)項/) || [0, 0])[1];
  return grp * 1e6 + (+n) * 100;
}

function matches(entry, needle) {
  if (!needle) return true;
  const parts = entry.body.map(b => [b.n, b.h, b.t, (b.l || []).join(" ")].filter(Boolean).join(" "));
  const hay = [entry.title, entry.head || "", ...parts].join(" ");
  return hay.toLowerCase().includes(needle);
}

function render() {
  const needle = (searchEl.value || "").trim().toLowerCase();
  const list = entries().filter(e => matches(e, needle));
  listEl.textContent = "";
  KIND_ORDER.forEach(kind => {
    const items = list.filter(e => e.kind === kind)
      .sort((a, b) => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title, "ja"));
    if (!items.length) return;
    const sec = document.createElement("section");
    sec.className = "src-section";
    const h = document.createElement("h2");
    h.className = "src-section-title";
    h.textContent = kind;
    const cnt = document.createElement("span");
    cnt.className = "src-section-count";
    cnt.textContent = items.length + "件";
    h.appendChild(cnt);
    sec.appendChild(h);
    if (KIND_LEAD[kind]) {
      const p = document.createElement("p");
      p.className = "src-section-lead";
      p.textContent = KIND_LEAD[kind];
      sec.appendChild(p);
    }
    const box = document.createElement("div");
    box.className = "src-acc";
    // しぼり込み中は当たった件を開いておく
    items.forEach(e => box.appendChild(card(e, false, "", Boolean(needle))));
    sec.appendChild(box);
    listEl.appendChild(sec);
  });
  emptyEl.classList.toggle("hidden", list.length > 0);
}

// 本文。通達の見出し（第1 敷地権 ＞ 敷地権）は変わったときだけ出す
function body(entry, highlight) {
  const frag = document.createDocumentFragment();
  let lastHeading = "";
  entry.body.forEach(part => {
    if (part.h && part.h !== lastHeading) {
      const heading = document.createElement("p");
      heading.className = "src-heading";
      heading.textContent = part.h;
      frag.appendChild(heading);
      lastHeading = part.h;
    }
    const row = document.createElement("div");
    const isHit = Boolean(highlight) && part.n === highlight;
    row.className = "src-row" + (part.sub ? " is-sub" : "") + (isHit ? " is-hit" : "");
    if (part.n) {
      const num = document.createElement("span");
      num.className = "src-num";
      num.textContent = part.n;
      row.appendChild(num);
    }
    const box = document.createElement("div");
    box.className = "src-textbox";
    (part.l && part.l.length ? part.l : [part.t]).forEach(line => {
      const text = document.createElement("p");
      text.className = "src-text";
      text.textContent = line;
      box.appendChild(text);
    });
    row.appendChild(box);
    frag.appendChild(row);
  });
  if (entry.src) {
    const note = document.createElement("p");
    note.className = "src-origin";
    note.textContent = "出典: " + entry.src;
    frag.appendChild(note);
  }
  return frag;
}


// 一覧の見出し。別表は本文の「登記」欄（別表自身の見出し）を件名に借りる。文はこちらで作らない
function shortTitle(entry) {
  const m = entry.title.match(/^(登録免許税法別表第一)\s*(（[一二三四五六七八九十]+）)?\s*([イロハニ])?/);
  // 「イ」「ロ」だけの見出しは（十三）の枝なので、項を補って読めるようにする
  if (m && entry.kind === "別表") return m[1] + "　" + (m[2] || (m[3] ? "（十三）" : "")) + (m[3] || "");
  return entry.title;
}
// 括弧書き（入れ子も）を落とす
function stripParens(t) {
  let prev;
  do { prev = t; t = t.replace(/（[^（）]*）/g, ""); } while (t !== prev);
  return t.trim();
}
function subtitle(entry) {
  if (entry.head) return entry.head;
  if (entry.kind !== "別表") return "";
  if (/^登録免許税法別表第一/.test(entry.title)) {
    return stripParens(entry.title.replace(/^登録免許税法別表第一\s*(（[一二三四五六七八九十]+）)?\s*([イロハニ])?\s*/, ""));
  }
  const row = entry.body.find(b => b.n === "登記");
  if (!row) return "";
  // 括弧書きの除外規定は落として短くする
  return stripParens(row.t || "");
}

function card(entry, isFocus, highlight, open) {
  const article = document.createElement("details");
  article.className = "src-card" + (isFocus ? " is-focus" : "");
  article.id = isFocus ? "" : entry.id;
  article.open = Boolean(isFocus || open);

  const head = document.createElement("summary");
  head.className = "src-card-head";
  const title = document.createElement("span");
  title.className = "src-card-title";
  title.textContent = shortTitle(entry);
  head.appendChild(title);
  const subText = subtitle(entry);
  if (subText) {
    const sub = document.createElement("span");
    sub.className = "src-card-sub";
    sub.textContent = subText;
    head.appendChild(sub);
  }
  article.appendChild(head);

  const inner = document.createElement("div");
  inner.className = "src-card-body";
  inner.appendChild(body(entry, highlight));
  article.appendChild(inner);
  return article;
}

// 解説からは sources.html#<id> の形で飛んでくる。その1件を先頭に開いて出す。
function focusFromHash() {
  const id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  focusEl.textContent = "";
  if (!id || !sources[id]) {
    focusEl.classList.add("hidden");
    return;
  }
  const highlight = new URLSearchParams(location.search).get("p") || "";
  const lead = document.createElement("p");
  lead.className = "src-focus-lead";
  lead.textContent = highlight ? `解説から参照された資料（${highlight}）` : "解説から参照された資料";
  focusEl.appendChild(lead);
  focusEl.appendChild(card({ id, ...sources[id] }, true, highlight, true));
  focusEl.classList.remove("hidden");
  const hit = focusEl.querySelector(".src-row.is-hit");
  (hit || focusEl).scrollIntoView({ block: hit ? "center" : "start", behavior: "auto" });
}

searchEl.addEventListener("input", render);
window.addEventListener("hashchange", focusFromHash);
document.getElementById("src-home-btn").addEventListener("click", () => {
  window.location.href = "index.html";
});
