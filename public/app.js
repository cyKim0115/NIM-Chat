const STORAGE_KEY = "nvidia-chat-settings-v1";

const CHAT_MODELS = [
  { id: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B" },
  { id: "google/gemma-2-9b-it", label: "Gemma 2 9B" },
  { id: "mistralai/mistral-7b-instruct-v0.3", label: "Mistral 7B" },
  { id: "microsoft/phi-3-mini-128k-instruct", label: "Phi-3 Mini" },
  { id: "deepseek-ai/deepseek-r1-distill-llama-8b", label: "DeepSeek R1 Distill 8B" },
];

const AGENT_MODELS = [
  { id: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B (agent)" },
  { id: "meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B" },
  { id: "mistralai/mistral-7b-instruct-v0.3", label: "Mistral 7B" },
];

const DEFAULT_AGENT_MODEL = "meta/llama-3.1-70b-instruct";

const els = {
  transcript: document.getElementById("transcript"),
  emptyState: document.getElementById("emptyState"),
  form: document.getElementById("chatForm"),
  prompt: document.getElementById("prompt"),
  sendBtn: document.getElementById("sendBtn"),
  stopBtn: document.getElementById("stopBtn"),
  status: document.getElementById("status"),
  modelLabel: document.getElementById("modelLabel"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  settingsForm: document.getElementById("settingsForm"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  mode: document.getElementById("mode"),
  proxyUrl: document.getElementById("proxyUrl"),
  agentUrl: document.getElementById("agentUrl"),
  braveApiKey: document.getElementById("braveApiKey"),
  customInstructions: document.getElementById("customInstructions"),
  modelHint: document.getElementById("modelHint"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  openSettingsFromEmpty: document.getElementById("openSettingsFromEmpty"),
  modeChat: document.getElementById("modeChat"),
  modeAgent: document.getElementById("modeAgent"),
};

/** @type {{ role: "user" | "assistant"; content: string }[]} */
let messages = [];
/** @type {AbortController | null} */
let activeAbort = null;

function defaultSettings() {
  return {
    apiKey: "",
    model: CHAT_MODELS[0].id,
    agentModel: DEFAULT_AGENT_MODEL,
    mode: "chat",
    proxyUrl: "/api/chat",
    agentUrl: "/api/agent",
    braveApiKey: "",
    customInstructions: "",
  };
}

function loadSettings() {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

/**
 * Persist settings to this device (localStorage).
 * @param {ReturnType<typeof defaultSettings>} next
 * @returns {boolean}
 */
function saveSettings(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch (err) {
    console.warn("settings save failed", err);
    setStatus("이 기기 저장에 실패했습니다. 브라우저 저장소/시크릿 모드를 확인하세요.");
    return false;
  }
}

/**
 * Read the settings form. Empty secret fields keep the previously stored values
 * so reopening the sheet and saving cannot wipe keys by accident.
 */
function readSettingsFromForm() {
  const prev = loadSettings();
  const mode = els.mode.value === "agent" ? "agent" : "chat";
  const apiKeyInput = els.apiKey.value.trim();
  const braveInput = els.braveApiKey.value.trim();
  const next = {
    ...prev,
    apiKey: apiKeyInput || prev.apiKey,
    braveApiKey: braveInput || prev.braveApiKey,
    mode,
    proxyUrl: els.proxyUrl.value.trim() || "/api/chat",
    agentUrl: els.agentUrl.value.trim() || "/api/agent",
    customInstructions: els.customInstructions.value.slice(0, 2000),
  };
  if (mode === "agent") {
    next.agentModel = els.model.value;
  } else {
    next.model = els.model.value;
  }
  return next;
}

function syncSecretPlaceholders(settings) {
  els.apiKey.placeholder = settings.apiKey
    ? "이 기기에 저장됨 · 변경 시에만 입력"
    : "nvapi-...";
  els.braveApiKey.placeholder = settings.braveApiKey
    ? "이 기기에 저장됨 · 변경 시에만 입력"
    : "BSA...";
}

function modelsForMode(mode) {
  return mode === "agent" ? AGENT_MODELS : CHAT_MODELS;
}

function fillModelSelect(mode, selected) {
  const list = modelsForMode(mode);
  els.model.innerHTML = "";
  let found = false;
  for (const m of list) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.id === selected) {
      opt.selected = true;
      found = true;
    }
    els.model.appendChild(opt);
  }
  if (!found && list[0]) {
    els.model.value = list[0].id;
  }
}

function modelLabel(id, mode) {
  const hit = modelsForMode(mode).find((m) => m.id === id);
  if (hit) return hit.label;
  return (
    CHAT_MODELS.find((m) => m.id === id)?.label ||
    AGENT_MODELS.find((m) => m.id === id)?.label ||
    id
  );
}

function activeModel(settings) {
  return settings.mode === "agent" ? settings.agentModel : settings.model;
}

function setStatus(text) {
  els.status.textContent = text || "";
}

function syncModeToggle(mode) {
  els.modeChat.classList.toggle("active", mode === "chat");
  els.modeAgent.classList.toggle("active", mode === "agent");
  els.prompt.placeholder =
    mode === "agent"
      ? "에이전트에게 질문하세요 (@skill web-search 가능)"
      : "메시지를 입력하세요";
}

function syncChrome() {
  const settings = loadSettings();
  const model = activeModel(settings);
  const modeTag = settings.mode === "agent" ? "에이전트 · " : "";
  els.modelLabel.textContent = `${modeTag}${modelLabel(model, settings.mode)}`;
  syncModeToggle(settings.mode);
  const hasKey = Boolean(settings.apiKey.trim());
  els.sendBtn.disabled = !hasKey || Boolean(activeAbort);
  if (!hasKey) {
    setStatus("설정에서 NVIDIA API 키를 입력하세요.");
  } else if (!activeAbort) {
    setStatus(settings.mode === "agent" ? "에이전트 모드" : "");
  }
}

function hideEmpty() {
  if (els.emptyState) els.emptyState.hidden = true;
}

function showEmptyIfNeeded() {
  if (messages.length === 0 && els.emptyState) {
    els.emptyState.hidden = false;
  }
}

function appendMessage(role, content, { streaming = false, error = false } = {}) {
  hideEmpty();
  const node = document.createElement("article");
  node.className = `msg ${error ? "error" : role}${streaming ? " streaming" : ""}`;
  node.textContent = content;
  els.transcript.appendChild(node);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  return node;
}

/**
 * @param {string} name
 * @param {object} args
 * @param {string} [id]
 */
function appendToolCard(name, args, id) {
  hideEmpty();
  const node = document.createElement("details");
  node.className = "tool-card";
  node.dataset.toolId = id || name;
  const summary = document.createElement("summary");
  summary.innerHTML = `<span class="tool-name">${escapeHtml(name)}</span><span class="tool-state">running…</span>`;
  const pre = document.createElement("pre");
  pre.className = "tool-body";
  pre.textContent = `args:\n${JSON.stringify(args ?? {}, null, 2)}`;
  node.appendChild(summary);
  node.appendChild(pre);
  els.transcript.appendChild(node);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  return node;
}

/**
 * @param {HTMLElement} card
 * @param {string} result
 */
function finishToolCard(card, result) {
  const state = card.querySelector(".tool-state");
  if (state) state.textContent = "done";
  const pre = card.querySelector(".tool-body");
  if (pre) {
    pre.textContent = `${pre.textContent}\n\nresult:\n${result}`;
  }
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function autoGrow() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 140)}px`;
}

function openSettings() {
  const settings = loadSettings();
  // Keep password fields empty when a key is already stored so browsers don't
  // fight autofill, and so Save with blank fields preserves the stored key.
  els.apiKey.value = "";
  els.braveApiKey.value = "";
  syncSecretPlaceholders(settings);
  els.mode.value = settings.mode;
  fillModelSelect(settings.mode, activeModel(settings));
  els.proxyUrl.value = settings.proxyUrl;
  els.agentUrl.value = settings.agentUrl;
  els.customInstructions.value = settings.customInstructions;
  els.modelHint.hidden = settings.mode !== "agent";
  els.settingsDialog.showModal();
}

function setBusy(busy) {
  els.sendBtn.hidden = busy;
  els.stopBtn.hidden = !busy;
  els.prompt.disabled = busy;
  els.sendBtn.disabled = busy || !loadSettings().apiKey.trim();
}

/**
 * Parse SSE stream with named events.
 * @param {ReadableStream} body
 * @param {(event: string, data: object) => void} onEvent
 */
async function readSse(body, onEvent, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n/);
    buffer = parts.pop() ?? "";

    for (const line of parts) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          onEvent(eventName, JSON.parse(raw));
        } catch {
          onEvent(eventName, { raw });
        }
        continue;
      }
      if (line.trim() === "") {
        eventName = "message";
      }
    }
  }
}

async function streamChat(userText) {
  const settings = loadSettings();
  if (!settings.apiKey.trim()) {
    openSettings();
    setStatus("API 키가 필요합니다.");
    return;
  }

  messages.push({ role: "user", content: userText });
  appendMessage("user", userText);

  const assistantNode = appendMessage("assistant", "", { streaming: true });
  messages.push({ role: "assistant", content: "" });

  activeAbort = new AbortController();
  setBusy(true);
  setStatus("응답 생성 중…");

  try {
    const proxy = settings.proxyUrl.trim() || "/api/chat";
    const res = await fetch(proxy, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: messages.slice(0, -1),
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1024,
        stream: true,
      }),
      signal: activeAbort.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `요청 실패 (${res.status})`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("스트림을 읽을 수 없습니다.");

    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta =
            json.choices?.[0]?.delta?.content ??
            json.choices?.[0]?.message?.content ??
            "";
          if (delta) {
            full += delta;
            assistantNode.textContent = full;
            messages[messages.length - 1].content = full;
            els.transcript.scrollTop = els.transcript.scrollHeight;
          }
        } catch {
          // ignore partial JSON chunks
        }
      }
    }

    assistantNode.classList.remove("streaming");
    if (!full.trim()) {
      assistantNode.textContent = "(빈 응답)";
      messages[messages.length - 1].content = "(빈 응답)";
    }
    setStatus("");
  } catch (err) {
    assistantNode.remove();
    messages.pop();
    if (err?.name === "AbortError") {
      setStatus("생성을 중지했습니다.");
    } else {
      const msg = err?.message || String(err);
      appendMessage("assistant", msg, { error: true });
      setStatus("오류가 발생했습니다.");
    }
  } finally {
    activeAbort = null;
    setBusy(false);
    syncChrome();
    els.prompt.focus();
  }
}

async function streamAgent(userText) {
  const settings = loadSettings();
  if (!settings.apiKey.trim()) {
    openSettings();
    setStatus("API 키가 필요합니다.");
    return;
  }

  messages.push({ role: "user", content: userText });
  appendMessage("user", userText);

  const assistantNode = appendMessage("assistant", "", { streaming: true });
  messages.push({ role: "assistant", content: "" });

  /** @type {Map<string, HTMLElement>} */
  const toolCards = new Map();

  activeAbort = new AbortController();
  setBusy(true);
  setStatus("에이전트 실행 중…");

  try {
    const url = settings.agentUrl.trim() || "/api/agent";
    /** @type {Record<string, string>} */
    const headers = {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (settings.braveApiKey.trim()) {
      headers["X-Brave-Api-Key"] = settings.braveApiKey.trim();
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.agentModel || DEFAULT_AGENT_MODEL,
        messages: messages.slice(0, -1),
        braveApiKey: settings.braveApiKey.trim() || undefined,
        customInstructions: settings.customInstructions || undefined,
      }),
      signal: activeAbort.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `요청 실패 (${res.status})`);
    }

    if (!res.body) throw new Error("스트림을 읽을 수 없습니다.");

    let full = "";
    let gotError = null;

    await readSse(
      res.body,
      (event, data) => {
        if (event === "status" && data?.message) {
          setStatus(data.message);
        } else if (event === "text" && data?.delta) {
          full += data.delta;
          assistantNode.textContent = full;
          messages[messages.length - 1].content = full;
          els.transcript.scrollTop = els.transcript.scrollHeight;
        } else if (event === "tool_start") {
          const id = data.id || data.name;
          const card = appendToolCard(data.name || "tool", data.args, id);
          toolCards.set(id, card);
        } else if (event === "tool_result") {
          const id = data.id || data.name;
          const card = toolCards.get(id);
          if (card) finishToolCard(card, data.result || "");
        } else if (event === "error") {
          gotError = data?.message || "Agent error";
        }
      },
      activeAbort.signal
    );

    assistantNode.classList.remove("streaming");
    if (gotError) {
      if (!full.trim()) {
        assistantNode.remove();
        messages.pop();
        appendMessage("assistant", gotError, { error: true });
      } else {
        appendMessage("assistant", gotError, { error: true });
      }
      setStatus("오류가 발생했습니다.");
    } else if (!full.trim()) {
      assistantNode.textContent = "(빈 응답)";
      messages[messages.length - 1].content = "(빈 응답)";
      setStatus("");
    } else {
      setStatus("");
    }
  } catch (err) {
    assistantNode.remove();
    messages.pop();
    if (err?.name === "AbortError") {
      setStatus("생성을 중지했습니다.");
    } else {
      appendMessage("assistant", err?.message || String(err), { error: true });
      setStatus("오류가 발생했습니다.");
    }
  } finally {
    activeAbort = null;
    setBusy(false);
    syncChrome();
    els.prompt.focus();
  }
}

function sendMessage(text) {
  const settings = loadSettings();
  if (settings.mode === "agent") {
    streamAgent(text);
  } else {
    streamChat(text);
  }
}

function setMode(mode) {
  const settings = loadSettings();
  const next = { ...settings, mode };
  if (mode === "agent") {
    const allowed = AGENT_MODELS.some((m) => m.id === next.agentModel);
    if (!allowed) next.agentModel = DEFAULT_AGENT_MODEL;
  }
  saveSettings(next);
  syncChrome();
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.prompt.value.trim();
  if (!text || activeAbort) return;
  els.prompt.value = "";
  autoGrow();
  sendMessage(text);
});

els.prompt.addEventListener("input", autoGrow);

els.prompt.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});

els.stopBtn.addEventListener("click", () => {
  activeAbort?.abort();
});

els.settingsBtn.addEventListener("click", openSettings);
els.openSettingsFromEmpty.addEventListener("click", openSettings);

els.modeChat.addEventListener("click", () => setMode("chat"));
els.modeAgent.addEventListener("click", () => setMode("agent"));

els.mode.addEventListener("change", () => {
  const mode = els.mode.value === "agent" ? "agent" : "chat";
  const settings = loadSettings();
  fillModelSelect(mode, mode === "agent" ? settings.agentModel : settings.model);
  els.modelHint.hidden = mode !== "agent";
});

document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  const next = readSettingsFromForm();
  if (!saveSettings(next)) return;
  els.settingsDialog.close();
  syncChrome();
  setStatus(
    next.apiKey
      ? "설정을 이 기기에 저장했습니다. 다음에 다시 열어도 키가 유지됩니다."
      : "설정을 저장했습니다."
  );
});

document.getElementById("clearKeysBtn")?.addEventListener("click", () => {
  const next = {
    ...loadSettings(),
    apiKey: "",
    braveApiKey: "",
  };
  if (!saveSettings(next)) return;
  els.apiKey.value = "";
  els.braveApiKey.value = "";
  syncSecretPlaceholders(next);
  syncChrome();
  setStatus("저장된 API 키를 이 기기에서 삭제했습니다.");
});

/** Persist a single secret as soon as the user leaves the field with a value. */
function persistSecretOnBlur(field, keyName) {
  field.addEventListener("blur", () => {
    const value = field.value.trim();
    if (!value) return;
    const next = { ...loadSettings(), [keyName]: value };
    if (saveSettings(next)) {
      field.value = "";
      syncSecretPlaceholders(next);
      syncChrome();
    }
  });
}

persistSecretOnBlur(els.apiKey, "apiKey");
persistSecretOnBlur(els.braveApiKey, "braveApiKey");

els.clearChatBtn.addEventListener("click", () => {
  messages = [];
  els.transcript.querySelectorAll(".msg, .tool-card").forEach((node) => node.remove());
  showEmptyIfNeeded();
  setStatus("대화를 지웠습니다.");
});

syncChrome();
autoGrow();
{
  const settings = loadSettings();
  syncSecretPlaceholders(settings);
  if (settings.apiKey.trim()) {
    setStatus("저장된 API 키를 불러왔습니다.");
  }
}
