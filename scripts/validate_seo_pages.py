#!/usr/bin/env python3
"""生成済みSEOページの構造、内容、内部リンクを検証する。"""

from __future__ import annotations

import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT_DIR = Path(__file__).resolve().parents[1]
APP_DIR = ROOT_DIR / "app" if (ROOT_DIR / "app" / "questions.json").exists() else ROOT_DIR
OUTPUT_DIR = APP_DIR / "kakomon"
QUESTIONS_PATH = APP_DIR / "questions.json"


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_count = 0
        self.h1_count = 0
        self.descriptions: list[str] = []
        self.canonicals: list[str] = []
        self.hrefs: list[str] = []
        self.json_ld: list[str] = []
        self._capture_title = False
        self._capture_json_ld = False
        self._json_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "title":
            self.title_count += 1
            self._capture_title = True
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "meta" and values.get("name") == "description":
            self.descriptions.append(values.get("content", ""))
        elif tag == "link" and values.get("rel") == "canonical":
            self.canonicals.append(values.get("href", ""))
        elif tag == "a" and values.get("href"):
            self.hrefs.append(values["href"] or "")
        elif tag == "script" and values.get("type") == "application/ld+json":
            self._capture_json_ld = True
            self._json_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._capture_title = False
        elif tag == "script" and self._capture_json_ld:
            self.json_ld.append("".join(self._json_parts))
            self._capture_json_ld = False

    def handle_data(self, data: str) -> None:
        if self._capture_json_ld:
            self._json_parts.append(data)


def fail(errors: list[str], message: str) -> None:
    if len(errors) < 50:
        errors.append(message)


def resolve_internal(page: Path, href: str) -> Path | None:
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or href.startswith("#"):
        return None
    target = (page.parent / unquote(parsed.path)).resolve()
    if parsed.path.endswith("/") or target.is_dir():
        target /= "index.html"
    return target


def main() -> None:
    errors: list[str] = []
    rows = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8-sig"))
    grouped: dict[tuple[str, int], list[dict]] = {}
    for row in rows:
        grouped.setdefault((str(row["year"]), int(row["questionNo"])), []).append(row)

    year_dirs = sorted(path for path in OUTPUT_DIR.iterdir() if path.is_dir())
    question_pages = sorted(OUTPUT_DIR.glob("*/q*/index.html"))
    if len(year_dirs) != len({year for year, _number in grouped}):
        fail(errors, f"年度ディレクトリ数が不一致: {len(year_dirs)}")
    if len(question_pages) != len(grouped):
        fail(errors, f"問題ページ数が不一致: {len(question_pages)}")

    all_questions_page = OUTPUT_DIR / "all-questions.html"
    html_pages = [OUTPUT_DIR / "index.html", all_questions_page] + sorted(OUTPUT_DIR.glob("*/index.html")) + question_pages
    titles: set[str] = set()
    descriptions: set[str] = set()
    canonicals: set[str] = set()

    for page in html_pages:
        source = page.read_text(encoding="utf-8")
        parser = PageParser()
        parser.feed(source)
        relative = page.relative_to(APP_DIR).as_posix()
        if parser.title_count != 1:
            fail(errors, f"title数が不正: {relative}")
        if parser.h1_count != 1:
            fail(errors, f"H1数が不正: {relative}")
        if len(parser.descriptions) != 1 or not parser.descriptions[0]:
            fail(errors, f"descriptionが不正: {relative}")
        if len(parser.canonicals) != 1 or not parser.canonicals[0].startswith("https://"):
            fail(errors, f"canonicalが不正: {relative}")
        # JSON-LD は複数置く。問題ページは BreadcrumbList に加えて Quiz を持つ。
        types = []
        for block in parser.json_ld:
            try:
                types.append(json.loads(block).get("@type"))
            except json.JSONDecodeError:
                fail(errors, f"JSON-LDが不正: {relative}")
        if "BreadcrumbList" not in types:
            fail(errors, f"BreadcrumbListがない: {relative}")

        # SNS に共有したときのカード。全ページに要る
        for prop in ('property="og:title"', 'property="og:image"', 'name="twitter:card"'):
            if prop not in source:
                fail(errors, f"{prop} がない: {relative}")

        title_start = source.find("<title>") + len("<title>")
        title_end = source.find("</title>", title_start)
        title = html.unescape(source[title_start:title_end])
        if title in titles:
            fail(errors, f"titleが重複: {title}")
        titles.add(title)
        if parser.descriptions and parser.descriptions[0] in descriptions:
            fail(errors, f"descriptionが重複: {relative}")
        descriptions.update(parser.descriptions)
        if parser.canonicals and parser.canonicals[0] in canonicals:
            fail(errors, f"canonicalが重複: {relative}")
        canonicals.update(parser.canonicals)

        for href in parser.hrefs:
            target = resolve_internal(page, href)
            if target is not None and not target.exists():
                fail(errors, f"リンク切れ: {relative} -> {href}")

    for (year, number), items in grouped.items():
        page = OUTPUT_DIR / year.lower() / f"q{number}" / "index.html"
        source = page.read_text(encoding="utf-8") if page.exists() else ""
        for item in items:
            fields = ["label", "text"]
            fields.extend(field for field in ("context", "source") if item.get(field))
            for field in fields:
                expected = html.escape(str(item.get(field, "")), quote=True)
                if expected not in source:
                    fail(errors, f"{field}が本文にない: {year} 問{number} / {item.get('label')}")

    # sitemap は build_sitemap.js が全ページ（判例・条文・分野別も含む）から作るので、
    # 数を決め打ちで比べない。各ページの canonical が載っているかで確かめる。
    sitemap_root = ET.parse(APP_DIR / "sitemap.xml").getroot()
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    sitemap_urls = sitemap_root.findall(f"{ns}url")
    listed = {url.findtext(f"{ns}loc") for url in sitemap_urls}
    for page in html_pages:
        source = page.read_text(encoding="utf-8")
        match = re.search(r'<link rel="canonical" href="([^"]+)"', source)
        if match and match.group(1) not in listed:
            fail(errors, f"sitemapに載っていない: {page.relative_to(APP_DIR).as_posix()}")
    robots = (APP_DIR / "robots.txt").read_text(encoding="utf-8")
    if "Sitemap: https://" not in robots:
        fail(errors, "robots.txtにsitemap URLがない")

    # 解説が問題ページに載っているか（載せるために生成器を書き換えたので、抜けたら気づきたい）
    explanations: dict[str, dict] = {}
    index_path = APP_DIR / "data" / "exp-index.json"
    if index_path.exists():
        for year in json.loads(index_path.read_text(encoding="utf-8")).get("years", []):
            path = APP_DIR / "data" / f"exp-{year}.json"
            if path.exists():
                explanations.update(json.loads(path.read_text(encoding="utf-8")))
    missing_exp = 0
    for (year, number), items in grouped.items():
        page = OUTPUT_DIR / year.lower() / f"q{number}" / "index.html"
        source = page.read_text(encoding="utf-8") if page.exists() else ""
        for item in items:
            exp = explanations.get(str(item.get("label")))
            if exp and exp.get("c") and html.escape(exp["c"], quote=True) not in source:
                missing_exp += 1
    if missing_exp:
        fail(errors, f"解説が載っていない肢: {missing_exp}")

    if errors:
        print("Validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        raise SystemExit(1)

    print(f"Validated {len(year_dirs)} year pages, {len(question_pages)} question pages, and {len(sitemap_urls)} sitemap URLs.")


if __name__ == "__main__":
    main()
