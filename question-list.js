const LEARNING_STATE_KEY = "learningStateByLabel";
const YEAR_MODE_START_KEY = "yearModeStartLabel";
const YEAR_MODE_RESUME_KEY = "yearModeResumeLabel";

let questions = [];
let learningState = loadLearningState();

fetch("questions.json", { cache: "no-store" })
  .then(response => {
    if (!response.ok) throw new Error("questions.json could not be loaded");
    return response.json();
  })
  .then(data => {
    questions = data.filter(question => question.label).sort(compareQuestions);
    renderProgress();
    renderResumeAction();
    renderQuestionList();
  })
  .catch(() => {
    document.getElementById("list-progress-info").textContent = "進捗を読み込めませんでした。";
    document.getElementById("question-list").innerHTML =
      '<p class="list-error">問題データを読み込めませんでした。トップに戻って、もう一度お試しください。</p>';
  });

function loadLearningState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEARNING_STATE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getResult(question) {
  const result = learningState[question.label]?.lastResult;
  return result === "unknown" ? "wrong" : result || "unanswered";
}

function renderProgress() {
  const results = questions.map(getResult);
  const total = questions.length;
  const unanswered = results.filter(result => result === "unanswered").length;
  const review = results.filter(result => result === "wrong" || result === "unknown").length;
  const completed = results.filter(result => result === "correct").length;

  document.getElementById("list-progress-info").textContent =
    `全${total}問 / 未回答${unanswered}問 / 復習${review}問 / 完了${completed}問`;
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
}

function createQuestionButton(question) {
  const result = getResult(question);
  const statusText = {
    unanswered: "未回答",
    correct: "正解済み",
    wrong: "復習対象",
    unknown: "復習対象"
  }[result];

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

function startYearMode(label) {
  localStorage.setItem("quizMode", "year");
  if (label) {
    localStorage.setItem(YEAR_MODE_START_KEY, label);
    localStorage.setItem(YEAR_MODE_RESUME_KEY, label);
  } else {
    localStorage.removeItem(YEAR_MODE_START_KEY);
  }
  window.location.href = "quiz.html";
}

function renderResumeAction() {
  const button = document.getElementById("list-resume-btn");
  const resumeLabel = localStorage.getItem(YEAR_MODE_RESUME_KEY);
  const resumeExists = questions.some(question => question.label === resumeLabel);

  if (!resumeExists) {
    if (resumeLabel) localStorage.removeItem(YEAR_MODE_RESUME_KEY);
    button.classList.add("hidden");
    return;
  }

  button.textContent = `続きから（${resumeLabel}）`;
  button.classList.remove("hidden");
  button.addEventListener("click", () => startYearMode(resumeLabel), { once: true });
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

function compareQuestions(a, b) {
  const yearDifference = getYearOrder(a.year || a.label) - getYearOrder(b.year || b.label);
  if (yearDifference !== 0) return yearDifference;

  const questionDifference =
    Number(a.questionNo || extractQuestionNo(a.label)) - Number(b.questionNo || extractQuestionNo(b.label));
  if (questionDifference !== 0) return questionDifference;

  const choiceDifference = getChoiceOrder(a.choice || extractChoice(a.label)) -
    getChoiceOrder(b.choice || extractChoice(b.label));
  return choiceDifference || a.label.localeCompare(b.label, "ja");
}

function getYearOrder(value) {
  const text = String(value || "");
  const heisei = text.match(/H(\d+)/i);
  if (heisei) return Number(heisei[1]);
  const reiwa = text.match(/R(\d+)/i);
  if (reiwa) return 100 + Number(reiwa[1]);
  return 999;
}

function extractYear(label) {
  return String(label || "").split("-")[0];
}

function extractQuestionNo(label) {
  const match = String(label || "").match(/^[HR]\d+-(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function extractChoice(label) {
  return String(label || "").split("-")[2] || "";
}

function getChoiceOrder(choice) {
  const order = ["ア", "イ", "ウ", "エ", "オ", "1", "2", "3", "4", "5", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  const index = order.indexOf(String(choice || "").trim());
  return index >= 0 ? index : 999;
}

function formatYear(year) {
  const heisei = String(year).match(/^H(\d+)$/i);
  if (heisei) return `平成${heisei[1]}年度`;
  const reiwa = String(year).match(/^R(\d+)$/i);
  if (reiwa) return `令和${reiwa[1]}年度`;
  return String(year);
}

document.getElementById("list-home-btn").addEventListener("click", () => {
  window.location.href = "index.html";
});
