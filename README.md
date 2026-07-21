# NIM Chat (`nvidia-chat`)

모바일 우선 NVIDIA NIM 채팅 웹앱입니다.  
API 키는 브라우저 `localStorage`에만 저장되며, 저장소에 올리지 마세요.

## 왜 Cloudflare Workers인가?

NVIDIA API(`integrate.api.nvidia.com`)는 브라우저 CORS를 막아 GitHub Pages만으로는 대화가 되지 않습니다.  
이 프로젝트는 **Cloudflare Workers(무료) + Static Assets** 로 UI와 `/api/chat` 프록시를 함께 배포합니다.

- 프론트: 정적 HTML/CSS/JS (`public/`)  
- 프록시: `src/worker.js` (서버에서 NVIDIA로 전달 + CORS 허용)

GitHub에 푸시한 뒤 Cloudflare가 자동 배포하게 두면 됩니다.

## 준비물

1. [NVIDIA API 키](https://build.nvidia.com/settings/api-keys) (`nvapi-...`)
2. [Cloudflare](https://dash.cloudflare.com/) 계정 (무료)
3. GitHub 저장소 (선택, 권장)

## 배포 (권장: GitHub 연동)

1. 이 폴더를 GitHub 저장소로 푸시합니다.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → Git 저장소 연결 (Worker)
3. 배포 명령이 `npx wrangler versions upload` 또는 `npx wrangler deploy` 인지 확인합니다.
4. Deploy 후 Worker URL 접속
5. 앱에서 설정 → API 키 입력 → 저장

프록시 URL 기본값은 `/api/chat` 이라 그대로 두면 됩니다.

## 로컬 실행

```bash
npm run dev
```

브라우저에서 `http://127.0.0.1:8788` 을 엽니다.  
(정적 파일만 열면 프록시가 없어 대화가 실패합니다.)

## CLI로 바로 배포

```bash
npx wrangler login
npm run deploy
```

## 사용 팁

- 키·모델·프록시 URL은 기기 설정의 **설정**에서 바꿉니다.
- Rate limit(~분당 요청 수)에 걸리면 잠시 후 다시 시도하세요. 무료 티어는 프로토타입용입니다.
- 모델을 바꿔도 안 되면 [NVIDIA 카탈로그](https://build.nvidia.com/)에서 해당 모델 ID를 확인하세요.

## 보안

- API 키를 코드/README/커밋에 넣지 마세요.
- 프록시는 요청의 `Authorization` 헤더를 그대로 NVIDIA로 전달합니다. 키는 사용자 기기에 둡니다.
- 공개 URL이므로, 타인과 키를 공유하지 마세요.
