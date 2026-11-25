// 測量士補 一問一答。土地家屋調査士アプリ（app/script.js・common.js）の考え方を写した小さい版。
// トップ（index.html）・年度順モードの一覧（question-list.html）・出題画面（quiz.html）で読む。
// 出題画面の処理は #quiz-container があるときだけ動く。
// 記録は localStorage の "sk." で始まるキーだけに置く（調査士の記録と混ざらないように）。

"use strict";

// 地図を読む問題の図の出典（問題文の言い方のとおり）。画面に図が出ている間はいつも見えるように、図の下と拡大画面の両方に出す
const SK_FIG_SRC = {
  "H24-22": "電子国土ポータル", "H25-22": "電子国土ポータル", "H28-21": "電子地形図25000", "H29-21": "電子地形図25000",
  "H30-21": "1/25,000地形図", "R7-21": "電子地形図25000", "R8-21": "電子地形図25000"
};
function skFigSource(fig) {
  return SK_FIG_SRC[fig] ? `図の出典：国土地理院「${SK_FIG_SRC[fig]}」（測量士補試験の問題に掲載されたもの）` : "";
}

const SK_STATE_KEY = "sk.learningState";   // { label: {attempts, correctCount, wrongCount, lastResult, lastAnsweredAt, hits, due?, reviewDay?} }
const SK_POS_KEY = "sk.position";          // { "chapter:水準測量": label } 分野別の各分野の続きの肢
const SK_LAST_KEY = "sk.lastSet";          // { mode: "chapter", key } 最後に解いていた分野
const SK_MODE_KEY = "sk.quizMode";         // "year" | "chapter" 最後に使ったモード（トップの「続きから」）
// 年度順モード（調査士 common.js の yearModeStartLabel・yearModeResumeLabel・yearModePassCount と同じ役目）
const SK_YEAR_START_KEY = "sk.yearModeStartLabel";
const SK_YEAR_RESUME_KEY = "sk.yearModeResumeLabel";
const SK_YEAR_PASS_KEY = "sk.yearModePassCount";
const SK_QUESTIONS_URL = "questions.json?v=20261120a";

const CHAPTER_ORDER = ["測量に関する法規", "多角測量", "GNSS測量", "水準測量", "地形測量",
  "写真測量", "三次元点群測量", "地図編集", "応用測量"];

// 復習の規則は調査士アプリと同じ（common.js「復習（2026-10-23 新仕様）」）。
// 間違えた肢・わからない肢は復習対象。「復習」モードで日を変えて 3 回正解すると卒業。
// 同じ日の 2 回目以降の正解は数えず、途中で間違えたら翌日から 0 回目に戻る。
const REVIEW_GRADUATE_HITS = 3;

function skRead(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function skWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できない環境でも出題は続ける
  }
}

// 文字列 1 つを置くキー（年度順の位置・周回数・モード）
function skGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function skSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 保存できない環境でも出題は続ける
  }
}

function skRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 同上
  }
}

function loadLearningState() {
  const v = skRead(SK_STATE_KEY, {});
  return Array.isArray(v) ? {} : v;
}

// 何周し終えたか。年度順モードを最後の肢まで解き切るたびに 1 増える
function getPassCount() {
  const value = Number(skGet(SK_YEAR_PASS_KEY));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function setPassCount(count) {
  skSet(SK_YEAR_PASS_KEY, Math.max(0, Math.floor(count)));
}

// 画面に出す肢の名前。穴埋め由来の ✕ 肢は label に答え（「✕」）が出るので disp を使う
function dispName(q) {
  return (q && (q.disp || q.label)) || "";
}

function dayString(date = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return dayString(new Date(y, m - 1, d + n));
}

// 未回答・復習・完了の 3 状態。「わからない」は復習と同じ扱い
function getResultOf(state, label) {
  const r = state[label] && state[label].lastResult;
  if (r === "correct") return "correct";
  if (r === "wrong" || r === "unknown") return "wrong";
  return "unanswered";
}

function summarize(list, state) {
  const s = { total: list.length, answered: 0, review: 0, completed: 0 };
  list.forEach(q => {
    const r = getResultOf(state, q.label);
    if (r !== "unanswered") s.answered += 1;
    if (r === "correct") s.completed += 1;
    if (r === "wrong") s.review += 1;
  });
  s.unanswered = s.total - s.answered;
  return s;
}

function isDueOn(state, label, day) {
  const st = state[label];
  if (!st || st.reviewDay === day) return false;
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

function todayReviewLabels(questions, state, day = dayString()) {
  return shuffleForDay(questions.map(q => q.label).filter(l => isDueOn(state, l, day)), day);
}

// ===== 並び（年度 → 問番号 → 肢）=====
function getYearOrder(year) {
  const t = String(year || "");
  const h = t.match(/^H(\d+)/i);
  if (h) return Number(h[1]);
  const r = t.match(/^R(\d+)/i);
  if (r) return 100 + Number(r[1]);
  return 999;
}

// 同じ問の中は questions.json の並び（id）を正とする。穴埋めを一問一答に直した肢（anaume、choice が ア・イ…）は
// 元の肢のすぐ後ろに id が振ってあるので、肢記号で並べ直すと離れてしまう
function compareQuestions(a, b) {
  return getYearOrder(a.year) - getYearOrder(b.year)
    || Number(a.questionNo) - Number(b.questionNo)
    || Number(a.id || 0) - Number(b.id || 0)
    || String(a.label).localeCompare(String(b.label));
}

function formatYear(year) {
  const h = String(year).match(/^H(\d+)$/i);
  if (h) return `平成${h[1]}年度`;
  const r = String(year).match(/^R(\d+)$/i);
  if (r) return r[1] === "1" ? "令和元年度" : `令和${r[1]}年度`;
  return String(year);
}

function normalizeAnswer(value) {
  const a = String(value || "").trim();
  if (["◯", "○", "〇"].includes(a)) return "◯";
  if (["✕", "×", "X", "x"].includes(a)) return "✕";
  return a;
}

function loadQuestions() {
  return fetch(SK_QUESTIONS_URL)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error("questions"))))
    .then(data => data
      .map(q => ({ ...q, label: String(q.label || q.id || ""), context: q.context || "", text: q.text || "", answer: normalizeAnswer(q.answer) }))
      .filter(q => q.label)
      .sort(compareQuestions));
}

// 分野別のセットの肢を並べる
function setQuestions(questions, mode, key) {
  if (mode === "chapter") return questions.filter(q => q.chapter === key);
  return [];
}

function setName(mode, key) {
  if (mode === "chapter") return key;
  return "今日の復習";
}

function quizUrl(mode, key) {
  return `quiz.html?mode=${encodeURIComponent(mode)}` + (key ? `&key=${encodeURIComponent(key)}` : "");
}

// 年度順の先頭の肢（questions は loadQuestions で並べ済み）
function getFirstLabel(questions) {
  return questions.length ? questions[0].label : "";
}

// 年度順モードを、指定した肢から始める（調査士 common.js の startYearMode）
function startYearMode(label) {
  skSet(SK_MODE_KEY, "year");
  if (label) {
    skSet(SK_YEAR_START_KEY, label);
    skSet(SK_YEAR_RESUME_KEY, label);
  } else {
    skRemove(SK_YEAR_START_KEY);
  }
  window.location.href = quizUrl("year");
}

// ===================================================================
// 出題画面
// ===================================================================
if (document.getElementById("quiz-container")) {
  const params = new URLSearchParams(window.location.search);
  const mode = ["year", "chapter", "review"].includes(params.get("mode")) ? params.get("mode") : "year";
  const setKey = mode === "chapter" ? params.get("key") || "" : "";
  const posKey = `${mode}:${setKey}`;

  let questions = [];
  let list = [];          // 分野別・今日の復習で出す肢（並び済み）
  let index = 0;
  let currentQuestion = null;
  let isAnswerLocked = true;
  // 年度順モード（調査士 script.js と同じ考え方）: 全年度を通した 1 本の並びを、開始位置から順に出す
  let usedQuestions = [];
  let yearModeFromSelection = false;
  let yearPassJustFinished = false;
  let learningState = loadLearningState();
  const explanationCache = new Map();
  const $ = id => document.getElementById(id);

  // 解説は年度ごとのファイル。出題中の年度の分だけ取りに行く
  function loadExplanations(year) {
    if (!year) return Promise.resolve(null);
    if (!explanationCache.has(year)) {
      explanationCache.set(year, fetch(`data/exp-${year}.json?v=20261120a`)
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null)
        .then(map => { if (!map) explanationCache.delete(year); return map; }));
    }
    return explanationCache.get(year);
  }

  function getQuestionState(q) {
    return learningState[q.label] || { attempts: 0, correctCount: 0, wrongCount: 0, lastResult: null, lastAnsweredAt: "", hits: 0 };
  }

  // app/script.js の setQuestionResult と同じ規則。卒業の回数は「復習」モードで答えたときだけ数える
  function setQuestionResult(q, result) {
    learningState = loadLearningState();   // 別タブで進めた分を消さないように読み直す
    const current = getQuestionState(q);
    const today = dayString();
    const inReview = mode === "review";
    const wasTarget = ["wrong", "unknown"].includes(current.lastResult);
    const next = {
      attempts: (current.attempts || 0) + 1,
      correctCount: (current.correctCount || 0) + (result === "correct" ? 1 : 0),
      wrongCount: (current.wrongCount || 0) + (result === "wrong" ? 1 : 0),
      lastResult: result === "unknown" ? "wrong" : result,
      lastAnsweredAt: new Date().toISOString(),
      hits: Math.max(0, Number(current.hits) || 0)
    };
    if (current.due) next.due = current.due;
    if (current.reviewDay) next.reviewDay = current.reviewDay;
    if (inReview) next.reviewDay = today;

    if (result !== "correct") {
      next.hits = 0;
      next.due = addDays(today, 1);
    } else if (wasTarget) {
      if (!inReview || current.reviewDay === today) {
        next.lastResult = "wrong";
      } else {
        next.hits += 1;
        if (next.hits >= REVIEW_GRADUATE_HITS) {
          next.hits = 0;
          delete next.due;
        } else {
          next.lastResult = "wrong";
          next.due = addDays(today, 1);
        }
      }
    }
    learningState[q.label] = next;
    skWrite(SK_STATE_KEY, learningState);
    return next;
  }

  // 分野別の続きの位置。年度順は sk.yearModeResumeLabel に置く
  function savePosition(label) {
    if (mode !== "chapter") return;
    const pos = skRead(SK_POS_KEY, {});
    pos[posKey] = label;
    skWrite(SK_POS_KEY, pos);
    skWrite(SK_LAST_KEY, { mode, key: setKey });
  }

  // ===== 年度順モード =====
  function isAnswered(q) {
    return ["correct", "wrong", "unknown"].includes(getQuestionState(q).lastResult);
  }

  // 調査士 script.js の getYearModeQuestions。開始位置が無ければ（選択なしで入ったら）未回答の肢だけを先頭から
  function getYearModeQuestions() {
    const startLabel = skGet(SK_YEAR_RESUME_KEY) || skGet(SK_YEAR_START_KEY);
    if (!startLabel) return questions.filter(q => !isAnswered(q));

    const startQuestion = questions.find(q => q.label === startLabel);
    if (!startQuestion) {
      skRemove(SK_YEAR_START_KEY);
      yearModeFromSelection = false;
      return questions.filter(q => !isAnswered(q));
    }

    const used = new Set(usedQuestions);
    return questions.filter(q => compareQuestions(q, startQuestion) >= 0 && !used.has(q.label));
  }

  function getNextYearQuestion(q) {
    const i = questions.findIndex(item => item.label === q.label);
    return i >= 0 ? questions[i + 1] || null : null;
  }

  // 解いたら次の肢を再開位置にする。最後の肢なら周回数を 1 足して先頭へ巻き戻す
  function advanceYearModeResume(q) {
    if (mode !== "year" || !yearModeFromSelection) return;
    const nextQuestion = getNextYearQuestion(q);
    if (nextQuestion) {
      skSet(SK_YEAR_RESUME_KEY, nextQuestion.label);
      return;
    }
    const firstLabel = getFirstLabel(questions);
    yearPassJustFinished = true;
    setPassCount(getPassCount() + 1);
    if (firstLabel) {
      skSet(SK_YEAR_RESUME_KEY, firstLabel);
      skSet(SK_YEAR_START_KEY, firstLabel);
    } else {
      skRemove(SK_YEAR_RESUME_KEY);
    }
  }

  function showYearQuestion() {
    // 最後の肢まで解き終えた。次の周の先頭は残してあるので、トップから 1 タップで入れる
    if (yearPassJustFinished) {
      window.location.href = "index.html";
      return;
    }
    const available = getYearModeQuestions();
    if (!available.length) {
      showMessage("年度順モードの未回答問題はありません。");
      updateProgress();
      return;
    }
    currentQuestion = available[0];
    if (yearModeFromSelection) {
      usedQuestions.push(currentQuestion.label);
      skSet(SK_YEAR_RESUME_KEY, currentQuestion.label);
    }
    renderQuestion(currentQuestion);
    updateProgress();
  }

  loadQuestions()
    .then(data => {
      questions = data;
      if (mode !== "review") skSet(SK_MODE_KEY, mode);
      if (mode === "year") {
        // ?start= で肢を指定されたら、そこから始める
        const start = params.get("start");
        if (start && questions.some(q => q.label === start)) {
          skSet(SK_YEAR_START_KEY, start);
          skSet(SK_YEAR_RESUME_KEY, start);
        }
        yearModeFromSelection = Boolean(skGet(SK_YEAR_RESUME_KEY) || skGet(SK_YEAR_START_KEY));
        $("prev-btn").classList.add("hidden");
        $("list-btn").classList.remove("hidden");
        showYearQuestion();
        return;
      }
      if (mode === "review") {
        const labels = todayReviewLabels(questions, learningState);
        list = labels.map(l => questions.find(q => q.label === l)).filter(Boolean);
        $("prev-btn").classList.add("hidden");
      } else {
        list = setQuestions(questions, mode, setKey);
      }
      if (!list.length) {
        if (mode === "review") showReviewDone();
        else showMessage("このセットの問題が見つかりませんでした。");
        return;
      }
      // 途中から再開。?start= があればそこから、無ければ前回の続き
      const start = params.get("start") || skRead(SK_POS_KEY, {})[posKey];
      const i = list.findIndex(q => q.label === start);
      index = i >= 0 ? i : 0;
      showQuestion();
    })
    .catch(() => showMessage("問題データを読み込めませんでした。"));

  function showQuestion() {
    if (mode === "review") {
      // 今日もう答えた肢は飛ばす
      const today = dayString();
      while (index < list.length && getQuestionState(list[index]).reviewDay === today) index += 1;
      if (index >= list.length) { showReviewDone(); return; }
    }
    currentQuestion = list[index];
    savePosition(currentQuestion.label);
    renderQuestion(currentQuestion);
    updateProgress();
  }

  function renderQuestion(q) {
    $("question-number").textContent = dispName(q);  // 穴埋め由来の ✕ 肢は label に答えが出るので disp を見せる
    const chip = $("topic-chip");
    chip.textContent = mode === "chapter" ? q.theme || "" : [q.chapter, q.theme].filter(Boolean).join("・");
    chip.classList.toggle("hidden", !chip.textContent);

    const context = $("q-context");
    context.textContent = q.context || "";
    context.classList.toggle("hidden", !q.context);
    $("question-text").textContent = q.text;

    // 地図を読む問題は、原本のページ画像を問題文の下に。タップで拡大
    const figure = $("q-figure");
    if (q.fig) {
      const img = $("q-figure-img");
      img.src = `fig/${q.fig}.png`;
      img.alt = `${q.fig} の図（問題冊子のページ）`;
      $("q-figure-cap").textContent = "図をタップすると拡大します";
      $("q-figure-src").textContent = skFigSource(q.fig);
      figure.classList.remove("hidden");
    } else {
      figure.classList.add("hidden");
      $("q-figure-img").removeAttribute("src");
    }

    hideVerdict();
    hideExplanation();
    $("choices").classList.remove("hidden");
    document.querySelectorAll(".choice").forEach(b => b.classList.remove("is-answer", "is-miss"));
    $("next-btn").classList.add("hidden");
    $("unknown-btn").classList.remove("hidden");
    isAnswerLocked = false;
    setAnswerControlsDisabled(false);
    loadExplanations(q.year);   // 解答した瞬間に出せるよう先に取っておく

    const isEnd = mode === "year"
      ? yearModeFromSelection && !getNextYearQuestion(q)
      : mode !== "review" && index >= list.length - 1;
    $("next-btn").textContent = isEnd ? "トップに戻る" : "次の問題へ";
    $("prev-btn").disabled = index <= 0;
  }

  function updateProgress() {
    const info = $("progress-info");
    if (mode === "review") {
      const today = dayString();
      const left = list.slice(index).filter(q => getQuestionState(q).reviewDay !== today).length;
      info.textContent = `今日の復習｜残り ${left} 肢`;
      return;
    }
    if (mode === "year") {
      const p = summarize(questions, learningState);
      const pass = getPassCount();
      const shown = pass + (yearPassJustFinished ? 0 : 1);   // 一周し終えた肢の画面では、まだその周のまま
      info.textContent = `年度順モード${pass > 0 ? `（${shown}周目）` : ""}`
        + `｜全${p.total}肢 / 未回答${p.unanswered}肢 / 復習${p.review}肢 / 完了${p.completed}肢`;
      return;
    }
    const s = summarize(list, learningState);
    info.textContent = `${setName(mode, setKey)}｜${index + 1}肢目 / 全${s.total}肢・解いた${s.answered}肢・復習${s.review}肢`;
  }

  function setAnswerControlsDisabled(disabled) {
    document.querySelectorAll(".choice").forEach(b => { b.disabled = disabled; });
    $("unknown-btn").disabled = disabled;
  }

  function showVerdict(kind, mark, message) {
    const verdict = $("verdict");
    verdict.classList.remove("hidden", "is-correct", "is-wrong");
    verdict.classList.add(kind === "correct" ? "is-correct" : "is-wrong");
    const stamp = $("stamp");
    stamp.textContent = mark;
    stamp.style.animation = "none";
    void stamp.offsetWidth;
    stamp.style.animation = "";
    const result = $("result");
    const [head, ...rest] = String(message).split("　");
    result.textContent = head;
    if (rest.length) {
      const detail = document.createElement("span");
      detail.className = "verdict-detail";
      detail.textContent = rest.join("　");
      result.appendChild(detail);
    }
  }

  function hideVerdict() {
    $("verdict").classList.add("hidden");
  }

  function showNextButton(q) {
    $("unknown-btn").classList.add("hidden");
    $("next-btn").classList.remove("hidden");
    document.querySelectorAll(".choice").forEach(b => {
      if (normalizeAnswer(b.dataset.choice) === q.answer) b.classList.add("is-answer");
    });
  }

  function showMessage(message) {
    currentQuestion = null;
    isAnswerLocked = true;
    setAnswerControlsDisabled(true);
    $("question-number").textContent = "";
    $("topic-chip").classList.add("hidden");
    $("q-context").classList.add("hidden");
    $("q-figure").classList.add("hidden");
    $("question-text").textContent = message;
    $("choices").classList.add("hidden");
    $("prev-btn").classList.add("hidden");
    hideVerdict();
    hideExplanation();
  }

  function showReviewDone() {
    const tomorrow = addDays(dayString(), 1);
    const n = questions.filter(q => isDueOn(learningState, q.label, tomorrow)).length;
    showMessage(n > 0 ? `今日の復習は完了です。明日は ${n} 肢です。`
      : "今日の復習は完了です。明日の復習はまだありません。");
    $("progress-info").textContent = "今日の復習｜完了";
  }

  // ===== 解説 =====
  function hideExplanation() {
    const area = $("explanation");
    const toggle = $("exp-toggle");
    toggle.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
    area.classList.add("hidden");
    area.dataset.label = "";
    $("next-btn-bottom").classList.add("hidden");
  }

  function showBottomNextButton() {
    const bottom = $("next-btn-bottom");
    bottom.textContent = $("next-btn").textContent;
    bottom.classList.remove("hidden");
  }

  function openExplanation() {
    const area = $("explanation");
    if (!area.dataset.label) return;
    area.classList.remove("hidden");
    $("exp-toggle").classList.add("hidden");
    $("exp-toggle").setAttribute("aria-expanded", "true");
    showBottomNextButton();
  }

  // 根拠カード。見出し（t）と原文の引用（b）だけ。リンク先の条文ページは持たない
  function buildCard(c) {
    const fig = document.createElement("figure");
    fig.className = "law";
    const cap = document.createElement("figcaption");
    cap.textContent = c.t || "";
    fig.appendChild(cap);
    if (c.b) {
      const p = document.createElement("p");
      p.className = "law-text";
      p.textContent = c.b;
      fig.appendChild(p);
    }
    return fig;
  }

  function fillExplanation(area, exp) {
    area.querySelector(".exp-core").textContent = exp.c || "";
    area.querySelector(".exp-body").textContent = exp.a || "";

    const doctrine = area.querySelector(".exp-doctrine");
    doctrine.textContent = exp.dc || "";
    doctrine.classList.toggle("hidden", !exp.dc);

    const cards = area.querySelector(".exp-cards");
    const cardList = area.querySelector(".exp-cards-list");
    cardList.textContent = "";
    const items = exp.k || [];
    if (items.length) {
      cards.open = false;
      cards.querySelector("summary").textContent = items.length > 1 ? `根拠を見る（${items.length}件）` : "根拠を見る";
      items.forEach(c => cardList.appendChild(buildCard(c)));
      cards.classList.remove("hidden");
    } else {
      cards.classList.add("hidden");
    }

    // 出題当時と今の違い。答えが逆になる肢は出題当時の解答を先に置く
    const superseded = area.querySelector(".exp-superseded");
    if (exp.s) {
      superseded.textContent = exp.s.a && exp.s.a !== exp.v ? `出題当時の解答は${exp.s.a}。${exp.s.n || ""}` : exp.s.n || "";
      superseded.classList.toggle("hidden", !superseded.textContent);
    } else {
      superseded.classList.add("hidden");
    }
  }

  // 間違えたら開き、正解なら閉じておく（調査士アプリと同じ）
  function showExplanation(q, shouldOpen) {
    const area = $("explanation");
    const label = q.label;
    loadExplanations(q.year).then(map => {
      const exp = map && map[label];
      if (!currentQuestion || currentQuestion.label !== label) return;
      if (!exp) {
        area.textContent = "";
        const p = document.createElement("p");
        p.className = "exp-core";
        p.textContent = map ? "この肢の解説はまだありません。" : "解説を読み込めませんでした。";
        area.appendChild(p);
      } else {
        area.textContent = "";
        area.appendChild($("exp-template").content.cloneNode(true));
        fillExplanation(area, exp);
      }
      area.dataset.label = label;
      if (shouldOpen) {
        area.classList.remove("hidden");
        showBottomNextButton();
      } else {
        $("exp-toggle").classList.remove("hidden");
      }
    });
  }

  // ===== 解答 =====
  function verdictMessage(result, previous, next) {
    const later = "次は明日以降に出題されます";
    if (mode !== "review") return result === "correct" ? "正解" : "不正解　明日以降の復習に出題されます";
    if (result !== "correct") return `不正解　${later}`;
    const wasTarget = ["wrong", "unknown"].includes(previous.lastResult);
    if (wasTarget && next.lastResult === "correct") return "正解　復習から消えました";
    if (wasTarget) return `正解　あと ${REVIEW_GRADUATE_HITS - next.hits} 回正解すると復習から消えます。${later}`;
    return "正解";
  }

  function afterAnswer() {
    // 次に開いたとき、答えた肢の次から始まるように
    if (mode === "year") advanceYearModeResume(currentQuestion);
    else if (mode === "chapter" && index + 1 < list.length) savePosition(list[index + 1].label);
  }

  function handleAnswer(choice) {
    if (!currentQuestion || isAnswerLocked) return;
    isAnswerLocked = true;
    setAnswerControlsDisabled(true);
    const selected = normalizeAnswer(choice);
    const result = selected === currentQuestion.answer ? "correct" : "wrong";
    const previous = getQuestionState(currentQuestion);
    const next = setQuestionResult(currentQuestion, result);
    afterAnswer();
    showVerdict(result, result === "correct" ? "◯" : "✕", verdictMessage(result, previous, next));
    if (result === "wrong") {
      document.querySelectorAll(".choice").forEach(b => {
        if (normalizeAnswer(b.dataset.choice) === selected) b.classList.add("is-miss");
      });
    }
    showNextButton(currentQuestion);
    showExplanation(currentQuestion, result === "wrong");
    updateProgress();
  }

  function handleUnknown() {
    if (!currentQuestion || isAnswerLocked) return;
    isAnswerLocked = true;
    setAnswerControlsDisabled(true);
    setQuestionResult(currentQuestion, "unknown");
    afterAnswer();
    showVerdict("unknown", currentQuestion.answer,
      mode === "review" ? "復習に入れました　次は明日以降に出題されます" : "復習に入れました　明日以降の復習に出題されます");
    showNextButton(currentQuestion);
    showExplanation(currentQuestion, true);
    updateProgress();
  }

  function goNext() {
    if (!currentQuestion) return;
    if (mode === "year") {
      showYearQuestion();
      return;
    }
    if (mode !== "review" && index >= list.length - 1) {
      window.location.href = "index.html";
      return;
    }
    index += 1;
    showQuestion();
  }

  function goPrev() {
    if (mode !== "chapter" || index <= 0) return;
    index -= 1;
    showQuestion();
  }

  // ===== 図の拡大 =====
  function openZoom() {
    const img = $("q-figure-img");
    if (!img.getAttribute("src")) return;
    $("fig-zoom-img").src = img.src;
    $("fig-zoom-img").alt = img.alt;
    $("fig-zoom-src").textContent = $("q-figure-src").textContent;
    $("fig-zoom").classList.remove("hidden");
    document.body.classList.add("no-scroll");
    $("fig-zoom-close").focus();
  }

  function closeZoom() {
    $("fig-zoom").classList.add("hidden");
    document.body.classList.remove("no-scroll");
  }

  document.querySelectorAll(".choice").forEach(b => b.addEventListener("click", () => handleAnswer(b.dataset.choice)));
  $("unknown-btn").addEventListener("click", handleUnknown);
  $("next-btn").addEventListener("click", goNext);
  $("next-btn-bottom").addEventListener("click", () => { window.scrollTo(0, 0); goNext(); });
  $("prev-btn").addEventListener("click", goPrev);
  $("exp-toggle").addEventListener("click", openExplanation);
  $("home-btn").addEventListener("click", () => { window.location.href = "index.html"; });
  $("list-btn").addEventListener("click", () => { window.location.href = "question-list.html"; });
  $("q-figure-img").addEventListener("click", openZoom);
  $("q-figure-zoom").addEventListener("click", openZoom);
  $("fig-zoom-close").addEventListener("click", closeZoom);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("fig-zoom").classList.contains("hidden")) closeZoom(); });
}
