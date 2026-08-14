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
DEFAULT_SITE_URL = "https://cholabo.github.io/totikao-quiz/"

ROOT_DIR = Path(__file__).resolve().parents[1]
APP_DIR = ROOT_DIR / "app" if (ROOT_DIR / "app" / "questions.json").exists() else ROOT_DIR
QUESTIONS_PATH = APP_DIR / "questions.json"
OUTPUT_DIR = APP_DIR / "kakomon"


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
    privacy_href: str,
    breadcrumbs: list[tuple[str, str, str]],
    breadcrumb_ld: list[tuple[str, str]],
    content: str,
) -> str:
    breadcrumb_html = "\n".join(
        f'<li><a href="{esc(href)}">{esc(name)}</a></li>' if index < len(breadcrumbs) - 1
        else f'<li aria-current="page">{esc(name)}</li>'
        for index, (name, href, _url) in enumerate(breadcrumbs)
    )
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(description)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="{esc(canonical)}">
  <link rel="stylesheet" href="{esc(css_href)}?v=1.7">
  <link rel="icon" href="{esc(favicon_href)}" type="image/x-icon">
  <script type="application/ld+json">{breadcrumb_json(breadcrumb_ld)}</script>
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
      <p>本サイトは個人の学習支援を目的とした非公式サイトであり、法務省その他の公的機関とは関係ありません。</p>
      <p><a href="{esc(privacy_href)}">アクセス解析とプライバシーについて</a></p>
    </footer>
  </main>
</body>
</html>
"""


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
        privacy_href="../privacy.html",
        breadcrumbs=breadcrumbs,
        breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
        content=content,
    )
    (OUTPUT_DIR / "index.html").write_text(output, encoding="utf-8", newline="\n")


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
        privacy_href="../../privacy.html",
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
) -> None:
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
        choice_articles.append(f"""      <article class="seo-choice-card">
        <div class="seo-choice-heading"><h2>肢 {esc(choice)}</h2><span class="seo-label">{esc(label)}</span></div>
        <p class="seo-choice-text">{esc(item.get("text"))}</p>
        <p class="seo-answer"><strong>解答：</strong><span>{answer}</span></p>
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
    <p class="seo-note">JSONデータに解説・根拠の記載がないため、このページでは問題文、解答および利用可能な出典情報のみを掲載しています。</p>
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
        title=f"土地家屋調査士 {display_year} 過去問・解答 問{number}【無料】",
        description=f"土地家屋調査士試験 {display_year} 問{number}の過去問と○×解答。{truncate(lead, 92)}",
        canonical=canonical,
        css_href="../../../style.css",
        favicon_href="../../../favicon.ico",
        privacy_href="../../../privacy.html",
        breadcrumbs=breadcrumbs,
        breadcrumb_ld=[(name, url) for name, _href, url in breadcrumbs],
        content=content,
    )
    question_dir = OUTPUT_DIR / slug / f"q{number}"
    question_dir.mkdir(parents=True, exist_ok=True)
    (question_dir / "index.html").write_text(output, encoding="utf-8", newline="\n")


def render_discovery_files(site_url: str, grouped: dict[str, dict[int, list[dict]]]) -> None:
    paths = ["", "privacy.html", "kakomon/"]
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


def generate(site_url: str) -> tuple[int, int]:
    site_url = site_url.rstrip("/") + "/"
    rows = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8-sig"))
    rows = sorted((row for row in rows if row.get("label") and row.get("year") and row.get("questionNo")), key=question_sort_key)
    grouped = group_questions(rows)

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)

    render_archive_index(site_url, grouped)
    question_page_count = 0
    for year in sorted(grouped, key=year_order):
        questions = grouped[year]
        render_year_page(site_url, year, questions)
        numbers = sorted(questions)
        for number in numbers:
            render_question_page(site_url, year, number, questions[number], numbers)
            question_page_count += 1
    render_discovery_files(site_url, grouped)
    return len(grouped), question_page_count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_SITE_URL, help="canonical と sitemap に使う公開URL")
    args = parser.parse_args()
    year_count, question_count = generate(args.base_url)
    print(f"Generated {year_count} year pages and {question_count} question pages.")
    print(f"Base URL: {args.base_url.rstrip('/')}/")


if __name__ == "__main__":
    main()
