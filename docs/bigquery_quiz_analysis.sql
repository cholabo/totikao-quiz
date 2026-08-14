-- 土地家屋調査士クイズ：GA4 BigQuery集計例
--
-- 実行前に、全てのSQLにある次の目印を置き換えてください。
--   YOUR_PROJECT_ID       → Google CloudのプロジェクトID
--   YOUR_GA4_PROPERTY_ID  → GA4の数字だけのプロパティID
--
-- 例：`my-project.analytics_123456789.events_*`
-- 各「集計例」は、それぞれ単独で実行できます。


-- ============================================================
-- 1. 問題・肢別の初回正答率
-- ============================================================
WITH answers AS (
  SELECT
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'question_label') AS question_label,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'year') AS year,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'question_no') AS question_no,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'choice') AS choice,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'answer_result') AS answer_result,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'is_first_attempt') AS is_first_attempt
  FROM `YOUR_PROJECT_ID.analytics_YOUR_GA4_PROPERTY_ID.events_*`
  WHERE event_name = 'quiz_answer'
)
SELECT
  question_label,
  year,
  question_no,
  choice,
  COUNT(*) AS first_attempt_answers,
  COUNTIF(answer_result = 'correct') AS first_attempt_correct,
  ROUND(100 * SAFE_DIVIDE(COUNTIF(answer_result = 'correct'), COUNT(*)), 1) AS first_attempt_accuracy_percent
FROM answers
WHERE is_first_attempt = 1
GROUP BY question_label, year, question_no, choice
ORDER BY first_attempt_accuracy_percent, question_label;


-- ============================================================
-- 2. 問題・肢別の全回答正答率
-- ============================================================
WITH answers AS (
  SELECT
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'question_label') AS question_label,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'year') AS year,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'question_no') AS question_no,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'choice') AS choice,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'answer_result') AS answer_result,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'quiz_mode') AS quiz_mode
  FROM `YOUR_PROJECT_ID.analytics_YOUR_GA4_PROPERTY_ID.events_*`
  WHERE event_name = 'quiz_answer'
)
SELECT
  question_label,
  year,
  question_no,
  choice,
  COUNT(*) AS total_answers,
  COUNTIF(answer_result = 'correct') AS correct_answers,
  COUNTIF(answer_result = 'wrong') AS wrong_answers,
  COUNTIF(answer_result = 'unknown') AS unknown_answers,
  ROUND(100 * SAFE_DIVIDE(COUNTIF(answer_result = 'correct'), COUNT(*)), 1) AS all_answer_accuracy_percent,
  COUNTIF(quiz_mode = 'year') AS year_mode_answers,
  COUNTIF(quiz_mode = 'review') AS review_mode_answers,
  COUNTIF(quiz_mode = 'timeattack') AS timeattack_answers
FROM answers
GROUP BY question_label, year, question_no, choice
ORDER BY all_answer_accuracy_percent, question_label;


-- ============================================================
-- 3. 問題別の回答者数と回答回数
--    問番号単位で全ての肢をまとめます。
-- ============================================================
WITH answers AS (
  SELECT
    user_pseudo_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'year') AS year,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'question_no') AS question_no,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'answer_result') AS answer_result
  FROM `YOUR_PROJECT_ID.analytics_YOUR_GA4_PROPERTY_ID.events_*`
  WHERE event_name = 'quiz_answer'
)
SELECT
  year,
  question_no,
  COUNT(DISTINCT user_pseudo_id) AS anonymous_browsers,
  COUNT(*) AS answer_count,
  ROUND(SAFE_DIVIDE(COUNT(*), COUNT(DISTINCT user_pseudo_id)), 2) AS answers_per_browser,
  ROUND(100 * SAFE_DIVIDE(COUNTIF(answer_result = 'correct'), COUNT(*)), 1) AS accuracy_percent
FROM answers
GROUP BY year, question_no
ORDER BY year, SAFE_CAST(question_no AS INT64);


-- ============================================================
-- 4. 匿名ブラウザ単位の週別正答率推移
--    user_pseudo_idはGA4標準の匿名ブラウザ識別子です。
-- ============================================================
WITH answers AS (
  SELECT
    user_pseudo_id,
    PARSE_DATE('%Y%m%d', event_date) AS answer_date,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'answer_result') AS answer_result
  FROM `YOUR_PROJECT_ID.analytics_YOUR_GA4_PROPERTY_ID.events_*`
  WHERE event_name = 'quiz_answer'
    AND user_pseudo_id IS NOT NULL
)
SELECT
  user_pseudo_id,
  DATE_TRUNC(answer_date, WEEK(MONDAY)) AS week_start,
  COUNT(*) AS answers,
  COUNTIF(answer_result = 'correct') AS correct_answers,
  ROUND(100 * SAFE_DIVIDE(COUNTIF(answer_result = 'correct'), COUNT(*)), 1) AS accuracy_percent
FROM answers
GROUP BY user_pseudo_id, week_start
ORDER BY user_pseudo_id, week_start;


-- ============================================================
-- 5. 最初の50回答と直近50回答を比較した成長率
--    100回答以上ある匿名ブラウザだけを対象にし、2区間の重複を避けます。
--    growth_percentage_pointsがプラスなら正答率が向上しています。
-- ============================================================
WITH answers AS (
  SELECT
    user_pseudo_id,
    event_timestamp,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'answer_result') AS answer_result
  FROM `YOUR_PROJECT_ID.analytics_YOUR_GA4_PROPERTY_ID.events_*`
  WHERE event_name = 'quiz_answer'
    AND user_pseudo_id IS NOT NULL
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY user_pseudo_id ORDER BY event_timestamp) AS answer_number,
    COUNT(*) OVER (PARTITION BY user_pseudo_id) AS total_answers
  FROM answers
),
rates AS (
  SELECT
    user_pseudo_id,
    total_answers,
    SAFE_DIVIDE(COUNTIF(answer_number <= 50 AND answer_result = 'correct'), 50) AS first_50_rate,
    SAFE_DIVIDE(COUNTIF(answer_number > total_answers - 50 AND answer_result = 'correct'), 50) AS latest_50_rate
  FROM ranked
  WHERE total_answers >= 100
  GROUP BY user_pseudo_id, total_answers
)
SELECT
  user_pseudo_id,
  total_answers,
  ROUND(100 * first_50_rate, 1) AS first_50_accuracy_percent,
  ROUND(100 * latest_50_rate, 1) AS latest_50_accuracy_percent,
  ROUND(100 * (latest_50_rate - first_50_rate), 1) AS growth_percentage_points
FROM rates
ORDER BY growth_percentage_points DESC;


-- ============================================================
-- 6. 回答者数が少ない問題を除外する重要度分析用の基礎集計
--    min_anonymous_browsersを変更すると最低回答者数を調整できます。
--    answer_share_percentは全回答のうち、その肢が回答された割合です。
-- ============================================================
DECLARE min_anonymous_browsers INT64 DEFAULT 30;

WITH answers AS (
  SELECT
    user_pseudo_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'question_label') AS question_label,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'year') AS year,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'question_no') AS question_no,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'choice') AS choice,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'answer_result') AS answer_result,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'is_first_attempt') AS is_first_attempt
  FROM `YOUR_PROJECT_ID.analytics_YOUR_GA4_PROPERTY_ID.events_*`
  WHERE event_name = 'quiz_answer'
),
totals AS (
  SELECT COUNT(*) AS all_answer_count FROM answers
),
by_question AS (
  SELECT
    question_label,
    year,
    question_no,
    choice,
    COUNT(DISTINCT user_pseudo_id) AS anonymous_browsers,
    COUNT(*) AS answer_count,
    COUNTIF(is_first_attempt = 1) AS first_attempt_count,
    SAFE_DIVIDE(COUNTIF(is_first_attempt = 1 AND answer_result = 'correct'), COUNTIF(is_first_attempt = 1)) AS first_attempt_accuracy,
    SAFE_DIVIDE(COUNTIF(answer_result = 'correct'), COUNT(*)) AS all_answer_accuracy
  FROM answers
  GROUP BY question_label, year, question_no, choice
)
SELECT
  question_label,
  year,
  question_no,
  choice,
  anonymous_browsers,
  answer_count,
  first_attempt_count,
  ROUND(100 * first_attempt_accuracy, 1) AS first_attempt_accuracy_percent,
  ROUND(100 * all_answer_accuracy, 1) AS all_answer_accuracy_percent,
  ROUND(100 * (1 - first_attempt_accuracy), 1) AS first_attempt_difficulty_percent,
  ROUND(100 * SAFE_DIVIDE(answer_count, all_answer_count), 3) AS answer_share_percent
FROM by_question
CROSS JOIN totals
WHERE anonymous_browsers >= min_anonymous_browsers
ORDER BY first_attempt_difficulty_percent DESC, anonymous_browsers DESC;
