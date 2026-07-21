import rule00 from "../../rules/00-base.md";
import rule10 from "../../rules/10-safety.md";
import rule20 from "../../rules/20-nim-chat.md";
import skillWebSearch from "../../skills/web-search/SKILL.md";
import skillSummarizeUrl from "../../skills/summarize-url/SKILL.md";
import agentConfig from "../../config/agent.json";

/** @type {{ name: string, content: string }[]} */
export const RULE_FILES = [
  { name: "00-base.md", content: rule00 },
  { name: "10-safety.md", content: rule10 },
  { name: "20-nim-chat.md", content: rule20 },
].sort((a, b) => a.name.localeCompare(b.name));

/** @type {{ name: string, content: string }[]} */
export const SKILL_FILES = [
  { name: "web-search", content: skillWebSearch },
  { name: "summarize-url", content: skillSummarizeUrl },
];

export { agentConfig };
