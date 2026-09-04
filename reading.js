// 読むだけの問。data/reading.json の1件を ?q=ラベル で表示する。出題には関わらない。
(function () {
  const label = new URLSearchParams(window.location.search).get("q");
  const body = document.getElementById("reading-body");
  const nav = document.getElementById("reading-nav");

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  fetch("data/reading.json")
    .then(response => (response.ok ? response.json() : []))
    .then(items => {
      if (!Array.isArray(items) || items.length === 0) {
        body.textContent = "読む問がありません。";
        return;
      }
      const index = items.findIndex(item => item.label === label);
      if (index < 0) {
        // 指定が無ければ一覧を出す
        body.replaceChildren();
        body.appendChild(el("h3", null, "問を選んでください"));
        const ul = el("ul", "reading-list");
        items.forEach(item => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = "reading.html?q=" + encodeURIComponent(item.label);
          a.textContent = `${item.label}　${item.title || ""}`;
          li.appendChild(a);
          ul.appendChild(li);
        });
        body.appendChild(ul);
        return;
      }
      const item = items[index];
      document.title = `${item.label} ${item.title || ""}｜土地家屋調査士 過去問アプリ`;
      document.getElementById("reading-title").textContent = `${item.label}　${item.title || ""}`;

      body.replaceChildren();
      body.appendChild(el("p", "reading-lead", item.lead || ""));
      if (item.passage) body.appendChild(el("p", "reading-passage", item.passage));
      if (item.figure && item.figure.src) {
        const fig = el("figure", "q-figure");
        const img = document.createElement("img");
        img.src = item.figure.src;
        img.alt = item.figure.cap || "図";
        fig.appendChild(img);
        fig.appendChild(el("figcaption", null, item.figure.cap || ""));
        body.appendChild(fig);
      }
      if (item.words) body.appendChild(el("p", "reading-words", item.words));
      if (Array.isArray(item.options)) {
        const ul = el("ul", "reading-options");
        item.options.forEach(text => ul.appendChild(el("li", null, text)));
        body.appendChild(ul);
      }
      const ans = el("details", "reading-answer");
      ans.appendChild(el("summary", null, "正解を見る"));
      ans.appendChild(el("p", null, `正解　${item.answer || ""}` + (item.note ? `　／　${item.note}` : "")));
      body.appendChild(ans);

      // 前後の問へ
      nav.replaceChildren();
      const prev = items[index - 1];
      const next = items[index + 1];
      if (prev) {
        const a = document.createElement("a");
        a.className = "secondary-btn";
        a.href = "reading.html?q=" + encodeURIComponent(prev.label);
        a.textContent = `← ${prev.label}`;
        nav.appendChild(a);
      }
      if (next) {
        const a = document.createElement("a");
        a.className = "secondary-btn";
        a.href = "reading.html?q=" + encodeURIComponent(next.label);
        a.textContent = `${next.label} →`;
        nav.appendChild(a);
      }
    })
    .catch(() => {
      body.textContent = "読み込めませんでした。";
    });
})();
