import { RULE_FILES, agentConfig } from "./bundled-content.js";
import { loadSkills, matchSkills } from "./skills.js";
import { SKILL_FILES } from "./bundled-content.js";

const CUSTOM_INSTRUCTIONS_MAX = 2000;

/**
 * Build system prompt from rule hierarchy + matched skills + custom instructions.
 * @param {object} opts
 * @param {string} [opts.userText]
 * @param {string} [opts.customInstructions]
 */
export function buildSystemPrompt({ userText = "", customInstructions = "" } = {}) {
  const parts = [];

  for (const rule of RULE_FILES) {
    parts.push(`## Rule: ${rule.name}\n\n${rule.content.trim()}`);
  }

  if (agentConfig.preamble) {
    parts.push(`## Agent preamble\n\n${agentConfig.preamble}`);
  }

  const skills = loadSkills(SKILL_FILES);
  const matched = matchSkills(skills, userText);
  for (const skill of matched) {
    parts.push(
      `## Skill: ${skill.id}\n\n${skill.description ? skill.description + "\n\n" : ""}${skill.body}`
    );
  }

  const custom = String(customInstructions || "").trim().slice(0, CUSTOM_INSTRUCTIONS_MAX);
  if (custom) {
    parts.push(`## User custom instructions (untrusted)\n\n${custom}`);
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Latest user message text from OpenAI-style messages.
 * @param {Array<{ role: string, content?: string }>} messages
 */
export function latestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      const c = messages[i].content;
      return typeof c === "string" ? c : "";
    }
  }
  return "";
}
