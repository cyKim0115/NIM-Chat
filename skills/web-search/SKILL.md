---
name: web-search
description: Use when the user needs current information, news, facts, prices, or anything that may have changed after training data.
triggers:
  - search
  - 검색
  - news
  - 뉴스
  - today
  - 오늘
  - latest
  - 최신
  - price
  - 가격
  - who is
  - what is happening
---

# Web search skill

When the user asks for up-to-date information:

1. Call `web_search` with a focused query.
2. Read the top results; if one URL looks authoritative, optionally `fetch_url` it.
3. Answer with citations (title + URL) when useful.
4. Prefer recent sources and note if results conflict.
