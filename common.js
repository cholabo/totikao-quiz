// トップ・問題一覧・クイズの3画面で共通して使うもの。
// 以前は同じ関数が3ファイルに写してあり、少しずつ食い違いはじめていたのでここへ寄せた。

const LEARNING_STATE_KEY = "learningStateByLabel";
const YEAR_MODE_START_KEY = "yearModeStartLabel";
const YEAR_MODE_RESUME_KEY = "yearModeResumeLabel";
const YEAR_MODE_PASS_KEY = "yearModePassCount";

// 問題データを差し替えたら上げる。3画面が同じ値を使うのでここだけ直せばよい。
const QUESTIONS_URL = "questions.json?v=20261022a";

function loadLearningState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEARNING_STATE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
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
  try {
    localStorage.setItem(YEAR_MODE_PASS_KEY, String(Math.max(0, Math.floor(count))));
  } catch {
    // 保存できない環境でも出題は続ける
  }
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

// ===== 復習（2026-10-23 新仕様）=====
// 間違えた肢（？を含む）は復習対象（lastResult = "wrong"）。「今日の復習」で日を変えて 3 回正解すると卒業。
// 同じ日の 2 回目以降の正解は数えず、途中で間違えたら翌日から 0 回目に戻る。
// 肢ごとの記録に足したもの: due（次に出す日 YYYY-MM-DD。無ければ今日）、hits（数えた正解 0〜2）、
// reviewDay（「今日の復習」で最後に答えた日）。年度順・テーマ別・タイムアタックの正解は数えない。
// ブックマーク（☆）の肢は卒業に関係なく毎日 1 回「今日の復習」に出る。
const REVIEW_GRADUATE_HITS = 3;
const BOOKMARK_KEY = "bookmarkedLabels";

function dayString(date = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return dayString(new Date(y, m - 1, d + n));
}

function loadBookmarks() {
  try {
    const v = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

function saveBookmarks(set) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...set]));
  } catch {
    // 保存できない環境でも出題は続ける
  }
}

// その日に出す肢か。期限が来た復習対象とブックマークのうち、その日まだ「今日の復習」で答えていないもの
function isDueOn(state, label, bookmarks, day) {
  const st = state[label];
  if (st && st.reviewDay === day) return false;
  if (bookmarks.has(label)) return true;
  return getResultOf(state, label) === "wrong" && (st.due || day) <= day;
}

// 並びは日付を種にしたシャッフル。読み込み直しても同じ順で、解いた肢だけが抜けていく
function shuffleForDay(labels, day) {
  let seed = 0;
  for (const c of day) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...labels].sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function todayReviewLabels(questions, state, bookmarks, day = dayString()) {
  return shuffleForDay(questions.map(q => q.label).filter(l => isDueOn(state, l, bookmarks, day)), day);
}

// テーマ別モード: 群（g）と、その群の中で次に出す肢（label）を覚える
const TAG_MODE_RESUME_KEY = "tagModeResume";

function loadTagResume() {
  try {
    const v = JSON.parse(localStorage.getItem(TAG_MODE_RESUME_KEY) || "null");
    return v && v.g && v.label ? v : null;
  } catch {
    return null;
  }
}

function saveTagResume(g, label) {
  try {
    localStorage.setItem(TAG_MODE_RESUME_KEY, JSON.stringify({ g, label }));
  } catch {
    // 保存できない環境でも出題は続ける
  }
}

function startTagMode(g, label) {
  localStorage.setItem("quizMode", "tag");
  saveTagResume(g, label);
  window.location.href = "quiz.html?mode=tag";
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
