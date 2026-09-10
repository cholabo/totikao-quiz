// 電車の中など電波の無いところでも開けるようにするためのキャッシュ。
// ページ本体は「まずネットワーク、だめならキャッシュ」。更新がすぐ届く。
// 問題データ・解説・資料は「まずキャッシュ、裏で更新」。2回目以降は即表示になる。
// CACHE_VERSION を上げると古いキャッシュを捨てて入れ替わる。
const CACHE_VERSION = "v45-20260910b";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const DATA_CACHE = `data-${CACHE_VERSION}`;
const FONT_CACHE = "fonts-v1";   // 書体は版に紐づけず、取れたものを残す

// 起動に必要な最小限。解説（data/exp-*.json）は使った年度から順に貯まる。
const SHELL_FILES = [
  "./",
  "./index.html",
  "./quiz.html",
  "./question-list.html",
  "./style.css?v=7.9",
  "./common.js?v=1.6",
  "./script.js?v=4.10",
  "./question-list.js?v=2.4",
  "./backup.html",
  "./restore.html",
  "./backup.js?v=1.0",
  "./about.html",
  "./privacy.html",
  "./reading.html",
  "./reading.js?v=1.0",
  "./data/reading.json",
  "./sources.html",
  "./sources.js?v=2.0",
  "./sources.json",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./data/topics.json",
  "./questions.json?v=20260910a"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // 1つ失敗しても全体を巻き添えにしない
      .then(cache => Promise.allSettled(SHELL_FILES.map(file => cache.add(file))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => ![SHELL_CACHE, DATA_CACHE, FONT_CACHE].includes(name))
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function isDataRequest(url) {
  return url.pathname.endsWith("/questions.json")
    || url.pathname.includes("/data/")
    || url.pathname.endsWith("/sources.json");
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 書体は取れたら残しておく。オフラインでも明朝と角ゴのまま開ける。
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache => cache.match(request).then(hit => hit || fetch(request)
        .then(response => {
          // @import で取る fonts.googleapis.com の CSS は opaque（ok が false）で返るので、それも残す
          if (response.ok || response.type === "opaque") cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit || Response.error())))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;   // アクセス解析などは素通しする

  // 画面遷移：新しい版があればそちらを見せ、オフラインならキャッシュから
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {                       // 404 の頁は残さない
            const copy = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        // ?mode=review のようなクエリ付きでも同じ頁に当たるように ignoreSearch
        .catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // 問題・解説・資料：キャッシュがあれば即返し、裏で新しいものを取っておく
  if (isDataRequest(url)) {
    event.respondWith(
      caches.open(DATA_CACHE).then(cache => cache.match(request).then(hit => {
        const network = fetch(request)
          .then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => hit || Response.error());
        return hit || network;
      }))
    );
    return;
  }

  // CSS・JS・画像：キャッシュ優先（?v= を変えれば別のURLになるので更新は届く）
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
