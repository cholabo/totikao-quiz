#!/usr/bin/env python3
"""questions.json から検索エンジン向けの静的過去問ページを生成する。"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
from collections import defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import quote, urljoin


# 公開先を変更した場合は、ここを書き換えて再生成してください。
# CNAME が cholabo.jp を指しているので、canonical はこちら。
# github.io は 301 でここへ飛ぶため、そちらを canonical にすると「301の先」を正としてしまう。
DEFAULT_SITE_URL = "https://cholabo.jp/"

# style.css の版。アプリ側の quiz.html などと揃える（キャッシュを踏まないため）
CSS_VERSION = "6.9"

ROOT_DIR = Path(__file__).resolve().parents[1]
APP_DIR = ROOT_DIR / "app" if (ROOT_DIR / "app" / "questions.json").exists() else ROOT_DIR
QUESTIONS_PATH = APP_DIR / "questions.json"
OUTPUT_DIR = APP_DIR / "kakomon"
TOPIC_DIR = APP_DIR / "bunya"
DATA_DIR = APP_DIR / "data"

# 分野。data/topics.json の値 → URL のスラッグと説明文
TOPICS: dict[str, tuple[str, str]] = {
    "土地": ("tochi", "分筆・合筆・地目・地積など、土地の表示に関する登記"),
    "建物": ("tatemono", "建物の認定・表題登記・分割・合併・床面積など、建物の表示に関する登記"),
    "区分建物": ("kubun", "敷地権・共用部分・一棟の建物など、区分建物に関する登記"),
    "民法": ("minpo", "物権変動・共有・代理・時効・相続など、試験で問われる民法"),
    "総論": ("souron", "申請手続・添付情報・登記識別情報・登記記録など、登記の総論"),
    "調査士法": ("chousashi", "土地家屋調査士・調査士法人の業務、登録、懲戒"),
    "筆界特定": ("hikkai", "筆界特定の申請・手続・筆界特定書"),
    "審査請求": ("shinsa", "登記官の処分に対する審査請求"),
}


def esc(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def truncate(value: object, length: int = 112) -> str:
    text = clean_text(value)
    return text if len(text) <= length else text[: length - 1].rstrip() + "…"


def year_order(year: str) -> int:
    match = re.fullmatch(r"H(\d+)", year, re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.fullmatch(r"R(\d+)", year, re.IGNORECASE)
    if match:
        return 100 + int(match.group(1))
    return 999


def year_name(year: str) -> str:
    match = re.fullmatch(r"H(\d+)", year, re.IGNORECASE)
    if match:
        return f"平成{match.group(1)}年度"
    match = re.fullmatch(r"R(\d+)", year, re.IGNORECASE)
    if match:
        return f"令和{match.group(1)}年度"
    return year


def year_slug(year: str) -> str:
    return year.lower()


def absolute_url(site_url: str, path: str) -> str:
    return urljoin(site_url, path.lstrip("/"))


def breadcrumb_json(items: list[tuple[str, str]]) -> str:
    data = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": index,
                "name": name,
                "item": url,
            }
            for index, (name, url) in enumerate(items, 1)
        ],
    }
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def page_shell(
    *,
    title: str,
    description: str,
    canonical: str,
    css_href: str,
    favicon_href: str,
    breadcrumbs: list[tuple[str, str, str]],
    breadcrumb_ld: list[tuple[str, str]],
    content: str,
    site_url: str = DEFAULT_SITE_URL,
    extra_ld: str = "",
) -> str:
    breadcrumb_html = "\n".join(
        f'<li><a href="{esc(href)}">{esc(name)}</a></li>' if index < len(breadcrumbs) - 1
        else f'<li aria-current="page">{esc(name)}</li>'
        for index, (name, href, _url) in enumerate(breadcrumbs)
    )
    # フッターから about.html / privacy.html へ戻る相対パス。css_href と同じ深さ
    prefix = css_href[: -len("style.css")] if css_href.endswith("style.css") else ""
    og_image = absolute_url(site_url, "ogimage.png")
    extra = f'\n  <script type="application/ld+json">{extra_ld}</script>' if extra_ld else ""
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(description)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="{esc(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="土地家屋調査士 過去問アプリ">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(description)}">
  <meta property="og:url" content="{esc(canonical)}">
  <meta property="og:image" content="{esc(og_image)}">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="{esc(og_image)}">
  <link rel="stylesheet" href="{esc(css_href)}?v={CSS_VERSION}">
  <link rel="icon" href="{esc(favicon_href)}" type="image/x-icon">
  <script type="application/ld+json">{breadcrumb_json(breadcrumb_ld)}</script>{extra}
</head>
<body>
  <main class="seo-page">
    <nav class="breadcrumbs" aria-label="パンくずリスト">
      <ol>
        {breadcrumb_html}
      </ol>
    </nav>
{content}
    <footer class="seo-footer">
      <p>掲載している過去問は、法務省「土地家屋調査士試験」の試験問題に基づきます。問題文の著作権は法務省に帰属します。</p>
      <p>本サイトは個人の学習支援を目的とした非公式サイトであり、法務省その他の公的機関とは関係ありません。<br><a href="{prefix}about.html">このサイトについて・免責事項</a>　/　<a href="{prefix}privacy.html">プライバシー</a></p>
    </footer>
  </main>
</body>
</html>
"""


# ── 解説 ──────────────────────────────────────────────────────────────
# data/exp-<年度>.json は、アプリのクイズ画面が JavaScript で描いているデータ。
# つまり検索エンジンには見えていない。ここに置くことで、2,025肢ぶんの解説が
# 初めて索引の対象になる。
#
# 条文の本文はここには置かない。同じ条文が何百ページにも展開されると薄いページの
# 量産に見えるうえ、条文の正本は jobun/ のページだから。見出しとリンクだけを出して
# そちらへ送る（jobun から kakomon へのリンクは既にあるので、これで双方向になる）。
def load_explanations() -> dict[str, dict]:
    out: dict[str, dict] = {}
    index_path = DATA_DIR / "exp-index.json"
    if not index_path.exists():
        return out
    for year in json.loads(index_path.read_text(encoding="utf-8")).get("years", []):
        path = DATA_DIR / f"exp-{year}.json"
        if path.exists():
            out.update(json.loads(path.read_text(encoding="utf-8")))
    return out


def load_topics() -> dict[str, str]:
    path = DATA_DIR / "topics.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def ref_links(exp: dict, prefix: str) -> str:
    """条文カードと関連法令の見出しを、資料ページへのリンクの並びにする。"""
    seen: set[str] = set()
    chips: list[str] = []
    for entry in list(exp.get("k") or []) + list(exp.get("r") or []):
        title = clean_text(entry.get("t"))
        if not title or title in seen:
            continue
        seen.add(title)
        href = entry.get("u")
        if not href and entry.get("s"):
            query = f"?p={quote(entry['h'])}" if entry.get("h") else ""
            href = f"sources.html{query}#{entry['s']}"
        if href and not href.startswith("http"):
            href = prefix + href
        chips.append(
            f'<a class="seo-ref" href="{esc(href)}">{esc(title)}</a>' if href
            else f'<span class="seo-ref is-plain">{esc(title)}</span>'
        )
    if not chips:
        return ""
    return f'<p class="seo-refs"><span class="seo-refs-label">根拠</span>{"".join(chips)}</p>'


def explanation_html(exp: dict | None, prefix: str) -> str:
    if not exp:
        return ""
    parts = []
    if exp.get("c"):
        parts.append(f'<p class="seo-exp-core">{esc(exp["c"])}</p>')
    if exp.get("n", {}).get("c"):
        parts.append(f'<p class="seo-exp-norule">{esc(exp["n"]["c"])}</p>')
    if exp.get("dc"):
        parts.append(f'<p class="seo-exp-doctrine">{esc(exp["dc"])}</p>')
    if exp.get("a"):
        parts.append(f'<p class="seo-exp-body">{esc(exp["a"])}</p>')
    if exp.get("s"):
        # 答えが逆になる肢は出題当時の解答を先に置く。
        # 答えは変わらないが問題文の文言を直した肢もここに来るので、そのときは注記だけ。
        sup = exp["s"]
        head = f'出題当時の解答は{esc(sup.get("a"))}。' if sup.get("a") and sup.get("a") != exp.get("v") else ""
        parts.append(
            '<p class="seo-exp-sup"><strong>出題当時と現行法：</strong>'
            f'{head}{esc(sup.get("n"))}</p>'
        )
    if exp.get("rn"):
        parts.append('<p class="seo-exp-note">根拠にした通達・先例の原文には、当たれていない部分があります。</p>')
    links = ref_links(exp, prefix)
    if links:
        parts.append(links)
    if not parts:
        return ""
    return '        <div class="seo-explanation">\n          ' + "\n          ".join(parts) + "\n        </div>"


def quiz_json(display_year: str, number: int, items: list[dict], explanations: dict[str, dict]) -> str:
    """練習問題の構造化データ。◯✕なので選択肢は二つ。"""
    parts = []
    for item in items:
        label = clean_text(item.get("label"))
        exp = explanations.get(label) or {}
        correct = "正しい" if clean_text(item.get("answer")) in {"○", "◯", "〇"} else "誤り"
        wrong = "誤り" if correct == "正しい" else "正しい"
        answer: dict[str, object] = {"@type": "Answer", "text": correct}
        detail = " ".join(x for x in [clean_text(exp.get("c")), clean_text(exp.get("a"))] if x)
        if detail:
            answer["answerExplanation"] = {"@type": "Comment", "text": detail}
        parts.append({
            "@type": "Question",
            "eduQuestionType": "Multiple choice",
            "name": clean_text(item.get("text")),
            "acceptedAnswer": answer,
            "suggestedAnswer": [{"@type": "Answer", "text": wrong}],
        })
    data = {
        "@context": "https://schema.org",
        "@type": "Quiz",
        "name": f"土地家屋調査士 {display_year} 過去問 問{number}",
        "about": {"@type": "Thing", "name": "土地家屋調査士試験"},
        "educationalLevel": "professional certification",
        "hasPart": parts,
    }
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def group_questions(rows: list[dict]) -> dict[str, dict[int, list[dict]]]:
    grouped: dict[str, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        grouped[str(row["year"])][int(row["questionNo"])].append(row)
    return grouped


def question_sort_key(row: dict) -> tuple[int, int, int, str]:
    choice_order = ["ア", "イ", "ウ", "エ", "オ", "1", "2", "3", "4", "5", "①", "②", "③", "④", "⑤"]
    choice = clean_text(row.get("choice"))
    choice_index = choice_order.index(choice) if choice in choice_order else 999
    return (year_order(str(row.get("year", ""))), int(row.get("questionNo", 0)), choice_index, str(row.get("label", "")))


def render_archive_index(site_url: str, grouped: dict[str, dict[int, list[dict]]]) -> None:
    canonical = absolute_url(site_url, "kakomon/")
    cards = []
    for year in sorted(grouped, key=year_order, reverse=True):
        questions = grouped[year]
        choice_count = sum(len(items) for items in questions.values())
        cards.append(
            f'<li><a href="{year_slug(year)}/"><strong>{esc(year_name(year))}</strong>'
            f'<span>{len(questions)}問・全{choice_count}肢</span></a></li>'
        )
    content = f"""    <header class="seo-header">
      <p class="seo-eyebrow">無料で学べる年度別アーカイブ</p>
      <h1>土地家屋調査士 過去問・解答一覧</h1>
      <p>土地家屋調査士試験の過去問を年度別に掲載しています。各問題は問題文と全ての肢、○×の解答を初期表示するため、確認したい文章から直接探せます。</p>
    </header>
    <section aria-labelledby="year-list-heading">
      <h2 id="year-list-heading">年度を選ぶ</h2>
      <ul class="seo-year-grid">{''.join(cards)}</ul>
    </section>
    <div class="seo-cta-row">
      <a class="seo-primary-link" href="../question-list.html">クイズ形式で学習する</a>
      <a class="seo-secondary-link" href="all-questions.html">全問題を一ページで見る</a>
      <a class="seo-secondary-link" href="../index.html">アプリのトップへ</a>
    </div>"""
    breadcrumbs = [
        ("トップ", "../index.html", absolute_url(site_url, "")),
        ("年度別過去問", "", canonical),
    ]
    output = page_shell(
        title="土地家屋調査士 過去問・解答一覧【無料】",
        description="土地家屋調査士試験の過去問と○×解答を年度別に無料掲載。平成17年度から令和7年度まで、各問の全肢を確認してクイズ学習もできます。",
        canonical=canonical,
        css_href="../style.css",
        favicon_href="../favicon.ico",
        breadcrumbs=breadcrumbs,
        breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
        content=content,
    )
    (OUTPUT_DIR / "index.html").write_text(output, encoding="utf-8", newline="\n")


def render_all_questions_page(site_url: str, grouped: dict[str, dict[int, list[dict]]]) -> None:
    canonical = absolute_url(site_url, "kakomon/all-questions.html")
    sections = []
    total_questions = 0
    for year in sorted(grouped, key=year_order, reverse=True):
        slug = year_slug(year)
        links = []
        for number in sorted(grouped[year]):
            items = sorted(grouped[year][number], key=question_sort_key)
            preview = items[0].get("context") or items[0].get("text") or ""
            links.append(
                f'<li><a href="{slug}/q{number}/"><span class="seo-question-number">問{number}</span>'
                f'<span class="seo-question-preview">{esc(truncate(preview, 72))}</span>'
                f'<span class="seo-choice-count">全{len(items)}肢</span></a></li>'
            )
            total_questions += 1
        sections.append(f"""    <section aria-labelledby="{slug}-heading">
      <h2 id="{slug}-heading"><a href="{slug}/">{esc(year_name(year))}</a></h2>
      <ul class="seo-question-list">{''.join(links)}</ul>
    </section>""")

    content = f"""    <header class="seo-header">
      <p class="seo-eyebrow">検索エンジンと学習者向けの全問索引</p>
      <h1>土地家屋調査士 過去問 全問題一覧</h1>
      <p>平成17年度から令和7年度までの全{total_questions}問を一ページにまとめています。年度と問題番号から、問題文・各肢・○×解答のページへ直接移動できます。</p>
    </header>
{chr(10).join(sections)}
    <div class="seo-cta-row">
      <a class="seo-primary-link" href="./">年度別過去問へ戻る</a>
      <a class="seo-secondary-link" href="../index.html">アプリのトップへ</a>
    </div>"""
    breadcrumbs = [
        ("トップ", "../index.html", absolute_url(site_url, "")),
        ("年度別過去問", "./", absolute_url(site_url, "kakomon/")),
        ("全問題一覧", "", canonical),
    ]
    output = page_shell(
        title="土地家屋調査士 過去問 全問題一覧【無料】",
        description=f"土地家屋調査士試験の過去問全{total_questions}問を年度・問題番号別に一覧掲載。各問題の全肢と○×解答へ直接移動できます。",
        canonical=canonical,
        css_href="../style.css",
        favicon_href="../favicon.ico",
        breadcrumbs=breadcrumbs,
        breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
        content=content,
    )
    (OUTPUT_DIR / "all-questions.html").write_text(output, encoding="utf-8", newline="\n")


def render_year_page(site_url: str, year: str, questions: dict[int, list[dict]]) -> None:
    slug = year_slug(year)
    display_year = year_name(year)
    canonical = absolute_url(site_url, f"kakomon/{slug}/")
    links = []
    for number in sorted(questions):
        items = sorted(questions[number], key=question_sort_key)
        preview = items[0].get("context") or items[0].get("text") or ""
        links.append(
            f'<li><a href="q{number}/"><span class="seo-question-number">問{number}</span>'
            f'<span class="seo-question-preview">{esc(truncate(preview, 72))}</span>'
            f'<span class="seo-choice-count">全{len(items)}肢</span></a></li>'
        )
    first_label = sorted(next(iter(questions.values())), key=question_sort_key)[0]["label"]
    content = f"""    <header class="seo-header">
      <p class="seo-eyebrow">年度別・全問掲載</p>
      <h1>土地家屋調査士 {esc(display_year)} 過去問・解答【無料】</h1>
      <p>土地家屋調査士試験の{esc(display_year)}過去問を、問題ごとに全ての肢と○×の解答付きで無料掲載しています。問題文の確認や復習にご利用ください。</p>
    </header>
    <section aria-labelledby="question-list-heading">
      <h2 id="question-list-heading">{esc(display_year)}の問題一覧</h2>
      <ul class="seo-question-list">{''.join(links)}</ul>
    </section>
    <div class="seo-cta-row">
      <a class="seo-primary-link" href="../../quiz.html?start={quote(str(first_label))}">この年度の最初からクイズを始める</a>
      <a class="seo-secondary-link" href="../">年度一覧へ</a>
    </div>"""
    breadcrumbs = [
        ("トップ", "../../index.html", absolute_url(site_url, "")),
        ("年度別過去問", "../", absolute_url(site_url, "kakomon/")),
        (display_year, "", canonical),
    ]
    output = page_shell(
        title=f"土地家屋調査士 {display_year} 過去問・解答【無料】",
        description=f"土地家屋調査士試験 {display_year}の過去問・解答を無料掲載。全{len(questions)}問の問題文と各肢の○×を確認でき、クイズ形式でも学習できます。",
        canonical=canonical,
        css_href="../../style.css",
        favicon_href="../../favicon.ico",
        breadcrumbs=breadcrumbs,
        breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
        content=content,
    )
    year_dir = OUTPUT_DIR / slug
    year_dir.mkdir(parents=True, exist_ok=True)
    (year_dir / "index.html").write_text(output, encoding="utf-8", newline="\n")


def render_question_page(
    site_url: str,
    year: str,
    number: int,
    items: list[dict],
    question_numbers: list[int],
    explanations: dict[str, dict] | None = None,
    topics: dict[str, str] | None = None,
) -> None:
    explanations = explanations or {}
    topics = topics or {}
    slug = year_slug(year)
    display_year = year_name(year)
    canonical = absolute_url(site_url, f"kakomon/{slug}/q{number}/")
    items = sorted(items, key=question_sort_key)
    contexts = list(dict.fromkeys(clean_text(item.get("context")) for item in items if clean_text(item.get("context"))))

    context_html = ""
    if contexts:
        context_html = """    <section class="seo-context" aria-labelledby="context-heading">
      <h2 id="context-heading">問題文・条件</h2>
      %s
    </section>
""" % "\n      ".join(f"<p>{esc(context)}</p>" for context in contexts)

    choice_articles = []
    for item in items:
        label = clean_text(item.get("label"))
        choice = clean_text(item.get("choice")) or label
        answer = "○" if clean_text(item.get("answer")) in {"○", "◯", "〇"} else "×"
        source = clean_text(item.get("source"))
        source_html = f'<p class="seo-source"><strong>出典：</strong>{esc(source)}</p>' if source else ""
        topic = clean_text(topics.get(label))
        topic_html = ""
        if topic in TOPICS:
            topic_html = (
                f'<a class="seo-topic-chip" href="../../../bunya/{TOPICS[topic][0]}/">{esc(topic)}</a>'
            )
        # 現行法に合わせて語句を直した肢は、肢文のすぐ下で断る。
        # 出典の行にも「（一部改変）」が入っているが、肢文だけを見た人にも見えるように。
        edited_html = (
            '<p class="seo-edited">出題文のうち、法改正で呼び名が変わった語を現行の言い方に'
            '置き換えています。どこを直したかは下の解説に書いてあります。</p>'
            if item.get("edited") else ""
        )
        choice_articles.append(f"""      <article class="seo-choice-card">
        <div class="seo-choice-heading"><h2>肢 {esc(choice)}</h2><span class="seo-label">{esc(label)}</span>{topic_html}</div>
        <p class="seo-choice-text">{esc(item.get("text"))}</p>
        {edited_html}
        <p class="seo-answer"><strong>解答：</strong><span>{answer}</span></p>
{explanation_html(explanations.get(label), "../../../")}
        {source_html}
      </article>""")

    position = question_numbers.index(number)
    previous_link = (
        f'<a class="seo-secondary-link" href="../q{question_numbers[position - 1]}/">← 前の問題（問{question_numbers[position - 1]}）</a>'
        if position > 0 else ""
    )
    next_link = (
        f'<a class="seo-secondary-link" href="../q{question_numbers[position + 1]}/">次の問題（問{question_numbers[position + 1]}）→</a>'
        if position < len(question_numbers) - 1 else ""
    )
    lead = contexts[0] if contexts else items[0].get("text", "")
    first_label = str(items[0]["label"])
    content = f"""    <header class="seo-header">
      <p class="seo-eyebrow">{esc(display_year)}・問{number}</p>
      <h1>土地家屋調査士 {esc(display_year)} 過去問・解答 問{number}</h1>
      <p>{esc(display_year)}土地家屋調査士試験の問{number}です。全{len(items)}肢の問題文と○×の解答を掲載しています。</p>
    </header>
{context_html}    <section class="seo-choices" aria-label="問{number}の各肢と解答">
{chr(10).join(choice_articles)}
    </section>
    <p class="seo-note">解説は、条文・通達・判例の原典に当たって書いたものです。根拠として挙げた条文はリンク先でそのまま読めます。</p>
    <div class="seo-cta-row">
      <a class="seo-primary-link" href="../../../quiz.html?start={quote(first_label)}">この問題からクイズを始める</a>
      <a class="seo-secondary-link" href="../">{esc(display_year)}の問題一覧へ</a>
      <a class="seo-secondary-link" href="../../">年度一覧へ</a>
      <a class="seo-secondary-link" href="../../../index.html">トップへ</a>
    </div>
    <nav class="seo-prev-next" aria-label="前後の問題">{previous_link}{next_link}</nav>"""
    breadcrumbs = [
        ("トップ", "../../../index.html", absolute_url(site_url, "")),
        ("年度別過去問", "../../", absolute_url(site_url, "kakomon/")),
        (display_year, "../", absolute_url(site_url, f"kakomon/{slug}/")),
        (f"問{number}", "", canonical),
    ]
    output = page_shell(
        title=f"土地家屋調査士 {display_year} 過去問・解答 問{number}【解説つき】",
        description=f"土地家屋調査士試験 {display_year} 問{number}の過去問・○×解答と、条文にあたって書いた解説。{truncate(lead, 76)}",
        canonical=canonical,
        css_href="../../../style.css",
        favicon_href="../../../favicon.ico",
        breadcrumbs=breadcrumbs,
        breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
        content=content,
        site_url=site_url,
        extra_ld=quiz_json(display_year, number, items, explanations),
    )
    question_dir = OUTPUT_DIR / slug / f"q{number}"
    question_dir.mkdir(parents=True, exist_ok=True)
    (question_dir / "index.html").write_text(output, encoding="utf-8", newline="\n")


def render_topic_pages(
    site_url: str,
    rows: list[dict],
    topics: dict[str, str],
    explanations: dict[str, dict],
) -> int:
    """分野別のページ。年度でしか切れていないと「建物 過去問」のような探し方に受け口がない。"""
    by_topic: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        topic = clean_text(topics.get(clean_text(row.get("label"))))
        if topic in TOPICS:
            by_topic[topic].append(row)

    TOPIC_DIR.mkdir(parents=True, exist_ok=True)
    made = 0
    for topic, (slug, blurb) in TOPICS.items():
        items = sorted(by_topic.get(topic, []), key=question_sort_key)
        if not items:
            continue
        canonical = absolute_url(site_url, f"bunya/{slug}/")
        by_year: dict[str, list[dict]] = defaultdict(list)
        for item in items:
            by_year[str(item["year"])].append(item)

        sections = []
        for year in sorted(by_year, key=year_order, reverse=True):
            links = []
            for item in by_year[year]:
                label = clean_text(item["label"])
                exp = explanations.get(label) or {}
                answer = "○" if clean_text(item.get("answer")) in {"○", "◯", "〇"} else "×"
                links.append(
                    f'<li><a href="../../kakomon/{year_slug(year)}/q{int(item["questionNo"])}/">'
                    f'<span class="seo-question-number">{esc(label)}</span>'
                    f'<span class="seo-question-preview">{esc(truncate(exp.get("c") or item.get("text"), 76))}</span>'
                    f'<span class="seo-choice-count">{answer}</span></a></li>'
                )
            sections.append(
                f'<section aria-label="{esc(year_name(year))}の{esc(topic)}">'
                f'<h2>{esc(year_name(year))}（{len(links)}肢）</h2>'
                f'<ul class="seo-question-list">{"".join(links)}</ul></section>'
            )

        content = f"""    <header class="seo-header">
      <p class="seo-eyebrow">分野別</p>
      <h1>土地家屋調査士 {esc(topic)}の過去問・解答</h1>
      <p>{esc(blurb)}。平成17年度から令和7年度までの{len(items)}肢を年度順に並べています。各肢の一言と○×を一覧で確認でき、問題ページで条文にあたった解説を読めます。</p>
    </header>
    {''.join(sections)}
    <div class="seo-cta-row">
      <a class="seo-primary-link" href="../../question-list.html">クイズ形式で学習する</a>
      <a class="seo-secondary-link" href="../">分野一覧へ</a>
      <a class="seo-secondary-link" href="../../kakomon/">年度別過去問へ</a>
    </div>"""
        breadcrumbs = [
            ("トップ", "../../index.html", absolute_url(site_url, "")),
            ("分野別過去問", "../", absolute_url(site_url, "bunya/")),
            (topic, "", canonical),
        ]
        output = page_shell(
            title=f"土地家屋調査士 {topic}の過去問・解答【解説つき】",
            description=f"土地家屋調査士試験の「{topic}」に関する過去問{len(items)}肢を年度順に掲載。{blurb}。条文にあたって書いた解説つき。",
            canonical=canonical,
            css_href="../../style.css",
            favicon_href="../../favicon.ico",
            breadcrumbs=breadcrumbs,
            breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
            content=content,
            site_url=site_url,
        )
        target = TOPIC_DIR / slug
        target.mkdir(parents=True, exist_ok=True)
        (target / "index.html").write_text(output, encoding="utf-8", newline="\n")
        made += 1

    cards = []
    for topic, (slug, blurb) in TOPICS.items():
        count = len(by_topic.get(topic, []))
        if not count:
            continue
        cards.append(
            f'<li><a href="{slug}/"><strong>{esc(topic)}</strong><span>全{count}肢</span></a></li>'
        )
    canonical = absolute_url(site_url, "bunya/")
    content = f"""    <header class="seo-header">
      <p class="seo-eyebrow">分野から探す</p>
      <h1>土地家屋調査士 分野別の過去問・解答</h1>
      <p>土地家屋調査士試験の過去問を分野ごとにまとめています。年度をまたいで同じ論点を続けて確認できます。</p>
    </header>
    <section aria-labelledby="topic-list-heading">
      <h2 id="topic-list-heading">分野を選ぶ</h2>
      <ul class="seo-year-grid">{''.join(cards)}</ul>
    </section>
    <div class="seo-cta-row">
      <a class="seo-primary-link" href="../question-list.html">クイズ形式で学習する</a>
      <a class="seo-secondary-link" href="../kakomon/">年度別過去問へ</a>
      <a class="seo-secondary-link" href="../index.html">トップへ</a>
    </div>"""
    breadcrumbs = [
        ("トップ", "../index.html", absolute_url(site_url, "")),
        ("分野別過去問", "", canonical),
    ]
    (TOPIC_DIR / "index.html").write_text(page_shell(
        title="土地家屋調査士 分野別の過去問・解答【解説つき】",
        description="土地家屋調査士試験の過去問を土地・建物・区分建物・民法・総論・調査士法・筆界特定・審査請求の分野別にまとめています。年度をまたいで同じ論点を確認できます。",
        canonical=canonical,
        css_href="../style.css",
        favicon_href="../favicon.ico",
        breadcrumbs=breadcrumbs,
        breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
        content=content,
        site_url=site_url,
    ), encoding="utf-8", newline="\n")
    return made + 1


def render_discovery_files(site_url: str, grouped: dict[str, dict[int, list[dict]]]) -> None:
    paths = ["", "privacy.html", "kakomon/", "kakomon/all-questions.html"]
    for year in sorted(grouped, key=year_order):
        slug = year_slug(year)
        paths.append(f"kakomon/{slug}/")
        paths.extend(f"kakomon/{slug}/q{number}/" for number in sorted(grouped[year]))
    lastmod = date.today().isoformat()
    urls = "\n".join(
        f"  <url><loc>{esc(absolute_url(site_url, path))}</loc><lastmod>{lastmod}</lastmod></url>"
        for path in paths
    )
    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls}
</urlset>
"""
    (APP_DIR / "sitemap.xml").write_text(sitemap, encoding="utf-8", newline="\n")
    robots = f"User-agent: *\nAllow: /\n\nSitemap: {absolute_url(site_url, 'sitemap.xml')}\n"
    (APP_DIR / "robots.txt").write_text(robots, encoding="utf-8", newline="\n")


def generate(site_url: str) -> tuple[int, int, int, int]:
    site_url = site_url.rstrip("/") + "/"
    rows = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8-sig"))
    rows = sorted((row for row in rows if row.get("label") and row.get("year") and row.get("questionNo")), key=question_sort_key)
    grouped = group_questions(rows)
    explanations = load_explanations()
    topics = load_topics()

    for directory in (OUTPUT_DIR, TOPIC_DIR):
        if directory.exists():
            shutil.rmtree(directory)
    OUTPUT_DIR.mkdir(parents=True)

    render_archive_index(site_url, grouped)
    render_all_questions_page(site_url, grouped)
    question_page_count = 0
    with_exp = 0
    for year in sorted(grouped, key=year_order):
        questions = grouped[year]
        render_year_page(site_url, year, questions)
        numbers = sorted(questions)
        for number in numbers:
            render_question_page(site_url, year, number, questions[number], numbers, explanations, topics)
            question_page_count += 1
            with_exp += sum(1 for item in questions[number] if explanations.get(clean_text(item.get("label"))))
    topic_page_count = render_topic_pages(site_url, rows, topics, explanations)
    # sitemap.xml と robots.txt は build_sitemap.js が全ページを見て作る。
    # ここで書くと判例・条文のページが落ちるので触らない。
    return len(grouped), question_page_count, topic_page_count, with_exp


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_SITE_URL, help="canonical に使う公開URL")
    args = parser.parse_args()
    year_count, question_count, topic_count, with_exp = generate(args.base_url)
    print(f"Generated {year_count} year pages, {question_count} question pages, {topic_count} topic pages.")
    print(f"解説を載せた肢: {with_exp}")
    print(f"Base URL: {args.base_url.rstrip('/')}/")
    print("sitemap.xml / robots.txt は build_sitemap.js で作り直してください。")


if __name__ == "__main__":
    main()
