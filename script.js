let questions = [];
let usedQuestions = [];
let currentQuestion = null;

const LEARNING_STATE_KEY = "learningStateByLabel";
const YEAR_MODE_START_KEY = "yearModeStartLabel";
const YEAR_MODE_RESUME_KEY = "yearModeResumeLabel";
let learningState = loadLearningState();

let currentMode = localStorage.getItem("quizMode") || "year";
let yearModeFromSelection = false;
let reviewSessionQuestions = [];
let reviewSessionIndex = 0;
let isTimeAttack = false;
let timeLeft = 300;
let timerInterval = null;
let taCorrectCount = 0;
let taWrongCount = 0;
let taSessionWrongList = [];

fetch("questions.json", { cache: "no-store" })
  .then(res => res.json())
  .then(data => {
    questions = data.map(normalizeQuestion).filter(q => q.label);

    if (currentMode === "timeattack") {
      initTimeAttack();
    } else {
      initStudyMode(currentMode);
    }
  })
  .catch(() => {
    showNoQuestionMessage("問題データを読み込めませんでした。");
  });

function normalizeQuestion(question) {
  return {
    ...question,
    label: String(question.label || question.id || ""),
    context: question.context || "",
    text: question.text || "",
    answer: normalizeAnswer(question.answer)
  };
}

function normalizeAnswer(value) {
  const answer = String(value || "").trim();
  if (["◯", "○", "〇", "笳ｯ"].includes(answer)) return "◯";
  if (["✕", "×", "X", "x", "笨・"].includes(answer)) return "✕";
  return answer;
}

function loadLearningState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEARNING_STATE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLearningState() {
  localStorage.setItem(LEARNING_STATE_KEY, JSON.stringify(learningState));
}

function getQuestionKey(question) {
  return question.label;
}

function getDefaultState() {
  return {
    attempts: 0,
    correctCount: 0,
    wrongCount: 0,
    lastResult: null,
    lastAnsweredAt: "",
    reviewCorrectStreak: 0
  };
}

function getQuestionState(question) {
  return learningState[getQuestionKey(question)] || getDefaultState();
}

function setQuestionResult(question, result) {
  const key = getQuestionKey(question);
  const current = getQuestionState(question);
  const next = {
    attempts: (current.attempts || 0) + 1,
    correctCount: current.correctCount || 0,
    wrongCount: current.wrongCount || 0,
    lastResult: result,
    lastAnsweredAt: new Date().toISOString(),
    reviewCorrectStreak: current.reviewCorrectStreak || 0
  };

  if (result === "correct") {
    next.correctCount += 1;

    if (["wrong", "unknown"].includes(current.lastResult) || next.reviewCorrectStreak > 0) {
      next.reviewCorrectStreak += 1;
      if (next.reviewCorrectStreak < 3) {
        next.lastResult = "wrong";
      } else {
        next.lastResult = "correct";
        next.reviewCorrectStreak = 0;
      }
    }
  }

  if (result === "wrong") {
    next.wrongCount += 1;
    next.reviewCorrectStreak = 0;
  }

  if (result === "unknown") {
    next.lastResult = "wrong";
    next.reviewCorrectStreak = 0;
  }

  learningState[key] = next;
  saveLearningState();
  return next;
}

function isAnswered(question) {
  return ["correct", "wrong", "unknown"].includes(getQuestionState(question).lastResult);
}

function isReviewTarget(question) {
  return ["wrong", "unknown"].includes(getQuestionState(question).lastResult);
}

function getProgress() {
  const total = questions.length;
  const unanswered = questions.filter(q => !isAnswered(q)).length;
  const review = questions.filter(isReviewTarget).length;
  const completed = questions.filter(q => getQuestionState(q).lastResult === "correct").length;
  return { total, unanswered, review, completed };
}

function updateProgress() {
  const progressInfo = document.getElementById("progress-info");
  if (!progressInfo || isTimeAttack) return;

  const p = getProgress();
  const modeName = currentMode === "review" ? "復習モード" : "年度順モード";
  progressInfo.textContent =
    `${modeName}｜全${p.total}問 / 未回答${p.unanswered}問 / 復習${p.review}問 / 完了${p.completed}問`;
}

function initStudyMode(mode) {
  isTimeAttack = false;
  currentMode = mode === "review" ? "review" : "year";
  yearModeFromSelection = currentMode === "year" && Boolean(localStorage.getItem(YEAR_MODE_START_KEY));
  usedQuestions = [];
  reviewSessionQuestions = currentMode === "review"
    ? questions.filter(isReviewTarget).sort(compareQuestions)
    : [];
  reviewSessionIndex = 0;

  document.getElementById("timer-bar").classList.add("hidden");
  document.getElementById("unknown-btn").classList.remove("hidden");
  document.getElementById("controls").classList.remove("hidden");
  document.getElementById("progress-info").classList.remove("hidden");
  document.getElementById("list-btn").classList.toggle("hidden", currentMode !== "year");

  newQuestion();
}

function initTimeAttack() {
  isTimeAttack = true;
  currentMode = "timeattack";
  timeLeft = 300;
  taCorrectCount = 0;
  taWrongCount = 0;
  taSessionWrongList = [];
  usedQuestions = [];

  document.getElementById("timer-bar").classList.remove("hidden");
  document.getElementById("unknown-btn").classList.add("hidden");
  document.getElementById("controls").classList.add("hidden");
  document.getElementById("progress-info").classList.add("hidden");

  updateTimerDisplay();

  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) finishTimeAttack();
  }, 1000);

  newQuestion();
}

function updateTimerDisplay() {
  if (timeLeft < 0) timeLeft = 0;
  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, "0");
  const seconds = (timeLeft % 60).toString().padStart(2, "0");
  document.getElementById("timer-display").textContent = `${minutes}:${seconds}`;
}

function newQuestion() {
  if (isTimeAttack) {
    showTimeAttackQuestion();
    return;
  }

  if (currentMode === "review") {
    showReviewQuestion();
    return;
  }

  const available = getYearModeQuestions();

  if (available.length === 0) {
    if (yearModeFromSelection) {
      localStorage.removeItem(YEAR_MODE_START_KEY);
      localStorage.removeItem(YEAR_MODE_RESUME_KEY);
      window.location.href = "index.html";
      return;
    }

    showNoQuestionMessage("年度順モードの未回答問題はありません。");
    updateProgress();
    return;
  }

  currentQuestion = available[0];
  if (currentMode === "year" && yearModeFromSelection) {
    usedQuestions.push(getQuestionKey(currentQuestion));
    localStorage.setItem(YEAR_MODE_RESUME_KEY, getQuestionKey(currentQuestion));
  }
  renderQuestion(currentQuestion);
  updateProgress();
}

function showReviewQuestion() {
  if (reviewSessionQuestions.length === 0) {
    showNoQuestionMessage("復習対象の問題はありません。");
    updateProgress();
    return;
  }

  if (reviewSessionIndex >= reviewSessionQuestions.length) {
    window.location.href = "index.html";
    return;
  }

  currentQuestion = reviewSessionQuestions[reviewSessionIndex];
  reviewSessionIndex += 1;
  renderQuestion(currentQuestion);
  updateProgress();
}

function getYearModeQuestions() {
  const sorted = [...questions].sort(compareQuestions);
  const startLabel = localStorage.getItem(YEAR_MODE_START_KEY);
  if (!startLabel) return sorted.filter(q => !isAnswered(q));

  const startQuestion = questions.find(q => q.label === startLabel);
  if (!startQuestion) {
    localStorage.removeItem(YEAR_MODE_START_KEY);
    yearModeFromSelection = false;
    return sorted.filter(q => !isAnswered(q));
  }

  return sorted.filter(question =>
    compareQuestions(question, startQuestion) >= 0 &&
    !usedQuestions.includes(getQuestionKey(question))
  );
}

function showTimeAttackQuestion() {
  let available = questions.filter(q => !usedQuestions.includes(getQuestionKey(q)));

  if (available.length === 0) {
    usedQuestions = [];
    available = questions;
  }

  currentQuestion = available[Math.floor(Math.random() * available.length)];
  usedQuestions.push(getQuestionKey(currentQuestion));
  renderQuestion(currentQuestion);
}

function renderQuestion(question) {
  document.getElementById("question-number").textContent = `【${question.label}】`;
  document.getElementById("question-text").textContent =
    question.context ? `${question.context}\n\n${question.text}` : question.text;
  document.getElementById("result").textContent = "";
  document.getElementById("choices").classList.remove("hidden");

  if (!isTimeAttack) {
    const nextButton = document.getElementById("next-btn");
    const isReviewEnd = currentMode === "review" && reviewSessionIndex >= reviewSessionQuestions.length;
    const isYearEnd = currentMode === "year" && yearModeFromSelection && !getNextYearQuestion(question);
    nextButton.textContent = isReviewEnd || isYearEnd ? "トップに戻る" : "次の問題へ";
    nextButton.classList.add("hidden");
  }
}

function getNextYearQuestion(question) {
  const sorted = [...questions].sort(compareQuestions);
  const currentIndex = sorted.findIndex(item => getQuestionKey(item) === getQuestionKey(question));
  return currentIndex >= 0 ? sorted[currentIndex + 1] || null : null;
}

function advanceYearModeResume(question) {
  if (currentMode !== "year" || !yearModeFromSelection) return;

  const nextQuestion = getNextYearQuestion(question);
  if (nextQuestion) {
    localStorage.setItem(YEAR_MODE_RESUME_KEY, getQuestionKey(nextQuestion));
  } else {
    localStorage.removeItem(YEAR_MODE_RESUME_KEY);
  }
}

function showNoQuestionMessage(message) {
  currentQuestion = null;
  document.getElementById("question-number").textContent = "";
  document.getElementById("question-text").textContent = message;
  document.getElementById("choices").classList.add("hidden");
  document.getElementById("result").textContent = "";
  document.getElementById("next-btn").classList.add("hidden");
}

function compareQuestions(a, b) {
  const ay = getYearOrder(a.year || a.label);
  const by = getYearOrder(b.year || b.label);
  if (ay !== by) return ay - by;

  const aq = Number(a.questionNo || extractQuestionNo(a.label) || 0);
  const bq = Number(b.questionNo || extractQuestionNo(b.label) || 0);
  if (aq !== bq) return aq - bq;

  const ac = getChoiceOrder(a.choice || extractChoice(a.label));
  const bc = getChoiceOrder(b.choice || extractChoice(b.label));
  if (ac !== bc) return ac - bc;

  return a.label.localeCompare(b.label, "ja");
}

function getYearOrder(value) {
  const text = String(value || "");
  const h = text.match(/H(\d+)/i);
  if (h) return Number(h[1]);
  const r = text.match(/R(\d+)/i);
  if (r) return 100 + Number(r[1]);
  return 999;
}

function extractQuestionNo(label) {
  const match = String(label || "").match(/^[HR]\d+-(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function extractChoice(label) {
  const parts = String(label || "").split("-");
  return parts[2] || "";
}

function getChoiceOrder(choice) {
  const order = ["ア", "イ", "ウ", "エ", "オ", "1", "2", "3", "4", "5", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  const normalized = normalizeChoice(choice);
  const index = order.indexOf(normalized);
  return index >= 0 ? index : 999;
}

function normalizeChoice(choice) {
  const text = String(choice || "").trim();
  const mojibakeMap = {
    "繧｢": "ア",
    "繧､": "イ",
    "繧ｦ": "ウ",
    "繧ｨ": "エ",
    "繧ｪ": "オ"
  };
  return mojibakeMap[text] || text;
}

function shuffle(items) {
  const copied = [...items];
  for (let i = copied.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

document.querySelectorAll(".choice").forEach(btn => {
  btn.addEventListener("click", () => handleAnswer(btn.dataset.choice));
});

document.getElementById("unknown-btn").addEventListener("click", () => {
  handleUnknown();
});

function handleAnswer(userChoice) {
  if (!currentQuestion) return;

  const selected = normalizeAnswer(userChoice);
  const correctAnswer = normalizeAnswer(currentQuestion.answer);
  const result = selected === correctAnswer ? "correct" : "wrong";

  const nextState = setQuestionResult(currentQuestion, result);

  if (isTimeAttack) {
    handleTimeAttackResult(result);
    return;
  }

  advanceYearModeResume(currentQuestion);

  if (result === "correct" && nextState.lastResult === "wrong") {
    const remaining = 3 - nextState.reviewCorrectStreak;
    document.getElementById("result").textContent =
      `◯ 正解（復習完了まであと${remaining}回）`;
  } else {
    document.getElementById("result").textContent =
      result === "correct" ? "◯ 正解" : "✕ 不正解（連続正解数をリセット）";
  }
  document.getElementById("next-btn").classList.remove("hidden");
  updateProgress();
}

function handleUnknown() {
  if (!currentQuestion || isTimeAttack) return;

  setQuestionResult(currentQuestion, "unknown");
  advanceYearModeResume(currentQuestion);
  document.getElementById("result").textContent = "？ 復習対象にしました";
  document.getElementById("next-btn").classList.remove("hidden");
  updateProgress();
}

function handleTimeAttackResult(result) {
  if (result === "correct") {
    taCorrectCount++;
  } else {
    taWrongCount++;
    taSessionWrongList.push(getQuestionKey(currentQuestion));
    timeLeft -= 20;
    updateTimerDisplay();

    const timerBar = document.getElementById("timer-bar");
    timerBar.classList.add("penalty-flash");
    setTimeout(() => timerBar.classList.remove("penalty-flash"), 300);

    if (timeLeft <= 0) {
      finishTimeAttack();
      return;
    }
  }

  newQuestion();
}

function finishTimeAttack() {
  clearInterval(timerInterval);
  timeLeft = 0;
  updateTimerDisplay();

  document.getElementById("quiz-container").classList.add("hidden");
  document.getElementById("timer-bar").classList.add("hidden");

  const resultArea = document.getElementById("final-result-area");
  resultArea.classList.remove("hidden");

  document.getElementById("score-correct").textContent = taCorrectCount;
  document.getElementById("score-wrong").textContent = taWrongCount;
}

document.getElementById("next-btn").addEventListener("click", newQuestion);

document.getElementById("home-btn").addEventListener("click", () => {
  window.location.href = "index.html";
});

document.getElementById("list-btn").addEventListener("click", () => {
  window.location.href = "question-list.html";
});

document.getElementById("ta-home-btn").addEventListener("click", () => {
  window.location.href = "index.html";
});

document.getElementById("copy-ta-wrong-btn").addEventListener("click", () => {
  const uniqueLabels = [...new Set(taSessionWrongList)];
  if (uniqueLabels.length === 0) {
    alert("タイムアタックで間違えた問題はありません。");
    return;
  }

  navigator.clipboard.writeText(uniqueLabels.join("\n")).then(() => {
    alert("今回の誤答リストをコピーしました。");
  });
});

document.getElementById("share-x-btn").addEventListener("click", () => {
  const text = `土地家屋調査士クイズ タイムアタック結果\n正解：${taCorrectCount}問\n誤答：${taWrongCount}問\n#調査士クイズ\n`;
  navigator.clipboard.writeText(text).then(() => {
    alert("結果をコピーしました。Xを開くので貼り付けてください。");
    window.open("https://twitter.com/intent/tweet", "_blank");
  });
});
