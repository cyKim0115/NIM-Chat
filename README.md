# NIM Chat (`nvidia-chat`)

모바일 우선 NVIDIA NIM 채팅 웹앱입니다. **채팅 모드**와 **에이전트 모드**(규칙·스킬·웹검색·원격 MCP)를 지원합니다.

## 왜 Cloudflare Workers인가?

NVIDIA API(`integrate.api.nvidia.com`)는 브라우저 CORS를 막아 GitHub Pages만으로는 대화가 되지 않습니다.  
이 프로젝트는 **Cloudflare Workers(무료) + Static Assets** 로 UI와 API 프록시를 함께 배포합니다.

- 프론트: 정적 HTML/CSS/JS (`public/`)
- 프록시: `POST /api/chat` → NVIDIA chat completions
- 에이전트: `POST /api/agent` → Worker 안 tool-calling 루프 (규칙/스킬/웹검색/MCP)

## 준비물

1. [NVIDIA API 키](https://build.nvidia.com/settings/api-keys) (`nvapi-...`)
2. [Cloudflare](https://dash.cloudflare.com/) 계정 (무료)
3. (에이전트 웹검색) [Brave Search API](https://brave.com/search/api/) 키 — Worker 시크릿 또는 앱 설정 BYOK
4. GitHub 저장소 (선택, 권장)

## 로컬 실행

```bash
npm run dev
```

브라우저에서 `http://127.0.0.1:8788` 을 엽니다.  
(정적 파일만 열면 프록시가 없어 대화가 실패합니다.)

로컬에서 웹검색을 쓰려면:

```bash
npx wrangler secret put BRAVE_API_KEY
```

또는 앱 설정에 Brave 키를 직접 입력하세요.

## 에이전트 모드

헤더의 **에이전트** 토글 또는 설정에서 모드를 바꿉니다.

| 기능 | 설명 |
|------|------|
| 규칙 | `rules/*.md` 를 파일명 순으로 시스템 프롬프트에 주입 |
| 스킬 | `skills/*/SKILL.md` — 키워드 또는 `@skill web-search` 로 매칭 |
| 웹검색 | builtin `web_search` (Brave) + `fetch_url` |
| MCP | `config/mcp.json` 의 Streamable HTTP 서버 (최대 3개) |
| 상한 | 최대 8 tool steps, tool 결과 8k chars |

에이전트 기본 모델: `meta/llama-3.1-70b-instruct` (도구 지원 모델만 허용).

### MCP 설정 예시

`config/mcp.json`:

```json
{
  "mcpServers": {
    "example": {
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "authEnv": "MCP_EXAMPLE_TOKEN"
    }
  }
}
```

토큰은 코드에 넣지 말고 Wrangler 시크릿으로 넣습니다:

```bash
npx wrangler secret put MCP_EXAMPLE_TOKEN
npx wrangler secret put BRAVE_API_KEY
```

MCP 도구는 `mcp__{server}__{tool}` 이름으로 모델에 노출됩니다.  
서버가 없거나 연결 실패해도 builtin 도구만으로 에이전트가 동작합니다.

### 스킬 사용

- 메시지에 URL이 있으면 `summarize-url` 스킬이 매칭될 수 있습니다.
- `@skill web-search` 처럼 명시적으로 스킬을 지정할 수 있습니다.

## 배포 (권장: GitHub 연동)

1. 이 폴더를 GitHub 저장소로 푸시합니다.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → Git 저장소 연결 (Worker)
3. Deploy command는 **`npx wrangler deploy`** 로 두세요.
4. `wrangler.toml`의 `name`이 대시보드 Worker 이름(`nim-chat`)과 같아야 합니다.
5. Deploy 후 Worker URL 접속 → 설정에서 API 키 입력
6. (선택) Dashboard → Worker → Settings → Variables → Secrets 에 `BRAVE_API_KEY` / `MCP_*` 추가

## CLI로 바로 배포

```bash
npx wrangler login
npm run deploy
```

## 사용 팁

- 키·모델·모드·프록시 URL은 기기 설정의 **설정**에서 바꿉니다.
- Rate limit(~분당 요청 수)에 걸리면 잠시 후 다시 시도하세요. 무료 티어는 프로토타입용입니다.
- 모델을 바꿔도 안 되면 [NVIDIA 카탈로그](https://build.nvidia.com/)에서 해당 모델 ID를 확인하세요.
- 에이전트 모드에서 tool calling이 안 되면 모델이 `tools` 를 지원하는지 확인하세요.
