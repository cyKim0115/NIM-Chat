/**
 * Parse Cursor-like SKILL.md frontmatter + body.
 * @param {string} raw
 */
export function parseSkillMarkdown(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return {
      name: "",
      description: "",
      triggers: [],
      body: raw.trim(),
    };
  }

  const fm = match[1];
  const body = match[2].trim();
  /** @type {Record<string, string | string[]>} */
  const meta = { triggers: [] };
  let currentListKey = null;

  for (const line of fm.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && currentListKey) {
      const arr = meta[currentListKey];
      if (Array.isArray(arr)) arr.push(listItem[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val === "" || val === "|") {
      currentListKey = key;
      meta[key] = [];
    } else {
      currentListKey = null;
      meta[key] = val;
    }
  }

  return {
    name: String(meta.name || ""),
    description: String(meta.description || ""),
    triggers: Array.isArray(meta.triggers) ? meta.triggers.map(String) : [],
    body,
  };
}

/**
 * @param {{ name: string, content: string }[]} skillFiles
 */
export function loadSkills(skillFiles) {
  return skillFiles.map((f) => {
    const parsed = parseSkillMarkdown(f.content);
    return {
      id: parsed.name || f.name,
      description: parsed.description,
      triggers: parsed.triggers,
      body: parsed.body,
      raw: f.content,
    };
  });
}

/**
 * Match skills by @skill name or trigger keywords in the latest user message.
 * @param {ReturnType<typeof loadSkills>} skills
 * @param {string} userText
 */
export function matchSkills(skills, userText) {
  const text = userText || "";
  const lower = text.toLowerCase();
  const explicit = new Set();
  const atRe = /@skill\s+([a-z0-9_-]+)/gi;
  let m;
  while ((m = atRe.exec(text))) {
    explicit.add(m[1].toLowerCase());
  }

  return skills.filter((skill) => {
    if (explicit.has(skill.id.toLowerCase())) return true;
    return skill.triggers.some((t) => {
      const needle = String(t).toLowerCase();
      return needle && lower.includes(needle);
    });
  });
}
