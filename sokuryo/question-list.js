// 年度順モードの入口。年度を開いて、始めたい肢を選ぶ（調査士 app/question-list.js と同じ形）。
// 並び順・学習状態・startYearMode は sokuryo.js にある。

"use strict";

(function () {
  let questions = [];
  const learningState = loadLearningState();
  const resumeLabel = skGet(SK_YEAR_RESUME_KEY);

  loadQuestions()
    .then(data => {
      questions = data;   // 年度 → 問番号 → 肢（questions.json の id 順）に並べ済み
      renderProgress();
      renderQuestionList();
    })
    .catch(() => {
      document.getElementById("list-progress-info").textContent = "進捗を読み込めませんでした。";
      document.getElementById("question-list").innerHTML =
        '<p class="list-error">問題データを読み込めませんでした。トップに戻って、もう一度お試しください。</p>';
    });

  function getResult(q) {
    return getResultOf(learningState, q.label);
  }

  function renderProgress() {
    const p = summarize(questions, learningState);
    const pass = getPassCount();
    document.getElementById("list-progress-info").textContent =
      (pass > 0 ? `${pass}周完了｜` : "")
      + `全${p.total}肢 / 未回答${p.unanswered}肢 / 復習${p.review}肢 / 完了${p.completed}肢`;
  }

  function renderQuestionList() {
    const list = document.getElementById("question-list");
    const years = groupBy(questions, q => q.year);
    const fragment = document.createDocumentFragment();

    years.forEach((yearQuestions, year) => {
      const details = document.createElement("details");
      details.className = "year-section";

      const correctCount = yearQuestions.filter(q => getResult(q) === "correct").length;
      const summary = document.createElement("summary");
      summary.append(document.createTextNode(formatYear(year)));

      const count = document.createElement("span");
      count.className = "year-summary-count";
      count.textContent = `完了 ${correctCount} / ${yearQuestions.length}`;
      summary.appendChild(count);
      details.appendChild(summary);

      const grid = document.createElement("div");
      grid.className = "question-grid";
      const questionGroups = groupBy(yearQuestions, q => Number(q.questionNo));

      questionGroups.forEach((items, questionNo) => {
        const group = document.createElement("section");
        group.className = "question-group";

        const title = document.createElement("div");
        title.className = "question-group-title";
        title.textContent = `問${questionNo}`;
        group.appendChild(title);

        const choices = document.createElement("div");
        choices.className = "choice-list";
        items.forEach(q => choices.appendChild(createQuestionButton(q)));
        group.appendChild(choices);
        grid.appendChild(group);
      });

      details.appendChild(grid);
      fragment.appendChild(details);
    });

    list.replaceChildren(fragment);

    // いま止まっている位置まで開いて、そこへ寄せる（毎回スクロールして探さなくてよいように）
    const marker = resumeLabel && list.querySelector(".resume-position");
    if (marker) {
      marker.closest("details").open = true;
      marker.scrollIntoView({ block: "center" });
    }
  }

  // 肢ボタンの文字。ふつうの肢は肢記号（a・1 など）、穴埋め由来の肢は disp の括弧の中（「穴埋め・ウ」）。
  // 穴埋め由来の ✕ 肢は label の末尾に答えの「✕」が付いているので、label は画面に出さない
  function buttonText(q) {
    if (q.disp) {
      const m = String(q.disp).match(/（(.+)）/);
      return m ? m[1] : q.disp;
    }
    return q.choice || String(q.label).split("-")[2] || q.label;
  }

  function createQuestionButton(q) {
    const result = getResult(q);
    const statusText = { unanswered: "未回答", correct: "完了", wrong: "復習対象" }[result];

    const button = document.createElement("button");
    button.type = "button";
    button.className = `question-link status-${result}`;
    if (q.label === resumeLabel) button.classList.add("resume-position");
    button.textContent = buttonText(q);
    button.title = `${dispName(q)}（${statusText}）から始める`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => startYearMode(q.label));
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
})();
