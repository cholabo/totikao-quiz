let questions = [];
let usedQuestions = [];
let currentQuestion = null;

// 解説は年度ごとに分けてあり、出題中の年度の分だけ取りに行く。
// 全年度をまとめると1.4MBあり、questions.json と合わせると初回が重くなるため。
const explanationCache = new Map();

function loadExplanations(year) {
  if (!year) return Promise.resolve(null);
  if (!explanationCache.has(year)) {
    explanationCache.set(year, fetch(`data/exp-${year}.json`)
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null));
  }
  return explanationCache.get(year);
}

// 過去問ノート（note/）の対応表。肢 → 出題マップのマスとページ。無くても解説は出る
let noteMapPromise = null;
function loadNoteMap() {
  if (!noteMapPromise) {
    noteMapPromise = fetch("note/map.json").then(res => (res.ok ? res.json() : null)).catch(() => null);
  }
  return noteMapPromise;
}

function fillNoteLinks(area, label) {
  const box = area.querySelector(".exp-note");
  const list = area.querySelector(".exp-note-list");
  if (!box || !list) return;
  loadNoteMap().then(map => {
    const cells = (map && map[label]) || [];
    if (!cells.length) return;
    list.textContent = "";
    cells.forEach(c => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "note/" + c.c;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = `${c.k} × ${c.a}`;
      a.title = "同じ問われ方の肢を一覧で見る";
      li.appendChild(a);
      const sub = document.createElement("span");
      sub.className = "exp-note-sub";
      const parts = [];
      if (c.r) parts.push(`<a href="note/${c.r}" target="_blank" rel="noopener">${c.k}</a>`);
      if (c.x) parts.push(`<a href="note/${c.x}" target="_blank" rel="noopener">${c.a}</a>`);
      if (parts.length) { sub.innerHTML = "ノート: " + parts.join(" ／ "); li.appendChild(sub); }
      list.appendChild(li);
    });
    box.classList.remove("hidden");
  });
}

function getExplanation(question) {
  if (!question) return Promise.resolve(null);
  return loadExplanations(question.year).then(map => (map ? map[question.label] || null : null));
}

// 分野は肢番号の右に小さく出すだけ。取れなくても出題は止めない。
let topicMap = null;
fetch("data/topics.json")
  .then(res => (res.ok ? res.json() : null))
  .then(map => {
    topicMap = map;
    if (currentQuestion) updateTopicChip(currentQuestion);
  })
  .catch(() => {});

function updateTopicChip(question) {
  const chip = document.getElementById("topic-chip");
  if (!chip) return;
  const topic = topicMap && question ? topicMap[question.label] : null;
  chip.textContent = topic || "";
  chip.classList.toggle("hidden", !topic);
}

// 学習状態のキー・並び順・進捗の集計は common.js にある。
const MAX_RESPONSE_TIME_MS = 60 * 60 * 1000;
const QUIZ_FEEDBACK_ENDPOINT = "https://script.google.com/macros/s/AKfycbykTsPoM-VFHtSWZUmS-TTqZyi7gtJd637B94mw5i_rDgeNtd6_XCRLLTQQ7Z6Fj_x9/exec";
const searchParams = new URLSearchParams(window.location.search);
const requestedStartLabel = searchParams.get("start");
const requestedMode = searchParams.get("mode");
let learningState = loadLearningState();

let currentMode = requestedMode || localStorage.getItem("quizMode") || "year";
let yearModeFromSelection = false;
let yearPassJustFinished = false;
let reviewSessionQuestions = [];
let reviewSessionIndex = 0;
let isTimeAttack = false;
let timeLeft = 300;
let timerInterval = null;
let taCorrectCount = 0;
let taWrongCount = 0;
let taSessionWrongList = [];
let questionShownAt = 0;
let sessionQuestionIndex = 0;
let currentSessionQuestionIndex = 0;
let isAnswerLocked = true;
const feedbackSentLabels = new Set();

fetch(QUESTIONS_URL)
  .then(res => res.json())
  .then(data => {
    questions = data.map(normalizeQuestion).filter(q => q.label);

    if (requestedMode) localStorage.setItem("quizMode", requestedMode);

    if (requestedStartLabel && questions.some(question => question.label === requestedStartLabel)) {
      currentMode = "year";
      localStorage.setItem("quizMode", "year");
      localStorage.setItem(YEAR_MODE_START_KEY, requestedStartLabel);
      localStorage.setItem(YEAR_MODE_RESUME_KEY, requestedStartLabel);
    }

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

function getNowMilliseconds() {
  try {
    if (window.performance && typeof window.performance.now === "function") {
      const value = window.performance.now();
      if (Number.isFinite(value)) return value;
    }
  } catch {
    // 計測用時計が利用できない場合は現在時刻へフォールバックする。
  }
  return Date.now();
}

function startQuestionMeasurement() {
  questionShownAt = getNowMilliseconds();
  sessionQuestionIndex += 1;
  currentSessionQuestionIndex = sessionQuestionIndex;
}

function getSafeResponseTime() {
  const elapsed = Math.round(getNowMilliseconds() - questionShownAt);
  if (!Number.isFinite(elapsed)) return 0;
  return Math.min(MAX_RESPONSE_TIME_MS, Math.max(0, elapsed));
}

function setAnswerControlsDisabled(disabled) {
  document.querySelectorAll(".choice").forEach(button => {
    button.disabled = disabled;
  });
  document.getElementById("unknown-btn").disabled = disabled;
}

function sendQuizAnswerEvent(question, result, selectedAnswer, previousState, nextState) {
  const previousAttempts = Math.max(0, Number(previousState.attempts) || 0);
  const parameters = {
    question_label: String(question.label || ""),
    year: String(question.year || String(question.label || "").split("-")[0] || ""),
    question_no: String(question.questionNo || extractQuestionNo(question.label) || ""),
    choice: String(question.choice || extractChoice(question.label) || ""),
    answer_result: result,
    selected_answer: selectedAnswer,
    quiz_mode: currentMode,
    attempt_number: Number(nextState.attempts) || previousAttempts + 1,
    is_first_attempt: previousAttempts === 0 ? 1 : 0,
    review_correct_streak: Math.max(0, Number(nextState.reviewCorrectStreak) || 0),
    response_time_ms: getSafeResponseTime(),
    session_question_index: currentSessionQuestionIndex
  };

  try {
    if (typeof window.gtag === "function") {
      window.gtag("event", "quiz_answer", parameters);
    }
  } catch {
    // Analyticsの失敗はクイズの回答・保存処理へ影響させない。
  }
}

function recordQuestionAnswer(question, result, selectedAnswer) {
  const previousState = getQuestionState(question);
  const nextState = setQuestionResult(question, result);
  sendQuizAnswerEvent(question, result, selectedAnswer, previousState, nextState);
  return nextState;
}

function isAnswered(question) {
  return ["correct", "wrong", "unknown"].includes(getQuestionState(question).lastResult);
}

function isReviewTarget(question) {
  return ["wrong", "unknown"].includes(getQuestionState(question).lastResult);
}

function updateProgress() {
  const progressInfo = document.getElementById("progress-info");
  if (!progressInfo || isTimeAttack) return;

  const p = summarizeProgress(questions, learningState);
  const modeName = currentMode === "review" ? "復習モード" : "年度順モード";
  const pass = getPassCount();
  progressInfo.textContent = `${modeName}${pass > 0 ? `（${pass + 1}周目）` : ""}`
    + `｜全${p.total}問 / 未回答${p.unanswered}問 / 復習${p.review}問 / 完了${p.completed}問`;
}

function initStudyMode(mode) {
  isTimeAttack = false;
  currentMode = mode === "review" ? "review" : "year";
  yearModeFromSelection = currentMode === "year" && Boolean(
    localStorage.getItem(YEAR_MODE_RESUME_KEY) || localStorage.getItem(YEAR_MODE_START_KEY)
  );
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

  // 最後の肢まで解き終えた。次の周の先頭は残してあるので、トップから1タップで入れる。
  if (yearPassJustFinished) {
    window.location.href = "index.html";
    return;
  }

  const available = getYearModeQuestions();

  if (available.length === 0) {
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
  const startLabel = localStorage.getItem(YEAR_MODE_RESUME_KEY)
    || localStorage.getItem(YEAR_MODE_START_KEY);
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
  document.getElementById("question-number").textContent = question.label;
  updateTopicChip(question);
  const context = document.getElementById("q-context");
  context.textContent = question.context || "";
  context.classList.toggle("hidden", !question.context);
  // 前提文が問いの形（「〜か。」）なら、◯の向きを一行で示す。
  // 対話形式は肢が学生の答えなので、問いに当てはまるかではなく答えの正誤を問う
  const hint = document.getElementById("q-context-hint");
  const ctx = (question.context || "").trim();
  let hintText = "";
  if (/か[。．]?$/.test(ctx)) {
    hintText = ctx.includes("対話")
      ? "学生の答えとして正しければ◯、誤っていれば✕"
      : "この問いに当てはまれば◯、当てはまらなければ✕";
  }
  hint.textContent = hintText;
  hint.classList.toggle("hidden", !hintText);
  document.getElementById("question-text").textContent = question.text;
  // 図を参照する肢は、肢文の下に図を出す
  const figure = document.getElementById("q-figure");
  const fig = question.figure;
  if (fig && fig.src) {
    const img = document.getElementById("q-figure-img");
    img.src = fig.src;
    img.alt = fig.cap || "図";
    document.getElementById("q-figure-cap").textContent = fig.cap || "";
    figure.classList.remove("hidden");
  } else {
    figure.classList.add("hidden");
  }
  // 語句を直した肢は、解く前から断っておく
  document.getElementById("q-edited").classList.toggle("hidden", !question.edited);
  hideVerdict();
  hideExplanation();
  resetFeedbackArea();
  showFeedbackArea();
  document.getElementById("choices").classList.remove("hidden");
  document.querySelectorAll(".choice").forEach(button => {
    button.classList.remove("is-answer", "is-miss");
  });
  document.getElementById("next-btn").classList.add("hidden");
  document.getElementById("unknown-btn").classList.toggle("hidden", isTimeAttack);
  isAnswerLocked = false;
  setAnswerControlsDisabled(false);
  startQuestionMeasurement();
  if (!isTimeAttack) loadExplanations(question.year);   // 解答した瞬間に出せるよう先に取っておく

  if (!isTimeAttack) {
    const nextButton = document.getElementById("next-btn");
    const isReviewEnd = currentMode === "review" && reviewSessionIndex >= reviewSessionQuestions.length;
    const isYearEnd = currentMode === "year" && yearModeFromSelection && !getNextYearQuestion(question);
    nextButton.textContent = isReviewEnd || isYearEnd ? "トップに戻る" : "次の問題へ";
  }
}

// 解答したら「？」を「次の問題へ」に差し替える。位置が変わらないので親指が動かない。
function showNextButton(question) {
  document.getElementById("unknown-btn").classList.add("hidden");
  document.getElementById("next-btn").classList.remove("hidden");

  const correctAnswer = normalizeAnswer(question.answer);
  document.querySelectorAll(".choice").forEach(button => {
    if (normalizeAnswer(button.dataset.choice) === correctAnswer) button.classList.add("is-answer");
  });
}

// 判定は印で押す。kind: correct | wrong | unknown
function showVerdict(kind, mark, message) {
  const verdict = document.getElementById("verdict");
  verdict.classList.remove("hidden", "is-correct", "is-wrong");
  verdict.classList.add(kind === "correct" ? "is-correct" : "is-wrong");
  const stamp = document.getElementById("stamp");
  stamp.textContent = mark;
  // 同じ印を続けて押しても毎回動くように、アニメーションを掛け直す
  stamp.style.animation = "none";
  void stamp.offsetWidth;
  stamp.style.animation = "";
  document.getElementById("result").textContent = message;
}

function hideVerdict() {
  const verdict = document.getElementById("verdict");
  if (verdict) verdict.classList.add("hidden");
}

function getNextYearQuestion(question) {
  const sorted = sortQuestions(questions);
  const currentIndex = sorted.findIndex(item => getQuestionKey(item) === getQuestionKey(question));
  return currentIndex >= 0 ? sorted[currentIndex + 1] || null : null;
}

function advanceYearModeResume(question) {
  if (currentMode !== "year" || !yearModeFromSelection) return;

  const nextQuestion = getNextYearQuestion(question);
  if (nextQuestion) {
    localStorage.setItem(YEAR_MODE_RESUME_KEY, getQuestionKey(nextQuestion));
    return;
  }

  // 最後の肢を解き終えた。次の周の先頭へ巻き戻しておく。
  // ここで消してしまうと、2周目を始めるのに一覧から肢を探すことになる。
  const firstLabel = getFirstLabel(questions);
  yearPassJustFinished = true;
  setPassCount(getPassCount() + 1);
  if (firstLabel) {
    localStorage.setItem(YEAR_MODE_RESUME_KEY, firstLabel);
    localStorage.setItem(YEAR_MODE_START_KEY, firstLabel);
  } else {
    localStorage.removeItem(YEAR_MODE_RESUME_KEY);
  }
}

function showNoQuestionMessage(message) {
  currentQuestion = null;
  isAnswerLocked = true;
  setAnswerControlsDisabled(true);
  document.getElementById("question-number").textContent = "";
  updateTopicChip(null);
  document.getElementById("q-context").classList.add("hidden");
  document.getElementById("q-context-hint").classList.add("hidden");
  document.getElementById("q-figure").classList.add("hidden");
  document.getElementById("q-edited").classList.add("hidden");
  document.getElementById("question-text").textContent = message;
  document.getElementById("choices").classList.add("hidden");
  hideVerdict();
  hideExplanation();
  resetFeedbackArea();
  document.getElementById("next-btn").classList.add("hidden");
}

function hideExplanation() {
  const area = document.getElementById("explanation");
  const toggle = document.getElementById("exp-toggle");
  if (toggle) {
    toggle.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
  }
  if (!area) return;
  area.classList.add("hidden");
  area.dataset.label = "";
}

function openExplanation() {
  const area = document.getElementById("explanation");
  const toggle = document.getElementById("exp-toggle");
  if (!area || !area.dataset.label) return;
  area.classList.remove("hidden");
  toggle.classList.add("hidden");
  toggle.setAttribute("aria-expanded", "true");
}

// 条文カードを組み立てる。
// 本文は条文が隣にある前提で書かれているので、原文はここで出す。ただし畳んでおく。
// 見出しは条文ページ（アプリ内DB）へのリンクにして、そこから全文と e-Gov に行ける。
function buildCard(c) {
  const fig = document.createElement("figure");
  fig.className = "law" + (c.k === "dir" ? " dir" : c.k === "case" ? " case" : "") + (c.g ? " gist" : "");

  const cap = document.createElement("figcaption");
  const href = c.u || (c.s ? `sources.html${c.h ? "?p=" + encodeURIComponent(c.h) : ""}#${c.s}` : null);
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = c.t;
    cap.appendChild(a);
  } else {
    cap.appendChild(document.createTextNode(c.t));
  }
  // 原文に当たれていないものだけ、その場で分かるようにしておく。
  // 「文章化」（要約であること）は枠を破線にして示す。どの資料で裏を取ったかは
  // こちらの作業記録なので出さない。
  if (c.uv) {
    const s = document.createElement("span");
    s.className = "law-chip law-uv";
    s.textContent = "原文未確認";
    cap.appendChild(s);
  }
  fig.appendChild(cap);

  for (const l of c.l || []) {
    const p = document.createElement("p");
    p.className = "law-lead";
    p.textContent = (l.k ? l.k + " ── " : "") + l.t;
    fig.appendChild(p);
  }
  if (c.li) {
    // 号の下の枝は「ア　…」と自前で番号を持っているので、こちらでは振らない
    const list = document.createElement(c.br ? "ul" : "ol");
    if (c.br) list.className = "law-branch";
    for (const t of c.li) {
      const li = document.createElement("li");
      li.textContent = t;
      list.appendChild(li);
    }
    fig.appendChild(list);
  } else {
    const p = document.createElement("p");
    p.className = "law-text";
    p.textContent = c.b || "";
    fig.appendChild(p);
  }
  return fig;
}

// 解説の中身は quiz.html の <template> に一つだけ置いてある。
// 解答直後の欄と、タイムアタックの振り返りで同じ形を使う。
function newExplanationBody() {
  const tpl = document.getElementById("exp-template");
  return tpl ? tpl.content.cloneNode(true) : null;
}

// area は exp-template を写した中身を持つ要素。
// 一言・解説・条文カード・関連法令をそこに埋める。
// 問題文と条文の対比欄は、解説の中で同じことが言えているので置いていない。
function fillExplanation(area, exp, label) {
    if (label) fillNoteLinks(area, label);
    area.querySelector(".exp-core").textContent = exp.c || "";
    area.querySelector(".exp-body").textContent = exp.a || "";

    // 「〜という規定はない」で解く肢。
    // どこを探して無かったかは negative_rules.json に残してあり、ここには出さない。
    const norule = area.querySelector(".exp-norule");
    if (exp.n) {
      area.querySelector(".exp-norule-claim").textContent = exp.n.c || "";
      norule.classList.remove("hidden");
    } else {
      norule.classList.add("hidden");
    }

    // 条文・通達・判例のどれにも根拠が無く、講学上そう説明されているだけのもの
    const doctrine = area.querySelector(".exp-doctrine");
    if (exp.dc) {
      doctrine.textContent = exp.dc;
      doctrine.classList.remove("hidden");
    } else {
      doctrine.classList.add("hidden");
    }

    // 原典に当たれていないもの。作業のいきさつを書いたメモは内側に置いてあり、
    // ここでは「当たれていない」という事実だけを一定の文言で伝える。
    const review = area.querySelector(".exp-review");
    if (exp.rn) {
      review.textContent = "根拠にした通達・先例の原文には、当たれていない部分があります。";
      review.classList.remove("hidden");
    } else {
      review.classList.add("hidden");
    }

    const cards = area.querySelector(".exp-cards");
    const cardList = area.querySelector(".exp-cards-list");
    const nCards = (exp.k || []).length;
    cardList.textContent = "";
    if (nCards) {
      cards.open = false;
      cards.querySelector("summary").textContent =
        nCards > 1 ? `条文を見る（${nCards}件）` : "条文を見る";
      exp.k.forEach(c => cardList.appendChild(buildCard(c)));
      cards.classList.remove("hidden");
    } else {
      cards.classList.add("hidden");
    }

    // 出題当時と今とで扱いが違うもの。答えが逆になる肢は出題当時の解答を先に置く。
    // 答えは変わらないが問題文の文言を直した肢もここに来るので、そのときは注記だけ出す。
    const superseded = area.querySelector(".exp-superseded");
    if (exp.s) {
      superseded.textContent = exp.s.a && exp.s.a !== exp.v
        ? `出題当時の解答は${exp.s.a}。${exp.s.n}`
        : exp.s.n;
      superseded.classList.remove("hidden");
    } else {
      superseded.classList.add("hidden");
    }

    const refsBox = area.querySelector(".exp-refs");
    const list = area.querySelector(".exp-refs-list");
    list.textContent = "";
    if (exp.r && exp.r.length) {
      exp.r.forEach(ref => {
        const li = document.createElement("li");
        // e-Gov にある条文は条・項を指定して直接飛ばす。
        // 準則・通達・別表は e-Gov に無い（別表は項ごとの位置指定ができない）ので、アプリ内の資料へ。
        // 資料は条まるごとを載せているので、指している項を p で渡して目立たせる
        const inApp = ref.s
          ? `sources.html${ref.h ? "?p=" + encodeURIComponent(ref.h) : ""}#${ref.s}`
          : null;
        const href = ref.u || inApp;
        if (href) {
          const a = document.createElement("a");
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = ref.t;
          li.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.className = "exp-ref-plain";
          span.textContent = ref.t;
          li.appendChild(span);
        }
        if (ref.k) {
          const chip = document.createElement("span");
          chip.className = "exp-chip";
          chip.textContent = ref.k;
          li.appendChild(chip);
        }
        list.appendChild(li);
      });
      refsBox.classList.remove("hidden");
    } else if (exp.uv) {
      // 根拠なし解説：正直にその旨を示す
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "exp-ref-plain exp-unverified";
      span.textContent = "明確な根拠となる条文・先例は見つけられませんでした（実務・学説上の取扱い）";
      li.appendChild(span);
      list.appendChild(li);
      refsBox.classList.remove("hidden");
    } else {
      refsBox.classList.add("hidden");
    }
}

// 正解したときは閉じておく。周回を重ねると、知っている解説を毎回読まされるのが摩擦になるため。
function showExplanation(question, shouldOpen) {
  const area = document.getElementById("explanation");
  if (!area || !question) return;
  const label = question.label;

  getExplanation(question).then(exp => {
    // 待っている間に次の問題へ進んでいたら出さない
    if (!exp || !currentQuestion || currentQuestion.label !== label) return;

    area.textContent = "";
    area.appendChild(newExplanationBody());
    fillExplanation(area, exp, label);

    area.dataset.label = label;
    if (shouldOpen) {
      area.classList.remove("hidden");
    } else {
      document.getElementById("exp-toggle").classList.remove("hidden");
    }
  });
}

function resetFeedbackArea() {
  const area = document.getElementById("feedback-area");
  const form = document.getElementById("feedback-form");
  const openButton = document.getElementById("feedback-open-btn");
  const comment = document.getElementById("feedback-comment");
  const status = document.getElementById("feedback-status");
  if (!area || !form || !openButton || !comment || !status) return;

  area.classList.add("hidden");
  form.classList.add("hidden");
  openButton.classList.remove("hidden");
  openButton.disabled = false;
  comment.value = "";
  status.textContent = "";
}

function showFeedbackArea() {
  if (currentMode !== "year" || isTimeAttack || !currentQuestion) return;
  const area = document.getElementById("feedback-area");
  const openButton = document.getElementById("feedback-open-btn");
  const status = document.getElementById("feedback-status");
  if (!area || !openButton || !status) return;

  area.classList.remove("hidden");
  if (feedbackSentLabels.has(currentQuestion.label)) {
    openButton.classList.add("hidden");
    status.textContent = "この問題は報告済みです。";
  }
}

function openFeedbackForm() {
  const form = document.getElementById("feedback-form");
  const openButton = document.getElementById("feedback-open-btn");
  const comment = document.getElementById("feedback-comment");
  if (!form || !openButton || !comment) return;
  openButton.classList.add("hidden");
  form.classList.remove("hidden");
  comment.focus();
}

function closeFeedbackForm() {
  const form = document.getElementById("feedback-form");
  const openButton = document.getElementById("feedback-open-btn");
  const comment = document.getElementById("feedback-comment");
  if (!form || !openButton || !comment) return;
  form.classList.add("hidden");
  openButton.classList.remove("hidden");
  comment.value = "";
}

async function submitQuestionFeedback(event) {
  event.preventDefault();
  if (!currentQuestion || currentMode !== "year" || isTimeAttack) return;

  const submitButton = document.getElementById("feedback-submit-btn");
  const form = document.getElementById("feedback-form");
  const openButton = document.getElementById("feedback-open-btn");
  const comment = document.getElementById("feedback-comment");
  const status = document.getElementById("feedback-status");
  if (!submitButton || !form || !openButton || !comment || !status) return;

  const questionId = String(currentQuestion.label || "").slice(0, 80);
  if (!questionId || !QUIZ_FEEDBACK_ENDPOINT) {
    status.textContent = "報告先を準備中です。";
    return;
  }

  submitButton.disabled = true;
  status.textContent = "送信中…";

  try {
    await fetch(QUIZ_FEEDBACK_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      body: new URLSearchParams({
        questionId,
        comment: String(comment.value || "").trim().slice(0, 500)
      })
    });
    feedbackSentLabels.add(questionId);
    form.classList.add("hidden");
    openButton.classList.add("hidden");
    status.textContent = "報告しました。ありがとうございます。";
  } catch {
    status.textContent = "送信できませんでした。通信状態を確認して、もう一度お試しください。";
    submitButton.disabled = false;
  }
}

document.getElementById("exp-toggle")?.addEventListener("click", openExplanation);

document.querySelectorAll(".choice").forEach(btn => {
  btn.addEventListener("click", () => handleAnswer(btn.dataset.choice));
});

document.getElementById("unknown-btn").addEventListener("click", () => {
  handleUnknown();
});

function handleAnswer(userChoice) {
  if (!currentQuestion || isAnswerLocked) return;

  isAnswerLocked = true;
  setAnswerControlsDisabled(true);

  const selected = normalizeAnswer(userChoice);
  const correctAnswer = normalizeAnswer(currentQuestion.answer);
  const result = selected === correctAnswer ? "correct" : "wrong";
  const selectedAnswer = selected === "◯" ? "circle" : "cross";

  const nextState = recordQuestionAnswer(currentQuestion, result, selectedAnswer);

  if (isTimeAttack) {
    handleTimeAttackResult(result, selected);
    return;
  }

  advanceYearModeResume(currentQuestion);

  if (result === "correct" && nextState.lastResult === "wrong") {
    const remaining = 3 - nextState.reviewCorrectStreak;
    showVerdict("correct", "◯", `正解（復習完了まであと${remaining}回）`);
  } else if (result === "correct") {
    showVerdict("correct", "◯", "正解");
  } else {
    showVerdict("wrong", "✕", "不正解（連続正解数をリセット）");
  }
  if (result === "wrong") {
    document.querySelectorAll(".choice").forEach(button => {
      if (normalizeAnswer(button.dataset.choice) === selected) button.classList.add("is-miss");
    });
  }
  showNextButton(currentQuestion);
  showExplanation(currentQuestion, result === "wrong");
  showFeedbackArea();
  updateProgress();
}

function handleUnknown() {
  if (!currentQuestion || isTimeAttack || isAnswerLocked) return;

  isAnswerLocked = true;
  setAnswerControlsDisabled(true);
  recordQuestionAnswer(currentQuestion, "unknown", "unknown");
  advanceYearModeResume(currentQuestion);
  // 印は正解の側を押して見せる。答えを確かめたい場面なので。
  showVerdict("unknown", normalizeAnswer(currentQuestion.answer), "復習対象にしました");
  showNextButton(currentQuestion);
  showExplanation(currentQuestion, true);
  showFeedbackArea();
  updateProgress();
}

document.getElementById("feedback-open-btn")?.addEventListener("click", openFeedbackForm);
document.getElementById("feedback-cancel-btn")?.addEventListener("click", closeFeedbackForm);
document.getElementById("feedback-form")?.addEventListener("submit", submitQuestionFeedback);

function handleTimeAttackResult(result, selectedAnswer) {
  if (result === "correct") {
    taCorrectCount++;
  } else {
    taWrongCount++;
    taSessionWrongList.push({
      label: getQuestionKey(currentQuestion),
      year: currentQuestion.year,
      context: currentQuestion.context || "",
      text: currentQuestion.text || "",
      correctAnswer: normalizeAnswer(currentQuestion.answer),
      selectedAnswer: normalizeAnswer(selectedAnswer)
    });
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

  setTimeout(() => {
    if (isTimeAttack && timeLeft > 0) newQuestion();
  }, 0);
}

function finishTimeAttack() {
  clearInterval(timerInterval);
  isAnswerLocked = true;
  setAnswerControlsDisabled(true);
  timeLeft = 0;
  updateTimerDisplay();

  document.getElementById("quiz-container").classList.add("hidden");
  document.getElementById("timer-bar").classList.add("hidden");

  const resultArea = document.getElementById("final-result-area");
  resultArea.classList.remove("hidden");

  document.getElementById("score-correct").textContent = taCorrectCount;
  document.getElementById("score-wrong").textContent = taWrongCount;
  renderTimeAttackWrongReview();
}

// 間違えた肢の振り返り。問題文と解説を並べて置く。
// 出題中はテンポを優先して条文を畳むが、ここは腰を据えて読む場なので
// 長くなっても構わない。条文だけは同じように畳んでおく。
function renderTimeAttackWrongReview() {
  const reviewList = document.getElementById("ta-wrong-review-list");
  if (!reviewList) return;
  reviewList.textContent = "";

  if (taSessionWrongList.length === 0) {
    reviewList.innerHTML = '<p class="ta-all-correct">間違えた問題はありません。全問正解です！</p>';
    return;
  }

  for (const item of taSessionWrongList) {
    const card = document.createElement("article");
    card.className = "ta-wrong-card";

    const head = document.createElement("h4");
    head.textContent = item.label;
    card.appendChild(head);

    // 前提文と問題文。出題中の画面と同じ並びで置く
    if (item.context) {
      const ctx = document.createElement("p");
      ctx.className = "ta-wrong-context";
      ctx.textContent = item.context;
      card.appendChild(ctx);
    }
    const question = document.createElement("p");
    question.className = "ta-wrong-question";
    question.textContent = item.text;
    card.appendChild(question);

    const dl = document.createElement("dl");
    dl.className = "ta-wrong-answers";
    for (const [term, value] of [["正解", item.correctAnswer], ["あなたの解答", item.selectedAnswer]]) {
      const box = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      box.append(dt, dd);
      dl.appendChild(box);
    }
    card.appendChild(dl);

    // 解説は年度ごとのファイルから取るので、カードを先に並べて後から埋める
    const area = document.createElement("div");
    area.className = "explanation ta-exp";
    card.appendChild(area);
    reviewList.appendChild(card);

    getExplanation(item).then(exp => {
      const body = exp && newExplanationBody();
      if (!body) {
        area.remove();
        return;
      }
      area.appendChild(body);
      fillExplanation(area, exp, item.label);
    });
  }
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

document.getElementById("share-x-btn").addEventListener("click", () => {
  const text = `土地家屋調査士クイズ タイムアタック結果\n正解：${taCorrectCount}問\n誤答：${taWrongCount}問\n#調査士クイズ\n`;
  navigator.clipboard.writeText(text).then(() => {
    alert("結果をコピーしました。Xを開くので貼り付けてください。");
    window.open("https://twitter.com/intent/tweet", "_blank");
  });
});
