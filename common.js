// トップ・問題一覧・クイズの3画面で共通して使うもの。
// 以前は同じ関数が3ファイルに写してあり、少しずつ食い違いはじめていたのでここへ寄せた。

const LEARNING_STATE_KEY = "learningStateByLabel";
const YEAR_MODE_START_KEY = "yearModeStartLabel";
const YEAR_MODE_RESUME_KEY = "yearModeResumeLabel";
const YEAR_MODE_PASS_KEY = "yearModePassCount";

// 問題データを差し替えたら上げる。3画面が同じ値を使うのでここだけ直せばよい。
const QUESTIONS_URL = "questions.json?v=20260829b";

function loadLearningState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEARNING_STATE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// 何周し終えたか。年度順モードを最後の肢まで解き切るたびに1増える。
function getPassCount() {
  const value = Number(localStorage.getItem(YEAR_MODE_PASS_KEY));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function setPassCount(count) {
  localStorage.setItem(YEAR_MODE_PASS_KEY, String(Math.max(0, Math.floor(count))));
}

// 未回答・復習・完了の3状態。「？」は復習と同じ扱いにする。
function getResultOf(state, label) {
  const result = state[label]?.lastResult;
  if (result === "correct") return "correct";
  if (result === "wrong" || result === "unknown") return "wrong";
  return "unanswered";
}

function summarizeProgress(questions, state) {
  const summary = { total: questions.length, unanswered: 0, review: 0, completed: 0 };
  questions.forEach(question => {
    const result = getResultOf(state, question.label);
    if (result === "correct") summary.completed += 1;
    else if (result === "wrong") summary.review += 1;
    else summary.unanswered += 1;
  });
  return summary;
}

// ===== 出題順（年度 → 問番号 → 肢）=====

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

const CHOICE_ORDER = ["ア", "イ", "ウ", "エ", "オ", "1", "2", "3", "4", "5",
  "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function normalizeChoice(choice) {
  const text = String(choice || "").trim();
  const mojibakeMap = { "繧｢": "ア", "繧､": "イ", "繧ｦ": "ウ", "繧ｨ": "エ", "繧ｪ": "オ" };
  return mojibakeMap[text] || text;
}

function getChoiceOrder(choice) {
  const index = CHOICE_ORDER.indexOf(normalizeChoice(choice));
  return index >= 0 ? index : 999;
}

function compareQuestions(a, b) {
  const yearDifference = getYearOrder(a.year || a.label) - getYearOrder(b.year || b.label);
  if (yearDifference !== 0) return yearDifference;

  const questionDifference =
    Number(a.questionNo || extractQuestionNo(a.label)) - Number(b.questionNo || extractQuestionNo(b.label));
  if (questionDifference !== 0) return questionDifference;

  const choiceDifference =
    getChoiceOrder(a.choice || extractChoice(a.label)) - getChoiceOrder(b.choice || extractChoice(b.label));
  return choiceDifference || String(a.label).localeCompare(String(b.label), "ja");
}

function sortQuestions(questions) {
  return [...questions].sort(compareQuestions);
}

function getFirstLabel(questions) {
  return questions.length ? sortQuestions(questions)[0].label : "";
}

function formatYear(year) {
  const heisei = String(year).match(/^H(\d+)$/i);
  if (heisei) return `平成${heisei[1]}年度`;
  const reiwa = String(year).match(/^R(\d+)$/i);
  if (reiwa) return `令和${reiwa[1]}年度`;
  return String(year);
}

// 年度順モードを、指定した肢から始める
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

// ホーム画面から起動した状態（standalone）にはタブが無いため、target="_blank" でも
// 同じ窓で開いてしまい、解いていた場所を見失う。そこだけ明示的に外へ出す。
document.addEventListener("click", event => {
  const link = event.target.closest?.('a[target="_blank"]');
  if (!link) return;
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  if (!standalone) return;
  event.preventDefault();
  window.open(link.href, "_blank", "noopener");
});

// ホーム画面に置いて、電波の無いところでも開けるようにする
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // 登録できなくても、ふつうのサイトとしては動く
    });
  });
}
