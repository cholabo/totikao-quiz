# 土地家屋調査士 過去問アプリ

土地家屋調査士試験の過去問を、年度順・復習・タイムアタックで学習できる静的Webアプリです。

- 公開サイト: https://cholabo.github.io/totikao-quiz/
- GA4・BigQueryの管理手順: `GA4・BigQuery設定手順書.md`
- BigQuery集計例: `docs/bigquery_quiz_analysis.sql`

`questions.json`を更新した場合は、`python scripts/generate_seo_pages.py`で年度別・問題別の検索用ページとサイトマップを再生成できます。
