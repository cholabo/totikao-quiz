// 厳選テーマ別（2026-10-23 管理人が命名。旧称 タグ分け・テーマ別）の入口。分野 → 群（登記の種類・民法の編）を並べ、
// 群を押すとその群の代表肢だけを順に出題する（quiz.html?mode=tag&g=…）。
// 代表肢は結論パターンごとに 1 肢。データは build/build_tagmode.js → data/tagmode.json。
// 学習記録は年度順モードと共通（同じ肢を年度順で解いていれば完了に数える）。

const TAGMODE_URL = "data/tagmode.json?v=20261022a";
let learningState = loadLearningState();

fetch(TAGMODE_URL)
  .then(res => {
    if (!res.ok) throw new Error("tagmode.json could not be loaded");
    return res.json();
  })
  .then(render)
  .catch(() => {
    document.getElementById("tag-progress").textContent = "データを読み込めませんでした。";
  });

function countOf(items) {
  const c = { total: items.length, completed: 0, review: 0 };
  items.forEach(label => {
    const r = getResultOf(learningState, label);
    if (r === "correct") c.completed += 1;
    else if (r === "wrong") c.review += 1;
  });
  return c;
}

function render(data) {
  const all = countOf(data.groups.flatMap(g => g.items));
  // 見出しの肢数はデータから（肢が増えても書き直さなくてよいように）
  document.getElementById("tag-count").textContent = all.total.toLocaleString("ja-JP");
  document.getElementById("tag-progress").textContent =
    `全${all.total}問 / 未回答${all.total - all.completed - all.review}問 / 復習${all.review}問 / 完了${all.completed}問`;

  // 続きから（最後に解いていた群と肢）
  const resume = loadTagResume();
  const resumeGroup = resume && data.groups.find(g => g.id === resume.g);
  if (resumeGroup) {
    const btn = document.getElementById("tag-resume");
    btn.textContent = `続きから（${resumeGroup.name}・${resume.label}）`;
    btn.classList.remove("hidden");
    btn.addEventListener("click", () => startTagMode(resumeGroup.id, resume.label));
  }

  const root = document.getElementById("tag-groups");
  const areas = [...new Set(data.groups.map(g => g.area))];
  areas.forEach(area => {
    const groups = data.groups.filter(g => g.area === area);
    const section = document.createElement("section");
    section.className = "topic-panel tagmode-area";
    const h = document.createElement("h2");
    h.className = "topic-panel-title";
    const c = countOf(groups.flatMap(g => g.items));
    h.textContent = `${area}（${c.completed} / ${c.total}）`;
    section.appendChild(h);

    groups.forEach(g => {
      const { total, completed, review } = countOf(g.items);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "topic-row tagmode-row";
      row.innerHTML =
        '<span class="topic-name"></span>' +
        '<span class="topic-bar"><span class="topic-fill"></span><span class="topic-review"></span></span>' +
        '<span class="topic-num"></span>';
      row.querySelector(".topic-name").textContent = g.name;
      row.querySelector(".topic-fill").style.width = Math.round((completed / total) * 100) + "%";
      row.querySelector(".topic-review").style.width = Math.round((review / total) * 100) + "%";
      row.querySelector(".topic-num").textContent = `${completed} / ${total}`;
      row.title = `${g.name}：完了${completed}問・復習${review}問・全${total}問`;
      row.addEventListener("click", () => startTagMode(g.id, firstOpenLabel(g)));
      section.appendChild(row);
    });
    root.appendChild(section);
  });
}

// 群を開いたら、まだ完了していない最初の肢から。全部完了なら先頭から
function firstOpenLabel(group) {
  return group.items.find(label => getResultOf(learningState, label) !== "correct") || group.items[0];
}
