// sitemap.xml を、実際に置いてあるHTMLから作り直す。
//
//   node build_sitemap.js
//
// ページを増やしたり減らしたりしたら、これを流せばよい。手で足す必要はない。
// 各ページの <link rel="canonical"> を URL の正としているので、
// sitemap と canonical が食い違うことがない（食い違うと検索エンジンに無視される）。
const fs = require('fs');
const path = require('path');

const SITE = 'https://cholabo.jp';   // 公開先。CNAME がこのドメインを指している。
// github.io は 301 でここへ飛ぶので、canonical をそちらにすると「301の先」を正としてしまう。
const ROOT = __dirname;

// クイズ本体と問題一覧は、中身を JavaScript で組み立てる操作画面なので載せない。
// 検索から直接来ても読むものが無く、canonical も持たせていない。
const EXCLUDE = new Set(['quiz.html', 'question-list.html']);

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;  // .backup など
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.html') || entry.name.startsWith('_')) continue;
    // Search Console の所有権確認ファイル。中身は1行で、読むものが無い
    if (/^google[0-9a-f]+\.html$/.test(entry.name)) continue;

    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (EXCLUDE.has(rel)) continue;

    const html = fs.readFileSync(full, 'utf-8');
    if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) continue;

    // canonical があればそれを使う。無ければ置き場所から組み立てる。
    const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const loc = m ? m[1] : SITE + '/' + rel.replace(/(^|\/)index\.html$/, '$1');

    const mtime = fs.statSync(full).mtime;
    const lastmod = new Date(mtime.getTime() - mtime.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
    pages.push({ loc, lastmod, rel });
  }
})(ROOT);

// 並び順：トップ → 単独ページ → 階層の浅い順・名前順。差分を読みやすくするためだけの整列。
const rank = p => (p.loc === SITE + '/' ? 0 : p.rel.includes('/') ? 2 : 1);
pages.sort((a, b) => rank(a) - rank(b)
  || a.rel.split('/').length - b.rel.split('/').length
  || a.rel.localeCompare(b.rel, 'en'));

const seen = new Set();
const lines = [];
for (const p of pages) {
  if (seen.has(p.loc)) {
    console.warn('canonical が重複しています:', p.rel, '→', p.loc);
    continue;
  }
  seen.add(p.loc);
  lines.push(`  <url><loc>${p.loc}</loc><lastmod>${p.lastmod}</lastmod></url>`);
}

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  lines.join('\n') + '\n</urlset>\n', 'utf-8');

const group = {};
for (const p of pages) group[p.rel.split('/')[0].replace(/\.html$/, '（単独ページ）')] =
  (group[p.rel.split('/')[0].replace(/\.html$/, '（単独ページ）')] || 0) + 1;
console.log('sitemap.xml:', lines.length, 'URL');
for (const [k, v] of Object.entries(group)) console.log('  ' + k + ': ' + v);
