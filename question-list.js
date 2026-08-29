// 年度順モードの入口。年度を開いて、始めたい肢を選ぶ。
// 共通の並び順・学習状態は common.js にある。

let questions = [];
let learningState = loadLearningState();

fetch(QUESTIONS_URL)
  .then(response => {
    if (!response.ok) throw new Error("questions.json could not be loaded");
    return response.json();
  })
  .then(data => {
    questions = sortQuestions(data.filter(question => question.label));
    renderProgress();
    renderQuestionList();
    renderTopicPanel();
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

// 分野は出題を絞るためのものではなく、進み具合を眺めるためのもの。
// 全肢を通しでやる学習なので、ここから出題を分岐させることはしない。
const TOPIC_ORDER = ["民法", "土地", "建物", "区分建物", "総論", "筆界特定", "審査請求", "調査士法"];

function renderTopicPanel() {
  fetch("data/topics.json")
    .then(response => (response.ok ? response.json() : null))
    .then(topics => {
      if (!topics) return;

      const stats = new Map();
      questions.forEach(question => {
        const topic = topics[question.label];
        if (!topic) return;
        if (!stats.has(topic)) stats.set(topic, { total: 0, completed: 0, review: 0 });
        const entry = stats.get(topic);
        entry.total += 1;
        const result = getResult(question);
        if (result === "correct") entry.completed += 1;
        else if (result === "wrong") entry.review += 1;
      });
      if (stats.size === 0) return;

      const rows = document.getElementById("topic-rows");
      const fragment = document.createDocumentFragment();
      const names = TOPIC_ORDER.filter(name => stats.has(name))
        .concat([...stats.keys()].filter(name => !TOPIC_ORDER.includes(name)));

      names.forEach(name => {
        const { total, completed, review } = stats.get(name);
        const percent = total ? Math.round((completed / total) * 100) : 0;

        const row = document.createElement("div");
        row.className = "topic-row";
        row.innerHTML =
          '<span class="topic-name"></span>' +
          '<span class="topic-bar"><span class="topic-fill"></span><span class="topic-review"></span></span>' +
          '<span class="topic-num"></span>';
        row.querySelector(".topic-name").textContent = name;
        row.querySelector(".topic-fill").style.width = percent + "%";
        row.querySelector(".topic-review").style.width =
          (total ? Math.round((review / total) * 100) : 0) + "%";
        row.querySelector(".topic-num").textContent = `${completed} / ${total}`;
        row.title = `${name}：完了${completed}問・復習${review}問・全${total}問`;
        fragment.appendChild(row);
      });

      rows.replaceChildren(fragment);
      document.getElementById("topic-panel").classList.remove("hidden");
    })
    .catch(() => {
      // 分野データが無くても一覧は使える
    });
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

  // いま止まっている位置まで開いて、そこへ寄せる（毎回スクロールして探さなくてよいように）
  const resumeLabel = localStorage.getItem(YEAR_MODE_RESUME_KEY);
  const marker = resumeLabel && list.querySelector(".resume-position");
  if (marker) {
    marker.closest("details").open = true;
    marker.scrollIntoView({ block: "center" });
  }
}

function createQuestionButton(question) {
  const result = getResult(question);
  const statusText = { unanswered: "未回答", correct: "正解済み", wrong: "復習対象" }[result];

  const button = document.createElement("button");
  button.type = "button";
  button.className = `question-link status-${result}`;
  if (question.label === localStorage.getItem(YEAR_MODE_RESUME_KEY)) {
    button.classList.add("resume-position");
  }
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

