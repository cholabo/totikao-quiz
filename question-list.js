// 年度順モードの入口。年度を開いて、始めたい肢を選ぶ。
// 共通の並び順・学習状態は common.js にある。

let questions = [];
let learningState = loadLearningState();
const bookmarks = loadBookmarks();   // ☆ の肢は一覧で枠と★（2026-10-23）

fetch(QUESTIONS_URL)
  .then(response => {
    if (!response.ok) throw new Error("questions.json could not be loaded");
    return response.json();
  })
  .then(data => {
    questions = sortQuestions(data.filter(question => question.label));
    renderProgress();
    // 分野別・登記の種類・問われ方の進み具合の欄は 2026-10-22 に外した（管理人「いらない」。分けて解くのはタグ分けモード）
    renderQuestionList();
  })
  .catch(() => {
    document.getElementById("list-progress-info").textContent = "進捗を読み込めませんでした。";
    document.getElementById("question-list").innerHTML =
      '<p class="list-error">問題データを読み込めませんでした。トップに戻って、もう一度お試しください。</p>';
  });

function getResult(question) {
  return getResultOf(learningState, question.label);
}

function renderProgress() {
  const p = summarizeProgress(questions, learningState);
  const pass = getPassCount();
  document.getElementById("list-progress-info").textContent =
    (pass > 0 ? `${pass}周完了｜` : "")
    + `全${p.total}問 / 未回答${p.unanswered}問 / 復習${p.review}問 / 完了${p.completed}問`;
}

function renderQuestionList() {
  const list = document.getElementById("question-list");
  const years = groupBy(questions, question => question.year || extractYear(question.label));
  const fragment = document.createDocumentFragment();

  years.forEach((yearQuestions, year) => {
    const details = document.createElement("details");
    details.className = "year-section";

    const correctCount = yearQuestions.filter(question => getResult(question) === "correct").length;
    const summary = document.createElement("summary");
    summary.append(document.createTextNode(formatYear(year)));

    const count = document.createElement("span");
    count.className = "year-summary-count";
    count.textContent = `正解済み ${correctCount} / ${yearQuestions.length}`;
    summary.appendChild(count);
    details.appendChild(summary);

    const grid = document.createElement("div");
    grid.className = "question-grid";
    const questionGroups = groupBy(yearQuestions, question => Number(question.questionNo || extractQuestionNo(question.label)));

    questionGroups.forEach((items, questionNo) => {
      const group = document.createElement("section");
      group.className = "question-group";

      const title = document.createElement("div");
      title.className = "question-group-title";
      title.textContent = `問${questionNo}`;
      group.appendChild(title);

      const choices = document.createElement("div");
      choices.className = "choice-list";
      items.forEach(question => choices.appendChild(createQuestionButton(question)));
      group.appendChild(choices);
      grid.appendChild(group);
    });

    details.appendChild(grid);
    fragment.appendChild(details);
  });

  list.replaceChildren(fragment);
  renderReadingSection(list);

  // いま止まっている位置まで開いて、そこへ寄せる（毎回スクロールして探さなくてよいように）
  const resumeLabel = localStorage.getItem(YEAR_MODE_RESUME_KEY);
  const marker = resumeLabel && list.querySelector(".resume-position");
  if (marker) {
    marker.closest("details").open = true;
    marker.scrollIntoView({ block: "center" });
  }
}

// ◯✕に組み替えていない問（流れ図・空欄補充の組合せ）。出題には使わず、年度の一番下で読めるだけにする。
// data/reading.json に原文・図・選択肢・正解を置いてある。
function renderReadingSection(list) {
  fetch("data/reading.json")
    .then(response => (response.ok ? response.json() : []))
    .then(items => {
      if (!Array.isArray(items) || items.length === 0) return;
      const details = document.createElement("details");
      details.className = "year-section reading-section";
      const summary = document.createElement("summary");
      summary.append(document.createTextNode("◯✕にしていない問（読むだけ）"));
      const count = document.createElement("span");
      count.className = "year-summary-count";
      count.textContent = `${items.length}問・出題されません`;
      summary.appendChild(count);
      details.appendChild(summary);

      // 一覧には問のリンクだけを置き、中身は reading.html で読む
      const ul = document.createElement("ul");
      ul.className = "reading-list";
      items.forEach(item => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "reading.html?q=" + encodeURIComponent(item.label);
        a.textContent = `${item.label}　${item.title || ""}`;
        li.appendChild(a);
        ul.appendChild(li);
      });
      details.appendChild(ul);
      list.appendChild(details);
    })
    .catch(() => {});
}

function createQuestionButton(question) {
  const result = getResult(question);
  const statusText = { unanswered: "未回答", correct: "正解済み", wrong: "復習対象" }[result] + (bookmarks.has(question.label) ? "・ブックマーク" : "");

  const button = document.createElement("button");
  button.type = "button";
  button.className = `question-link status-${result}`;
  if (question.label === localStorage.getItem(YEAR_MODE_RESUME_KEY)) {
    button.classList.add("resume-position");
  }
  if (bookmarks.has(question.label)) button.classList.add("is-bookmarked");
  button.textContent = question.choice || extractChoice(question.label) || question.label;
  button.title = `${question.label}（${statusText}）から始める`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => startYearMode(question.label));
  return button;
}

function groupBy(items, getKey) {
  const grouped = new Map();
  items.forEach(item => {
    const key = getKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });
  return grouped;
}
