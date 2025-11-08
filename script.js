let questions = [];
let wrongList = JSON.parse(localStorage.getItem("wrongList") || "[]");
let usedQuestions = JSON.parse(localStorage.getItem("usedQuestions") || "[]");
let currentQuestion = null;
let cycleCount = parseInt(localStorage.getItem("cycleCount") || "1");
let lastCopiedWrong = JSON.parse(localStorage.getItem("lastCopiedWrong") || "[]");

// JSON読み込み
fetch("questions.json")
  .then(res => res.json())
  .then(data => {
    questions = data;
    newQuestion();
  });

// ランダムに1問表示
function newQuestion() {
  const available = questions.filter(q => !usedQuestions.includes(q.id));

  if (available.length === 0) {
    alert("全問終了！第" + cycleCount + "周を完了しました。");
    cycleCount++;
    localStorage.setItem("cycleCount", cycleCount);
    usedQuestions = [];
    wrongList = [];
    localStorage.setItem("usedQuestions", JSON.stringify(usedQuestions));
    localStorage.setItem("wrongList", JSON.stringify(wrongList));
    newQuestion();
    return;
  }

  currentQuestion = available[Math.floor(Math.random() * available.length)];
  usedQuestions.push(currentQuestion.id);
  localStorage.setItem("usedQuestions", JSON.stringify(usedQuestions));

  document.getElementById("question-number").textContent =
    "【" + currentQuestion.label + "】";
  document.getElementById("question-text").textContent = currentQuestion.text;
  document.getElementById("result").textContent = "";
  document.getElementById("next-btn").classList.add("hidden");

  updateProgress();
}

// 回答クリック
document.querySelectorAll(".choice").forEach(btn => {
  btn.addEventListener("click", () => handleAnswer(btn.dataset.choice));
});

// 「？」ボタン（わからない）
document.getElementById("unknown-btn").addEventListener("click", () => {
  handleAnswer("？");
});

// 「間違えた問題をコピー」
document.getElementById("copy-btn").addEventListener("click", () => {
  // 前回コピー以降の新しい誤答のみ抽出
  const newWrong = wrongList.filter(id => !lastCopiedWrong.includes(id));

  if (newWrong.length === 0) {
    alert("前回以降に新しく間違えた問題はありません。");
    return;
  }

  const copyText = newWrong
    .map(id => {
      const q = questions.find(q => q.id === id);
      return q ? q.label : "";
    })
    .join("\n");

  navigator.clipboard.writeText(copyText).then(() => {
    alert(`${newWrong.length}件の問題をコピーしました。`);
    lastCopiedWrong = [...new Set([...lastCopiedWrong, ...newWrong])];
    localStorage.setItem("lastCopiedWrong", JSON.stringify(lastCopiedWrong));
  });
});

// 回答処理
function handleAnswer(userChoice) {
  const correct = currentQuestion.answer;

  if (userChoice === correct) {
    document.getElementById("result").textContent = "✅ 正解！";
    wrongList = wrongList.filter(id => id !== currentQuestion.id);
  } else {
    document.getElementById("result").textContent = "❌ 不正解";
    if (!wrongList.includes(currentQuestion.id)) wrongList.push(currentQuestion.id);
  }

  localStorage.setItem("wrongList", JSON.stringify(wrongList));
  document.getElementById("next-btn").classList.remove("hidden");
  updateProgress();
}

// 次の問題
document.getElementById("next-btn").addEventListener("click", () => {
  newQuestion();
});

// 進捗表示
function updateProgress() {
  const total = questions.length;
  const correctCount = usedQuestions.filter(id => !wrongList.includes(id)).length;

  document.getElementById("progress-info").textContent =
    "第" + cycleCount + "周　" + correctCount + " / " + total + "問";
}
