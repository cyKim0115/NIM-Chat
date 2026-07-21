---
name: summarize-url
description: Use when the user pastes a URL or asks to summarize or explain a web page.
triggers:
  - http://
  - https://
  - summarize
  - 요약
  - 이 링크
  - url
  - webpage
  - 페이지
---

# Summarize URL skill

When the user provides or asks about a URL:

1. Call `fetch_url` with that URL.
2. Summarize the main points in clear bullets or short paragraphs.
3. Mention title and URL. Flag if the page could not be fetched or was truncated.
