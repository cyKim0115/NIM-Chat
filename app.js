const STORAGE_KEY = "nvidia-chat-settings-v1";

const MODELS = [
  {
    id: "meta/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B",
  },
  {
    id: "nvidia/llama-3.1-nemotron-70b-instruct",
    label: "Nemotron 70B",
  },
  {
    id: "google/gemma-2-9b-it",
    label: "Gemma 2 9B",
  },
  {
    id: "mistralai/mistral-7b-instruct-v0.3",
    label: "Mistral 7B",
  },
  {
    id: "microsoft/phi-3-mini-128k-instruct",
    label: "Phi-3 Mini",
  },
  {
    id: "deepseek-ai/deepseek-r1-distill-llama-8b",
    label: "DeepSeek R1 Distill 8B",
  },
];

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
  proxyUrl: document.getElementById("proxyUrl"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  openSettingsFromEmpty: document.getElementById("openSettingsFromEmpty"),
};

/** @type {{ role: "user" | "assistant"; content: string }[]} */
let messages = [];
/** @type {AbortController | null} */
let activeAbort = null;

function loadSettings() {
  const defaults = {
    apiKey: "",
    model: MODELS[0].id,
    proxyUrl: "/api/chat",
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveSettings(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function fillModelSelect(selected) {
  els.model.innerHTML = "";
  for (const m of MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.id === selected) opt.selected = true;
    els.model.appendChild(opt);
  }
}

function modelLabel(id) {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

function setStatus(text) {
  els.status.textContent = text || "";
}

function syncChrome() {
  const settings = loadSettings();
  els.modelLabel.textContent = modelLabel(settings.model);
  const hasKey = Boolean(settings.apiKey.trim());
  els.sendBtn.disabled = !hasKey || Boolean(activeAbort);
  if (!hasKey) {
    setStatus("설정에서 NVIDIA API 키를 입력하세요.");
  } else if (!activeAbort) {
    setStatus("");
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

function autoGrow() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 140)}px`;
}

function openSettings() {
  const settings = loadSettings();
  els.apiKey.value = settings.apiKey;
  fillModelSelect(settings.model);
  els.proxyUrl.value = settings.proxyUrl;
  els.settingsDialog.showModal();
}

function setBusy(busy) {
  els.sendBtn.hidden = busy;
  els.stopBtn.hidden = !busy;
  els.prompt.disabled = busy;
  els.sendBtn.disabled = busy || !loadSettings().apiKey.trim();
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

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.prompt.value.trim();
  if (!text || activeAbort) return;
  els.prompt.value = "";
  autoGrow();
  streamChat(text);
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

document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  saveSettings({
    apiKey: els.apiKey.value.trim(),
    model: els.model.value,
    proxyUrl: els.proxyUrl.value.trim() || "/api/chat",
  });
  els.settingsDialog.close();
  syncChrome();
});

els.clearChatBtn.addEventListener("click", () => {
  messages = [];
  els.transcript
    .querySelectorAll(".msg")
    .forEach((node) => node.remove());
  showEmptyIfNeeded();
  setStatus("대화를 지웠습니다.");
});

fillModelSelect(loadSettings().model);
syncChrome();
autoGrow();
