// 解説の「関連法令」欄から飛んでくる資料置き場。
// 準則（法務省訓令）と通達は著作権法13条2号により権利の目的とならないので原文をそのまま置ける。
// 別表は政令の一部だが、e-Gov では項ごとに位置を指定して開けないためここに写している。
let sources = {};
let activeKind = "";

const listEl = document.getElementById("src-list");
const focusEl = document.getElementById("src-focus");
const emptyEl = document.getElementById("src-empty");
const searchEl = document.getElementById("src-search");
const filtersEl = document.getElementById("src-filters");

fetch("sources.json")
  .then(res => res.json())
  .then(data => {
    sources = data;
    buildFilters();
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

function buildFilters() {
  const kinds = [...new Set(entries().map(e => e.kind))].sort();
  const make = (label, value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "src-filter" + (value === activeKind ? " is-on" : "");
    button.textContent = label;
    button.addEventListener("click", () => {
      activeKind = value;
      [...filtersEl.children].forEach(child => child.classList.remove("is-on"));
      button.classList.add("is-on");
      render();
    });
    return button;
  };
  filtersEl.appendChild(make("すべて", ""));
  kinds.forEach(kind => filtersEl.appendChild(make(kind, kind)));
}

function matches(entry, needle) {
  if (!needle) return true;
  const parts = entry.body.map(b => [b.n, b.h, b.t, (b.l || []).join(" ")].filter(Boolean).join(" "));
  const hay = [entry.title, entry.head || "", ...parts].join(" ");
  return hay.toLowerCase().includes(needle);
}

function render() {
  const needle = (searchEl.value || "").trim().toLowerCase();
  const list = entries()
    .filter(e => (!activeKind || e.kind === activeKind) && matches(e, needle))
    .sort((a, b) => a.kind.localeCompare(b.kind, "ja") || a.title.localeCompare(b.title, "ja"));

  listEl.textContent = "";
  list.forEach(entry => listEl.appendChild(card(entry, false)));
  emptyEl.classList.toggle("hidden", list.length > 0);
}

function card(entry, isFocus, highlight) {
  const article = document.createElement("article");
  article.className = "src-card" + (isFocus ? " is-focus" : "");
  article.id = isFocus ? "" : entry.id;

  const head = document.createElement("div");
  head.className = "src-card-head";
  const title = document.createElement("h2");
  title.className = "src-card-title";
  title.textContent = entry.title;
  head.appendChild(title);
  const chip = document.createElement("span");
  chip.className = "src-kind";
  chip.textContent = entry.kind;
  head.appendChild(chip);
  article.appendChild(head);

  if (entry.head) {
    const sub = document.createElement("p");
    sub.className = "src-card-sub";
    sub.textContent = entry.head;
    article.appendChild(sub);
  }

  entry.body.forEach(part => {
    // 通達は見出しの連なりを本文の上に置く
    if (part.h) {
      const heading = document.createElement("p");
      heading.className = "src-heading";
      heading.textContent = part.h;
      article.appendChild(heading);
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
    // 別表の添付情報欄のようにイ・ロ・ハが並ぶものは、行ごとに分けて出す
    (part.l && part.l.length ? part.l : [part.t]).forEach(line => {
      const text = document.createElement("p");
      text.className = "src-text";
      text.textContent = line;
      box.appendChild(text);
    });
    row.appendChild(box);
    article.appendChild(row);
  });

  if (entry.src) {
    const note = document.createElement("p");
    note.className = "src-origin";
    note.textContent = "出典: " + entry.src;
    article.appendChild(note);
  }
  return article;
}

// 解説からは sources.html#<id> の形で飛んでくる。その1件を先頭に出す。
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
  focusEl.appendChild(card({ id, ...sources[id] }, true, highlight));
  focusEl.classList.remove("hidden");
  focusEl.scrollIntoView({ block: "start", behavior: "auto" });
}

searchEl.addEventListener("input", render);
window.addEventListener("hashchange", focusFromHash);
document.getElementById("src-home-btn").addEventListener("click", () => {
  window.location.href = "index.html";
});
