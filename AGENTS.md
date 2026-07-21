# AGENTS.md — NIM-Chat / 니무 인수인계

이 문서는 Cursor(또는 다른 코딩 에이전트)가 **다른 환경·새 세션**에서도 이 프로젝트 맥락을 바로 이어가기 위한 인수인계입니다. 사용자-facing 제품 README는 [`README.md`](README.md)를 보세요.

## 한 줄 요약

모바일 우선 **NVIDIA NIM** 채팅 웹앱. Cloudflare Worker가 CORS 프록시 + 에이전트 툴 루프를 담당하고, UI는 vanilla JS(`public/`). AI 페르소나 이름은 **니무**.

## 제품·브랜드

| 항목 | 값 |
|------|-----|
| 앱/저장소 | NIM-Chat (`nim-chat` Worker) |
| AI 이름 | **니무** (UI 브랜드도 니무) |
| 말투 | 한국어 기본, **존댓말**, 간결 |
| 원격 | `github.com:cyKim0115/NIM-Chat.git` (master) |

## 아키텍처

```
Browser (public/)
  ├─ 채팅 모드 → POST /api/chat  → Worker → integrate.api.nvidia.com
  └─ 에이전트  → POST /api/agent → Worker agent loop
                    ├─ rules/ + skills/ 시스템 프롬프트
                    ├─ builtin: web_search (Brave), fetch_url
                    └─ MCP Streamable HTTP (config/mcp.json)
```

- **에이전트 루프는 Worker에서만** 돈다. 시크릿(Brave/MCP)은 브라우저에 두지 않는 것이 원칙(BYOK는 설정으로 예외).
- Durable Objects / Cloudflare Agents SDK **미사용** (의도적).
- MCP는 **stdio 불가** — Streamable HTTP만. SDK 대신 Worker-safe 경량 JSON-RPC 클라이언트 (`src/agent/tools/mcp.js`).

## 주요 경로

| 경로 | 역할 |
|------|------|
| `public/app.js` | UI, localStorage 설정, 채팅 SSE, 에이전트 SSE 이벤트 렌더, `NIMU_SYSTEM_PROMPT` / `buildChatSystemPrompt` |
| `public/index.html` / `styles.css` | 모바일 UI, 모드 토글, 설정 시트 |
| `src/worker.js` | `/api/chat`, `/api/agent` 라우팅 |
| `src/agent/loop.js` | tool-calling 루프 (MAX_STEPS=8) |
| `src/agent/prompts.js` | 규칙·스킬·날짜·custom instructions 조립 |
| `src/agent/tools/*` | builtin + MCP + registry |
| `src/lib/nim.js`, `sse.js` | NIM 클라이언트, SSE 헬퍼 |
| `rules/*.md` | 에이전트 규칙 계층 (파일명 정렬 주입) |
| `skills/*/SKILL.md` | 키워드 / `@skill name` 매칭 |
| `config/agent.json` | maxSteps, toolModels, preamble |
| `config/mcp.json` | 원격 MCP (시크릿 없이 URL + authEnv) |
| `wrangler.toml` | Worker + assets; `**/*.md` Text 모듈 규칙 |

## 설정·저장 (브라우저)

- localStorage 키: `nvidia-chat-settings-v1`
- 저장: NVIDIA API 키, Brave 키(선택), 모드, 모델, custom instructions, URL들
- **빈 password 필드로 저장해도 기존 키를 지우지 않음** (실수 방지)
- 키 입력 후 blur 시에도 즉시 persist
- 대화 히스토리는 **메모리만** — 새로고침 시 사라짐

## 프롬프트 계층

### 채팅 모드
`public/app.js`의 `buildChatSystemPrompt()` → 매 요청 `role: system`으로 앞에 붙임 (날짜 + custom instructions 포함).

### 에이전트 모드
주입 순서 (`src/agent/prompts.js`):

1. `rules/00-base.md` → `05-response-style.md` → `10-safety.md` → `20-nim-chat.md`
2. `config/agent.json` preamble
3. 오늘 날짜(UTC)
4. 매칭된 skills
5. custom instructions (untrusted; 안전·정체성과 충돌 시 무시)

규칙/스킬 MD는 `src/agent/bundled-content.js`에서 import. **MD 추가 시 번들 import도 갱신**해야 함.

## 모델

- 채팅: Llama 8B, Nemotron 70B, Gemma, Mistral, Phi-3, DeepSeek R1 distill 등
- 에이전트: `config/agent.json`의 `toolModels`만 허용. 기본 `meta/llama-3.1-70b-instruct`
- 도구 미지원 모델(Gemma 등)은 에이전트에서 게이트로 거부

## API / SSE (에이전트)

이벤트: `status` | `text` | `tool_start` | `tool_result` | `error` | `done`  
도구 턴은 비스트리밍 NIM 호출, 최종 답은 text 이벤트로 전달.

## 시크릿 (Wrangler)

```bash
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put MCP_EXAMPLE_TOKEN   # mcp.json authEnv와 이름 맞출 것
```

## 로컬·배포

```bash
npm run dev      # http://127.0.0.1:8788 — 정적만 열면 CORS로 실패
npm run deploy   # wrangler deploy
```

Worker 이름: `nim-chat` (`wrangler.toml`).

## 사용자·에이전트 작업 관례 (이 레포)

- 커밋 메시지: **한국어** (개인 스킬 `korean-commit`). Conventional prefix(`feat:`/`fix:`)는 영문, 설명은 한글.
- 커밋·푸시는 사용자가 요청할 때만.
- README는 사용자용; 에이전트 맥락은 이 AGENTS.md + `.cursor/rules/`.
- 프론트는 vanilla JS 유지 — 무거운 프레임워크 도입은 요청 없으면 하지 말 것.
- 플랜에서 제외된 것: DO/Agents SDK, stdio MCP, OAuth MCP, 도구 승인 UI, Cursor rules glob 완전 호환.

## 최근까지 한 일 (세션 요약)

1. 에이전트 풀세트: Worker 툴 루프, rules/skills, Brave 검색, MCP HTTP, UI 모드 토글
2. API 키 localStorage 유지 UX 강화 (빈 저장 시 보존, blur persist, 키 삭제)
3. 페르소나 **니무** + 존댓말·한국어 기본 프롬프트
4. 일반 웹 LLM 수준으로 규칙 보강 (응답 형식, 안전, 날짜, custom instructions 우선순위)

## 다음에 손대기 좋은 곳

- `config/mcp.json`에 실제 Streamable HTTP MCP 연결
- 에이전트 기본 모델을 키/카탈로그에서 실제로 tool calling 되는 ID로 재확인
- 대화 히스토리 영속화(원하면) — 현재는 의도적으로 비영속
- 마크다운 렌더링(답변에 코드블록이 많아지면)

## 건드리면 깨지기 쉬운 것

- `wrangler.toml`의 `[[rules]] type = "Text" globs = ["**/*.md"]` — 없으면 rules/skills import 실패
- `bundled-content.js`와 `rules/`/`skills/` 파일 목록 불일치
- `/api/agent` CORS 헤더에 `X-Brave-Api-Key` 포함 여부
- localStorage 스키마: `apiKey` / `agentModel` / `mode` / `braveApiKey` / `customInstructions`
