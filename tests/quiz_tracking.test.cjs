const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.join(__dirname, "..");
const appRoot = fs.existsSync(path.join(projectRoot, "app", "script.js"))
  ? path.join(projectRoot, "app")
  : projectRoot;
const scriptSource = fs.readFileSync(path.join(appRoot, "script.js"), "utf8");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.disabled = false;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  fire(type) {
    for (const callback of this.listeners.get(type) || []) callback({ currentTarget: this });
  }
}

class FakeStorage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const questions = [
  { label: "R2-1-ア", year: "R2", questionNo: 1, choice: "ア", context: "条件", text: "問題ア", answer: "◯" },
  { label: "R2-1-イ", year: "R2", questionNo: 1, choice: "イ", context: "条件", text: "問題イ", answer: "✕" },
  { label: "R2-1-ウ", year: "R2", questionNo: 1, choice: "ウ", context: "条件", text: "問題ウ", answer: "◯" }
];

const elementIds = [
  "timer-bar", "timer-display", "unknown-btn", "controls", "progress-info", "list-btn",
  "question-number", "question-text", "result", "choices", "next-btn", "home-btn",
  "ta-home-btn", "copy-ta-wrong-btn", "share-x-btn", "quiz-container", "final-result-area",
  "score-correct", "score-wrong"
];

async function createHarness({ mode = "year", search = "", state = {}, withGtag = true } = {}) {
  const elements = Object.fromEntries(elementIds.map(id => [id, new FakeElement(id)]));
  const circle = new FakeElement("circle");
  circle.dataset.choice = "◯";
  const cross = new FakeElement("cross");
  cross.dataset.choice = "✕";
  const choices = [circle, cross];
  const storage = new FakeStorage({
    quizMode: mode,
    learningStateByLabel: JSON.stringify(state)
  });
  const sentEvents = [];
  let now = 500;

  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = new FakeElement(id);
      return elements[id];
    },
    querySelectorAll(selector) {
      return selector === ".choice" ? choices : [];
    }
  };
  const window = {
    location: { search, href: "" },
    performance: { now: () => (now += 500) },
    open() {}
  };
  if (withGtag) {
    window.gtag = (command, eventName, parameters) => {
      if (command === "event" && eventName === "quiz_answer") sentEvents.push(parameters);
    };
  }

  const context = vm.createContext({
    window,
    document,
    localStorage: storage,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(questions) }),
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    alert: () => {}
  });

  vm.runInContext(scriptSource, context, { filename: "script.js" });
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  return { elements, circle, cross, storage, sentEvents };
}

(async () => {
  // 年度順・SEOページから指定問題開始・ダブルクリック防止
  const year = await createHarness({ search: "?start=R2-1-%E3%82%A2" });
  assert.equal(year.elements["question-number"].textContent, "【R2-1-ア】");
  year.cross.fire("click");
  year.cross.fire("click");
  assert.equal(year.sentEvents.length, 1, "同じ回答操作でイベントは最大1回");
  assert.deepEqual(
    Object.keys(year.sentEvents[0]).sort(),
    [
      "answer_result", "attempt_number", "choice", "is_first_attempt", "question_label",
      "question_no", "quiz_mode", "response_time_ms", "review_correct_streak",
      "selected_answer", "session_question_index", "year"
    ].sort()
  );
  assert.equal(year.sentEvents[0].question_label, "R2-1-ア");
  assert.equal(year.sentEvents[0].answer_result, "wrong");
  assert.equal(year.sentEvents[0].selected_answer, "cross");
  assert.equal(year.sentEvents[0].quiz_mode, "year");
  assert.equal(year.sentEvents[0].attempt_number, 1);
  assert.equal(year.sentEvents[0].is_first_attempt, 1);
  assert.equal(year.sentEvents[0].session_question_index, 1);
  assert.ok(year.sentEvents[0].response_time_ms >= 0 && year.sentEvents[0].response_time_ms <= 3600000);
  const savedYearState = JSON.parse(year.storage.getItem("learningStateByLabel"))["R2-1-ア"];
  assert.equal(savedYearState.attempts, year.sentEvents[0].attempt_number);
  assert.equal(savedYearState.wrongCount, 1);
  assert.equal(year.circle.disabled, true);
  assert.equal(year.cross.disabled, true);

  // 「分からない」
  const unknown = await createHarness({ search: "?start=R2-1-%E3%82%A2" });
  unknown.elements["unknown-btn"].fire("click");
  unknown.elements["unknown-btn"].fire("click");
  assert.equal(unknown.sentEvents.length, 1);
  assert.equal(unknown.sentEvents[0].answer_result, "unknown");
  assert.equal(unknown.sentEvents[0].selected_answer, "unknown");

  // 復習モードでは保存前のattemptsから初回判定し、回答後の連続正解数を送る
  const review = await createHarness({
    mode: "review",
    state: {
      "R2-1-ア": {
        attempts: 1,
        correctCount: 0,
        wrongCount: 1,
        lastResult: "wrong",
        lastAnsweredAt: "2026-01-01T00:00:00.000Z",
        reviewCorrectStreak: 0
      }
    }
  });
  review.circle.fire("click");
  assert.equal(review.sentEvents.length, 1);
  assert.equal(review.sentEvents[0].quiz_mode, "review");
  assert.equal(review.sentEvents[0].attempt_number, 2);
  assert.equal(review.sentEvents[0].is_first_attempt, 0);
  assert.equal(review.sentEvents[0].review_correct_streak, 1);
  const savedReviewState = JSON.parse(review.storage.getItem("learningStateByLabel"))["R2-1-ア"];
  assert.equal(savedReviewState.attempts, review.sentEvents[0].attempt_number);
  assert.equal(savedReviewState.reviewCorrectStreak, review.sentEvents[0].review_correct_streak);

  // タイムアタックは即時切替を保ちつつ、同期的な連打を重複回答にしない
  const timeattack = await createHarness({ mode: "timeattack" });
  timeattack.circle.fire("click");
  timeattack.circle.fire("click");
  assert.equal(timeattack.sentEvents.length, 1);
  assert.equal(timeattack.sentEvents[0].quiz_mode, "timeattack");
  await new Promise(resolve => setTimeout(resolve, 5));

  // gtagが存在しなくても回答・画面表示は継続
  const blocked = await createHarness({ search: "?start=R2-1-%E3%82%A2", withGtag: false });
  blocked.circle.fire("click");
  assert.match(blocked.elements.result.textContent, /正解/);
  assert.equal(blocked.circle.disabled, true);

  console.log("quiz tracking tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
