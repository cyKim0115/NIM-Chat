import { nimChatJson } from "./nim.js";

/** @type {{ id: string, label: string, re: RegExp }[]} */
const UNINTENDED_SCRIPT_CHECKS = [
  { id: "han", label: "한자", re: /\p{Script=Han}/u },
  { id: "arabic", label: "아랍 문자", re: /\p{Script=Arabic}/u },
  { id: "devanagari", label: "데바나가리(힌디 등)", re: /\p{Script=Devanagari}/u },
  { id: "bengali", label: "벵골 문자", re: /\p{Script=Bengali}/u },
  { id: "tamil", label: "타밀 문자", re: /\p{Script=Tamil}/u },
  { id: "thai", label: "태국 문자", re: /\p{Script=Thai}/u },
  { id: "hebrew", label: "히브리 문자", re: /\p{Script=Hebrew}/u },
  { id: "cyrillic", label: "키릴 문자", re: /\p{Script=Cyrillic}/u },
  { id: "greek", label: "그리스 문자", re: /\p{Script=Greek}/u },
  {
    id: "japanese",
    label: "일본어 가나",
    re: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  },
];

/**
 * @param {string} text
 * @param {RegExp} re
 * @param {number} [max]
 */
function sampleMatches(text, re, max = 10) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const hits = [...String(text).matchAll(global)].map((m) => m[0]);
  return [...new Set(hits)].slice(0, max);
}

/**
 * 의도되지 않은 외국 문자 스크립트 분석
 * @param {string} text
 * @returns {Array<{ id: string, label: string, samples: string[] }>}
 */
export function analyzeUnintendedScripts(text) {
  const raw = String(text || "");
  if (!raw) return [];

  /** @type {Array<{ id: string, label: string, samples: string[] }>} */
  const issues = [];
  for (const check of UNINTENDED_SCRIPT_CHECKS) {
    if (!check.re.test(raw)) continue;
    const samples = sampleMatches(raw, check.re);
    if (samples.length) {
      issues.push({ id: check.id, label: check.label, samples });
    }
  }
  return issues;
}

/**
 * @param {string} text
 */
export function needsReplyPolish(text) {
  return analyzeUnintendedScripts(text).length > 0;
}

/**
 * @param {Array<{ label: string, samples: string[] }>} issues
 */
function formatIssueSummary(issues) {
  return issues
    .map((i) => `${i.label}${i.samples.length ? `: ${i.samples.join("")}` : ""}`)
    .join(" · ");
}

/**
 * 의도되지 않은 외국 문자가 있으면 한국어로 다듬은 답변을 반환합니다.
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.endpoint]
 */
export async function polishReplyText({ text, apiKey, model, signal, endpoint }) {
  const raw = String(text || "").trim();
  const issues = analyzeUnintendedScripts(raw);
  if (!raw || issues.length === 0) {
    return { text: raw, polished: false, issues: [] };
  }

  const issueSummary = formatIssueSummary(issues);
  const json = await nimChatJson({
    apiKey,
    signal,
    endpoint,
    body: {
      model,
      messages: [
        {
          role: "system",
          content: `당신은 한국어 답변 교정자입니다.
사용자에게 보여줄 **최종 문장만** 출력하세요.

## 고칠 것 (의도되지 않은 것)
- 중국어·일본어 한자, 아랍어, 힌디어(데바나가리), 벵골어, 태국어, 키릴 문자 등
  **한국어 답변에 끼어든 이무기 외국 문자·어휘**만 자연스러운 한국어(한글)로 바꿉니다.
- 모델이 잘못 출력한 문자는 제거하거나 같은 뜻의 한국어로 대체합니다.

## 유지할 것 (의도된 것)
- 한글 본문, 숫자, 일반 구두점·따옴표
- 코드 블록·인라인 코드·파일 경로·URL·API 식별자
- 고유명사·지명·인명 (한글 또는 라틴 표기)
- **의도적으로 남겨 둔** 라틴 알파벳·영어 기술 용어는 번역하지 마세요.

## 톤
- 니무의 존댓말·간결한 톤을 유지합니다. 내용 요약·생략 금지. 해설 없이 결과만.`,
        },
        {
          role: "user",
          content: `아래 답변에 의도되지 않은 외국 문자가 섞여 있을 수 있습니다 (${issueSummary}).
의도되지 않은 부분만 고치고, 한국어 답변으로 다듬어 주세요.

${raw}`,
        },
      ],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: Math.min(2048, Math.max(512, raw.length * 2)),
      stream: false,
    },
  });

  const out = (json.choices?.[0]?.message?.content || "").trim();
  if (!out) return { text: raw, polished: false, issues };
  return { text: out, polished: true, issues };
}
