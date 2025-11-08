const API_URL = "https://api.euron.one/api/v1/euri/chat/completions";
const API_KEY = "euri-d0c00732524b1b5ae66443fd154d33e118a6d7c22f2ce04a823f9bf58a3125df";

const STORAGE_KEYS = {
  callName: "euriCallName",
  sessions: "euriSessions",
  activeSession: "euriActiveSession",
};

const FALLBACK_CALL_NAME = "Euri";
const SESSION_LIMIT = 20;

const dom = {
  conversation: document.getElementById("conversation"),
  template: document.getElementById("message-template"),
  input: document.getElementById("input-text"),
  send: document.getElementById("button-send"),
  voice: document.getElementById("button-voice"),
  clear: document.getElementById("button-clear"),
  export: document.getElementById("button-export"),
  toggleSpeech: document.getElementById("toggle-speech"),
  toggleCompact: document.getElementById("toggle-compact"),
  statusConnection: document.getElementById("status-connection"),
  statusVoice: document.getElementById("status-voice"),
  statusReminders: document.getElementById("status-reminders"),
  toastContainer: document.querySelector(".toast-container"),
  suggestionList: document.getElementById("suggestion-list"),
  chatSubtitle: document.getElementById("chat-subtitle"),
  callNameInput: document.getElementById("input-call-name"),
  historyList: document.getElementById("history-list"),
  newSession: document.getElementById("button-new-session"),
  historyPreview: document.getElementById("history-preview"),
};

const defaultPlaceholder = dom.input ? dom.input.placeholder : "";
const defaultSendLabel = dom.send ? dom.send.textContent : "Send";

const defaults = {
  initialPlaceholder: defaultPlaceholder,
  sendLabel: defaultSendLabel,
};

const assistantState = {
  messages: [],
  reminders: loadReminders(),
  isStreaming: false,
  isListening: false,
  autoSpeak: JSON.parse(localStorage.getItem("autoSpeak") ?? "true"),
  compactMode: JSON.parse(localStorage.getItem("compactMode") ?? "false"),
  recognition: null,
  synthesis: window.speechSynthesis,
  controller: null,
  callName: FALLBACK_CALL_NAME,
  sessions: [],
  currentSessionId: null,
};

const LOCAL_COMMANDS = [
  {
    id: "time",
    title: "Ask for the current time",
    example: "What time is it right now?",
    match: /\bwhat(?:'s| is)? the time\b|\bcurrent time\b/i,
    handler: () => {
      const now = new Date();
      return `It is ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    },
  },
  {
    id: "date",
    title: "Ask for today's date",
    example: "What's today's date?",
    match: /\bwhat(?:'s| is)? the date\b|\btoday'?s date\b/i,
    handler: () => {
      const now = new Date();
      return `Today is ${now.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })}.`;
    },
  },
  {
    id: "theme-dark",
    title: "Switch to dark mode",
    example: "Enable dark theme",
    match: /\b(dark|night) (mode|theme)\b|\bswitch to dark\b/i,
    handler: () => {
      document.documentElement.style.setProperty("color-scheme", "dark");
      return "Dark mode is now active.";
    },
  },
  {
    id: "theme-light",
    title: "Switch to light mode",
    example: "Enable light theme",
    match: /\b(light) (mode|theme)\b|\bswitch to light\b/i,
    handler: () => {
      document.documentElement.style.setProperty("color-scheme", "light");
      return "Light mode is now active.";
    },
  },
  {
    id: "open-site",
    title: "Open a website",
    example: "Open github.com",
    match: /\bopen (?:the )?(?<site>https?:\/\/[^\s]+|[\w.-]+\.[a-z]{2,})\b/i,
    handler: (match) => {
      const site = match.groups?.site ?? "";
      const url = site.startsWith("http") ? site : `https://${site}`;
      window.open(url, "_blank", "noopener");
      return `Opening ${url} in a new tab.`;
    },
  },
  {
    id: "create-reminder",
    title: "Create a reminder",
    example: "Remind me to drink water in 30 minutes",
    match: /\bremind me\b/i,
    handler: (_, input) => {
      const reminder = {
        id: crypto.randomUUID(),
        text: input,
        createdAt: new Date().toISOString(),
      };
      assistantState.reminders.push(reminder);
      persistReminders();
      updateReminderStatus();
      return "Reminder saved locally. I'll keep it in mind for you.";
    },
  },
  {
    id: "list-reminders",
    title: "List saved reminders",
    example: "What reminders do I have?",
    match: /\b(list|show) (my )?reminders\b/i,
    handler: () => {
      if (!assistantState.reminders.length) {
        return "You don't have any reminders yet.";
      }
      return assistantState.reminders
        .map((r, idx) => `${idx + 1}. ${r.text}`)
        .join("\n");
    },
  },
  {
    id: "clear-reminders",
    title: "Clear reminders",
    example: "Clear all reminders",
    match: /\b(clear|delete|remove) (all )?reminders\b/i,
    handler: () => {
      assistantState.reminders = [];
      persistReminders();
      updateReminderStatus();
      return "All reminders have been cleared.";
    },
  },
  {
    id: "help",
    title: "Show command help",
    example: "What can you do?",
    match: /\b(help|what can you do|show commands)\b/i,
    handler: () =>
      "Here are a few ideas:\n• Ask general questions\n• Say 'Remind me...' to save a note\n• Ask for the time or date\n• Say 'Open' followed by a website\n• Toggle dark or light modes",
  },
];

const SUGGESTIONS = [
  {
    label: "Plan my day",
    prompt: "I have 30 minutes free. Suggest a productive plan.",
    shortcut: "⌘1",
  },
  {
    label: "Meeting summary",
    prompt: "Summarize the key outcomes from my latest team meeting notes.",
    shortcut: "⌘2",
  },
  {
    label: "Voice command demo",
    prompt: "Show me what voice commands you understand.",
    shortcut: "⌘3",
  },
  {
    label: "Creative writing",
    prompt: "Write a short motivational message for the team stand-up.",
    shortcut: "⌘4",
  },
];

init();

function init() {
  populateSuggestions();
  updateReminderStatus();
  applyUserPreferences();
  setupListeners();
  setConnectionStatus(navigator.onLine ? "Online" : "Offline");
  assistantState.callName = loadCallName();
  assistantState.sessions = loadSessions();
  applyCallName(assistantState.callName);
  ensureSessions();
  loadSession(assistantState.currentSessionId, { silent: true });
  if (!assistantState.messages.length) {
    seedGreeting({ silent: true });
  } else {
    renderConversationFromState({ silent: true });
  }
  renderHistory();
}

function setupListeners() {
  dom.send.addEventListener("click", () => submitMessage());
  dom.clear.addEventListener("click", handleClearChat);
  dom.export.addEventListener("click", exportConversation);
  dom.input.addEventListener("input", autoResizeInput);
  dom.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  });

  dom.voice.addEventListener("mousedown", () => startVoiceCapture({ holdToTalk: true }));
  dom.voice.addEventListener("mouseup", stopVoiceCapture);
  dom.voice.addEventListener("mouseleave", () => {
    if (assistantState.isListening && assistantState.recognition?.continuous === false) {
      stopVoiceCapture();
    }
  });
  dom.voice.addEventListener("click", () => toggleVoiceCapture());
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && event.target === document.body) {
      event.preventDefault();
      startVoiceCapture({ holdToTalk: true });
    }
    if (event.metaKey && ["Digit1", "Digit2", "Digit3", "Digit4"].includes(event.code)) {
      const index = Number(event.code.replace("Digit", "")) - 1;
      const suggestion = SUGGESTIONS[index];
      if (suggestion) {
        dom.input.value = suggestion.prompt;
        submitMessage();
      }
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space" && assistantState.recognition?.continuous === false) {
      stopVoiceCapture();
    }
  });

  dom.toggleSpeech.checked = assistantState.autoSpeak;
  dom.toggleSpeech.addEventListener("change", (event) => {
    assistantState.autoSpeak = event.target.checked;
    localStorage.setItem("autoSpeak", JSON.stringify(assistantState.autoSpeak));
    showToast(`Auto speak ${assistantState.autoSpeak ? "enabled" : "disabled"}.`);
  });

  dom.toggleCompact.checked = assistantState.compactMode;
  dom.toggleCompact.addEventListener("change", (event) => {
    assistantState.compactMode = event.target.checked;
    localStorage.setItem("compactMode", JSON.stringify(assistantState.compactMode));
    applyCompactMode();
  });

  if (dom.callNameInput) {
    dom.callNameInput.value = assistantState.callName;
    const handleCallNameCommit = () => {
      const nextName = dom.callNameInput.value.trim();
      applyCallName(nextName);
    };
    dom.callNameInput.addEventListener("change", handleCallNameCommit);
    dom.callNameInput.addEventListener("blur", handleCallNameCommit);
    dom.callNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        dom.callNameInput.blur();
      }
    });
  }

  dom.newSession?.addEventListener("click", () => startNewSession());
  dom.historyList?.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-session-id]");
    if (!target) return;
    const sessionId = target.dataset.sessionId;
    if (sessionId) {
      switchSession(sessionId);
    }
  });

  window.addEventListener("online", () => setConnectionStatus("Online"));
  window.addEventListener("offline", () => setConnectionStatus("Offline"));

  if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    assistantState.recognition = new Recognition();
    assistantState.recognition.lang = navigator.language || "en-US";
    assistantState.recognition.interimResults = false;
    assistantState.recognition.continuous = false;
    assistantState.recognition.maxAlternatives = 1;

    assistantState.recognition.addEventListener("start", () => setVoiceStatus(true));
    assistantState.recognition.addEventListener("end", () => setVoiceStatus(false));
    assistantState.recognition.addEventListener("result", (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        dom.input.value = transcript;
        submitMessage();
      }
    });
    assistantState.recognition.addEventListener("error", (event) => {
      setVoiceStatus(false);
      showToast(`Voice error: ${event.error}`);
    });
  } else {
    dom.voice.disabled = true;
    dom.voice.title = "Voice recognition is not supported in this browser.";
  }
}

function autoResizeInput() {
  dom.input.style.height = "auto";
  dom.input.style.height = `${dom.input.scrollHeight}px`;
}

function submitMessage() {
  const rawContent = dom.input.value.trim();
  if (!rawContent || assistantState.isStreaming) return;

  dom.input.value = "";
  autoResizeInput();
  addMessage("user", rawContent);

  const preparedContent = stripCallNamePrefix(rawContent).trim();
  if (!preparedContent) {
    addAssistantMessage(`Hi! I’m ready when you are, ${assistantState.callName}.`, { silent: false });
    return;
  }

  processMessage(preparedContent);
}

async function processMessage(content) {
  const localResponse = tryLocalCommand(content);
  if (localResponse) {
    addAssistantMessage(localResponse);
    return;
  }

  await queryAssistant(content);
}

function tryLocalCommand(input) {
  for (const command of LOCAL_COMMANDS) {
    const match = input.match(command.match);
    if (match) {
      return command.handler(match, input);
    }
  }
  return null;
}

async function queryAssistant(content) {
  const pendingId = addAssistantMessage("Thinking…", { pending: true });
  setComposerBusy(true);
  setConnectionStatus("Connecting…");
  assistantState.isStreaming = true;
  let responseText = "";

  try {
    const payload = {
      messages: buildConversationPayload(content),
      model: "playai-tts",
      max_tokens: 1000,
      temperature: 0.7,
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: createAbortController().signal,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    responseText = result?.choices?.[0]?.message?.content?.trim();
    if (!responseText) {
      responseText = "I received an empty response. Please try again.";
    }
  } catch (error) {
    console.error(error);
    responseText = `I ran into an issue talking to the Euri service. ${error.message}`;
    showToast("Network request failed. Check your key or connection.");
    setConnectionStatus(navigator.onLine ? "Service issue" : "Offline");
  } finally {
    assistantState.isStreaming = false;
    clearAbortController();
    setConnectionStatus(navigator.onLine ? "Online" : "Offline");
    setComposerBusy(false);
  }

  updateAssistantMessage(pendingId, responseText);
}

function buildConversationPayload(latestContent) {
  const base = [
    {
      role: "system",
      content:
        "You are Euri, an interactive multimodal assistant that helps users manage tasks, answer questions, and execute voice commands in a concise, friendly tone. Provide clear, actionable responses.",
    },
  ];
  const priorMessages = assistantState.messages.map(({ role, content }) => ({ role, content }));
  return [...base, ...priorMessages, { role: "user", content: latestContent }];
}

function addMessage(role, content, { pending = false, silent = false } = {}) {
  const id = crypto.randomUUID();
  if (!pending) {
    const message = { id, role, content };
    assistantState.messages.push(message);
    onSessionUpdated(message);
  }
  renderMessage({ id, role, content, pending });
  if (!silent && role === "assistant" && !pending) {
    speak(content);
  }
  return id;
}

function addAssistantMessage(content, options = {}) {
  const { pending = false, silent = false } = options;
  return addMessage("assistant", content, { pending, silent });
}

function renderMessage({ id, role, content, pending = false }) {
  const clone = dom.template.content.firstElementChild.cloneNode(true);
  clone.dataset.id = id;
  clone.classList.add(role);
  if (assistantState.compactMode) clone.classList.add("compact");

  const avatar = clone.querySelector(".avatar");
  avatar.classList.add(role);

  const author = clone.querySelector(".author");
  author.textContent = role === "user" ? "You" : "Euri";

  const timestamp = clone.querySelector(".timestamp");
  timestamp.textContent = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const contentElement = clone.querySelector(".content");
  if (pending) {
    contentElement.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    clone.dataset.pending = "true";
  } else {
    contentElement.textContent = content;
  }

  dom.conversation.appendChild(clone);
  dom.conversation.scrollTo({ top: dom.conversation.scrollHeight, behavior: "smooth" });
}

function updateAssistantMessage(id, content) {
  const node = dom.conversation.querySelector(`[data-id="${id}"]`);
  if (!node) {
    addAssistantMessage(content);
    return;
  }
  node.dataset.pending = "false";
  node.querySelector(".content").textContent = content;
  const existing = assistantState.messages.find((msg) => msg.id === id);
  let sessionMessage;
  if (existing) {
    existing.content = content;
    sessionMessage = existing;
  } else {
    sessionMessage = { id, role: "assistant", content };
    assistantState.messages.push(sessionMessage);
  }
  onSessionUpdated(sessionMessage);
  speak(content);
}

function setConnectionStatus(text) {
  dom.statusConnection.textContent = text;
}

function setVoiceStatus(isActive) {
  assistantState.isListening = isActive;
  dom.statusVoice.textContent = isActive ? "Listening" : "Idle";
  dom.voice.classList.toggle("listening", isActive);
}

function startVoiceCapture({ holdToTalk = false } = {}) {
  if (assistantState.isStreaming) {
    showToast("Hold on, I'm still responding.");
    return;
  }
  if (!assistantState.recognition || assistantState.isListening) return;
  assistantState.recognition.continuous = !holdToTalk;
  try {
    assistantState.recognition.start();
  } catch (error) {
    if (error.message.includes("started")) return;
    showToast("Voice recognition could not start. Check microphone permissions.");
  }
}

function stopVoiceCapture() {
  if (!assistantState.recognition || !assistantState.isListening) return;
  assistantState.recognition.stop();
}

function toggleVoiceCapture() {
  if (!assistantState.recognition) {
    showToast("Voice recognition is not supported in this browser.");
    return;
  }
  if (assistantState.isListening) {
    stopVoiceCapture();
  } else {
    startVoiceCapture({ holdToTalk: false });
  }
}

function applyCompactMode({ silent = false } = {}) {
  dom.conversation.querySelectorAll(".message").forEach((node) => {
    node.classList.toggle("compact", assistantState.compactMode);
  });
  if (!silent) {
    showToast(`Compact mode ${assistantState.compactMode ? "enabled" : "disabled"}.`);
  }
}

function populateSuggestions() {
  dom.suggestionList.innerHTML = "";
  for (const suggestion of SUGGESTIONS) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${suggestion.label}</span><span class="shortcut">${suggestion.shortcut}</span>`;
    button.addEventListener("click", () => {
      dom.input.value = suggestion.prompt;
      dom.input.focus();
    });
    item.appendChild(button);
    dom.suggestionList.appendChild(item);
  }
}

function setComposerBusy(isBusy) {
  dom.send.disabled = isBusy;
  dom.input.disabled = isBusy;
  dom.voice.disabled = isBusy;
  dom.send.textContent = isBusy ? "Working…" : defaults.sendLabel;
  dom.input.placeholder = isBusy ? "Working on it…" : getIdlePlaceholder();
}

function showToast(message, timeout = 3200) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, timeout);
}

function handleClearChat() {
  if (!confirm("Clear the current chat history?")) return;
  const session = getCurrentSession();
  if (session) {
    session.messages = [];
    assistantState.messages = session.messages;
    session.preview = "";
    session.updatedAt = new Date().toISOString();
  } else {
    assistantState.messages = [];
  }
  dom.conversation.innerHTML = "";
  showToast("Conversation cleared.");
  saveSessions();
  renderHistory();
  seedGreeting({ silent: true });
}

function exportConversation() {
  if (!assistantState.messages.length) {
    showToast("Nothing to export yet.");
    return;
  }
  const lines = assistantState.messages.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`);
  const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `euri-chat-${new Date().toISOString()}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Chat exported.");
}

function loadReminders() {
  try {
    return JSON.parse(localStorage.getItem("euriReminders")) ?? [];
  } catch (error) {
    console.warn("Could not parse reminders", error);
    return [];
  }
}

function persistReminders() {
  localStorage.setItem("euriReminders", JSON.stringify(assistantState.reminders));
}

function updateReminderStatus() {
  dom.statusReminders.textContent = String(assistantState.reminders.length);
}

function speak(text) {
  if (!assistantState.autoSpeak || !("speechSynthesis" in window)) return;
  assistantState.synthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = navigator.language || "en-US";
  assistantState.synthesis.speak(utterance);
}

function createAbortController() {
  assistantState.controller = new AbortController();
  return assistantState.controller;
}

function clearAbortController() {
  assistantState.controller = null;
}

function applyUserPreferences() {
  if (assistantState.compactMode) {
    applyCompactMode({ silent: true });
  }
}

function loadCallName() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.callName);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch (error) {
    console.warn("Could not read call name", error);
  }
  return FALLBACK_CALL_NAME;
}

function applyCallName(nextName) {
  const trimmedInput = (nextName || "").replace(/\s+/g, " ").trim();
  const chosenName = trimmedInput || FALLBACK_CALL_NAME;
  assistantState.callName = chosenName;
  try {
    localStorage.setItem(STORAGE_KEYS.callName, chosenName);
  } catch (error) {
    console.warn("Could not save call name", error);
  }
  if (dom.callNameInput && dom.callNameInput.value !== chosenName) {
    dom.callNameInput.value = chosenName;
  }
  if (dom.chatSubtitle) {
    dom.chatSubtitle.textContent = `Ask anything or say “Hey ${chosenName}…”`;
  }
  if (dom.input) {
    dom.input.placeholder = getIdlePlaceholder();
  }
}

function getIdlePlaceholder() {
  const name = assistantState.callName || FALLBACK_CALL_NAME;
  return `Type your request or say “Hey ${name}…”`;
}

function stripCallNamePrefix(text) {
  const trimmed = text.trim();
  const name = assistantState.callName ? assistantState.callName.trim() : "";
  if (!name) return trimmed;
  const escaped = escapeRegExp(name);
  const greetings = "(?:hey|hi|hello|hola|ok|okay|yo|hiya|hey there)";
  const pattern = new RegExp(
    `(?:\\b${greetings}\\b\\s+)?\\b${escaped}\\b[,!?:\\s]*`,
    "gi"
  );
  const result = trimmed.replace(pattern, " ").replace(/\s{2,}/g, " ").trim();
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadSessions() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEYS.sessions);
  } catch (error) {
    console.warn("Could not read sessions", error);
    raw = null;
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSession).filter(Boolean).sort(sessionSortComparator);
  } catch (error) {
    console.warn("Could not parse saved sessions", error);
    return [];
  }
}

function sanitizeSession(session) {
  if (!session) return null;
  const fallbackDate = new Date().toISOString();
  const createdAt = typeof session.createdAt === "string" && session.createdAt ? session.createdAt : fallbackDate;
  const updatedAt = typeof session.updatedAt === "string" && session.updatedAt ? session.updatedAt : createdAt;
  const normalizedMessages = Array.isArray(session.messages)
    ? session.messages.map((message) => {
        const safeMessage = message || {};
        return {
          id: safeMessage.id || crypto.randomUUID(),
          role: safeMessage.role === "user" ? "user" : "assistant",
          content: typeof safeMessage.content === "string" ? safeMessage.content : "",
        };
      })
    : [];
  const lastMessage = normalizedMessages.length ? normalizedMessages[normalizedMessages.length - 1] : null;
  const previewCandidate = typeof session.preview === "string" ? session.preview.trim() : "";
  return {
    id: session.id || crypto.randomUUID(),
    title: typeof session.title === "string" && session.title.trim() ? session.title : "New conversation",
    createdAt,
    updatedAt,
    preview: previewCandidate || (lastMessage ? lastMessage.content : ""),
    messages: normalizedMessages,
  };
}

function saveSessions() {
  try {
    const payload = assistantState.sessions
      .slice()
      .sort(sessionSortComparator)
      .map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        preview: session.preview,
        messages: session.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
      }));
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(payload));
  } catch (error) {
    console.warn("Could not persist sessions", error);
  }
}

function ensureSessions() {
  if (!assistantState.sessions.length) {
    assistantState.sessions = [createSession()];
  }
  let storedActiveId = null;
  try {
    storedActiveId = localStorage.getItem(STORAGE_KEYS.activeSession);
  } catch (error) {
    console.warn("Could not read active session id", error);
  }
  let selected = null;
  for (let i = 0; i < assistantState.sessions.length; i += 1) {
    if (assistantState.sessions[i].id === storedActiveId) {
      selected = assistantState.sessions[i];
      break;
    }
  }
  if (!selected) {
    selected = assistantState.sessions[0] || null;
  }
  assistantState.currentSessionId = selected ? selected.id : null;
  if (assistantState.currentSessionId) {
    try {
      localStorage.setItem(STORAGE_KEYS.activeSession, assistantState.currentSessionId);
    } catch (error) {
      console.warn("Could not persist active session id", error);
    }
  }
  clampSessions();
}

function createSession(options) {
  const details = options || {};
  const now = new Date();
  const humanLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const session = {
    id: crypto.randomUUID(),
    title: details.title || `Session ${humanLabel}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    preview: "",
    messages: [],
  };
  assistantState.sessions.unshift(session);
  clampSessions();
  saveSessions();
  return session;
}

function clampSessions() {
  if (assistantState.sessions.length <= SESSION_LIMIT) return;
  assistantState.sessions.length = SESSION_LIMIT;
  saveSessions();
}

function getCurrentSession() {
  for (let i = 0; i < assistantState.sessions.length; i += 1) {
    if (assistantState.sessions[i].id === assistantState.currentSessionId) {
      return assistantState.sessions[i];
    }
  }
  return null;
}

function loadSession(sessionId, options) {
  const choice = options || {};
  const silent = !!choice.silent;
  let target = null;
  for (let i = 0; i < assistantState.sessions.length; i += 1) {
    if (assistantState.sessions[i].id === sessionId) {
      target = assistantState.sessions[i];
      break;
    }
  }
  if (!target && assistantState.sessions.length) {
    target = assistantState.sessions[0];
  }
  if (!target) return;
  assistantState.currentSessionId = target.id;
  if (!Array.isArray(target.messages)) {
    target.messages = [];
  }
  assistantState.messages = target.messages;
  try {
    localStorage.setItem(STORAGE_KEYS.activeSession, target.id);
  } catch (error) {
    console.warn("Could not persist active session id", error);
  }
  renderConversationFromState({ silent });
  renderHistory();
  if (!silent) {
    renderHistoryPreview(target);
  }
}

function renderConversationFromState(options) {
  const choice = options || {};
  const silent = !!choice.silent;
  if (!dom.conversation) return;
  dom.conversation.innerHTML = "";
  assistantState.messages.forEach((message) => {
    renderMessage(message);
  });
  if (!silent) {
    dom.conversation.scrollTop = dom.conversation.scrollHeight;
  }
}

function seedGreeting(options) {
  const choice = options || {};
  const silent = !!choice.silent;
  if (assistantState.messages.length) return;
  const wakeName = assistantState.callName || FALLBACK_CALL_NAME;
  addAssistantMessage(
    `Hello! I'm ${wakeName}, your voice-first assistant. Press the microphone or just start typing to get things done.`,
    { silent }
  );
  addAssistantMessage(
    `Try commands like ‘Open github.com’, ‘Remind me to call Alex at 4pm’, or say “Hey ${wakeName}…” to get my attention.`,
    { silent }
  );
}

function renderHistory() {
  if (!dom.historyList) return;
  dom.historyList.innerHTML = "";
  assistantState.sessions.sort(sessionSortComparator);
  assistantState.sessions.forEach((session) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sessionId = session.id;
    if (session.id === assistantState.currentSessionId) {
      button.classList.add("active");
    }

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = session.title;

    const meta = document.createElement("span");
    meta.className = "history-item-meta";
    const referenceDate = session.updatedAt || session.createdAt;
    const readableTime = new Date(referenceDate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    meta.textContent = readableTime;

    const preview = document.createElement("span");
    preview.className = "history-item-preview";
    preview.textContent = summarize(session.preview, 64) || "Ready when you are.";

    button.appendChild(title);
    button.appendChild(meta);
    button.appendChild(preview);
    item.appendChild(button);
    dom.historyList.appendChild(item);
  });
  renderHistoryPreview();
}

function renderHistoryPreview(explicitSession) {
  if (!dom.historyPreview) return;
  const session = explicitSession || getCurrentSession();
  if (!session || !Array.isArray(session.messages) || !session.messages.length) {
    dom.historyPreview.innerHTML = '<p class="history-empty">No messages yet. Start a conversation to see it here.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  const header = document.createElement("div");
  header.className = "history-preview-header";
  const title = document.createElement("span");
  title.textContent = session.title;
  const count = document.createElement("span");
  count.textContent = `${session.messages.length} message${session.messages.length === 1 ? "" : "s"}`;
  header.appendChild(title);
  header.appendChild(count);
  fragment.appendChild(header);

  const recent = session.messages.slice(-8);
  recent.forEach((message, index) => {
    const entry = document.createElement("article");
    entry.className = `history-entry ${message.role}`;

    const meta = document.createElement("div");
    meta.className = "history-entry-meta";
    const role = document.createElement("span");
    role.textContent = message.role === "user" ? "You" : assistantState.callName;
    const order = document.createElement("span");
    const absoluteIndex = session.messages.length - recent.length + index + 1;
    order.textContent = `#${absoluteIndex}`;
    meta.appendChild(role);
    meta.appendChild(order);

    const content = document.createElement("div");
    content.className = "history-entry-content";
    content.textContent = message.content;

    entry.appendChild(meta);
    entry.appendChild(content);
    fragment.appendChild(entry);
  });

  dom.historyPreview.innerHTML = "";
  dom.historyPreview.appendChild(fragment);
}

function sessionSortComparator(a, b) {
  const left = new Date(a.updatedAt || a.createdAt).getTime();
  const right = new Date(b.updatedAt || b.createdAt).getTime();
  return right - left;
}

function onSessionUpdated(message) {
  const session = getCurrentSession();
  if (!session) return;
  if (session.messages !== assistantState.messages) {
    session.messages = assistantState.messages;
  }
  updateSessionMetadata(session, message);
  saveSessions();
  renderHistory();
  renderHistoryPreview(session);
}

function updateSessionMetadata(session, message) {
  const now = new Date().toISOString();
  session.updatedAt = now;
  if (message && typeof message.content === "string" && message.content.trim()) {
    session.preview = message.content;
  }
  if (message && message.role === "user") {
    const summarized = summarize(message.content);
    if (!session.title || session.title.indexOf("Session") === 0) {
      session.title = summarized;
    }
  } else if (!session.title) {
    session.title = summarize(message.content);
  }
}

function summarize(text, limit) {
  const max = typeof limit === "number" ? limit : 42;
  if (!text) return "New conversation";
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "New conversation";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function startNewSession() {
  const session = createSession();
  assistantState.currentSessionId = session.id;
  assistantState.messages = session.messages;
  if (dom.conversation) {
    dom.conversation.innerHTML = "";
  }
  saveSessions();
  renderHistory();
  seedGreeting({ silent: true });
  if (dom.input) {
    dom.input.focus();
  }
  renderHistoryPreview(session);
}

function switchSession(sessionId) {
  if (!sessionId || sessionId === assistantState.currentSessionId) return;
  loadSession(sessionId);
  renderHistoryPreview();
}

