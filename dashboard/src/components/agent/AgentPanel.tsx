"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  X,
  Send,
  Loader2,
  Check,
  AlertTriangle,
  Wrench,
  KeyRound,
  Cpu,
  Server,
} from "lucide-react";
import { ChangesBar, type StagedChangeView, type ApplyResult } from "./ChangesBar";

interface ToolChip {
  id: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
}
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  tools: ToolChip[];
}

/** Credential status from /api/agent/config — never contains the key itself. */
interface AgentModel {
  id: string;
  label: string;
  hint: string;
}
interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  keyHint: string;
  models: string[];
}
interface AgentConfig {
  configured: boolean;
  source: "ui" | "env" | null;
  masked: string | null;
  /** True when the credential came from "Sign in with Claude" (subscription). */
  loginActive?: boolean;
  provider: "anthropic" | "openai";
  baseUrl: string | null;
  model: string;
  models: AgentModel[];
  presets: ProviderPreset[];
}

const STORAGE_KEY = "switchyard.agent.expanded";

export function AgentPanel() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [changes, setChanges] = useState<StagedChangeView[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    setExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const refreshChanges = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/changes", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { configured: boolean; changes: StagedChangeView[] };
      setConfigured(data.configured);
      setChanges(data.changes ?? []);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/config", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AgentConfig;
      setConfig(data);
      setConfigured(data.configured);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  // Restore expand state, load changes, and poll every 10s (even while collapsed).
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setExpanded(true);
    } catch {
      /* ignore */
    }
    refreshChanges();
    refreshConfig();
    const t = setInterval(refreshChanges, 10_000);
    return () => clearInterval(t);
  }, [refreshChanges, refreshConfig]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const patchLast = (fn: (m: ChatMsg) => ChatMsg) =>
    setMessages((prev) => {
      if (!prev.length) return prev;
      const copy = [...prev];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, tools: [] },
      { role: "assistant", content: "", tools: [] },
    ]);
    setStreaming(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...history, { role: "user", content: text }] }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        patchLast((m) => ({ ...m, content: `⚠️ ${j?.error ?? "Request failed."}` }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()));
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch (e) {
      patchLast((m) => ({ ...m, content: m.content + `\n\n⚠️ ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setStreaming(false);
      refreshChanges();
      router.refresh();
    }
  };

  type Evt =
    | { type: "text"; text: string }
    | { type: "tool"; id: string; name: string; label: string; status: ToolChip["status"]; detail?: string }
    | { type: "staged" }
    | { type: "error"; error: string }
    | { type: "done" };

  const handleEvent = (ev: Evt) => {
    if (ev.type === "text") {
      patchLast((m) => ({ ...m, content: m.content + ev.text }));
    } else if (ev.type === "tool") {
      patchLast((m) => {
        const tools = [...m.tools];
        const chip: ToolChip = { id: ev.id, label: ev.label, status: ev.status, detail: ev.detail };
        const i = tools.findIndex((t) => t.id === ev.id);
        if (i >= 0) tools[i] = chip;
        else tools.push(chip);
        return { ...m, tools };
      });
    } else if (ev.type === "staged") {
      refreshChanges();
    } else if (ev.type === "error") {
      patchLast((m) => ({ ...m, content: m.content + `\n\n⚠️ ${ev.error}` }));
    }
  };

  const applyChanges = async (ids?: string[]) => {
    setApplying(true);
    try {
      const res = await fetch("/api/agent/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", ids }),
      });
      const data = (await res.json().catch(() => null)) as { results?: ApplyResult[] } | null;
      if (data?.results) {
        setApplyResults(data.results);
        setTimeout(() => setApplyResults(null), 6000);
      }
    } finally {
      setApplying(false);
      await refreshChanges();
      router.refresh();
    }
  };

  const discardChanges = async (ids?: string[]) => {
    try {
      await fetch("/api/agent/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discard", ids }),
      });
    } finally {
      await refreshChanges();
    }
  };

  return (
    <>
      <ChangesBar
        changes={changes}
        busy={applying}
        results={applyResults}
        onApply={applyChanges}
        onDiscard={discardChanges}
      />

      {/* Collapsed tab on the right edge */}
      {!expanded && (
        <button
          onClick={toggle}
          className="fixed right-0 top-1/2 z-[60] flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-xl border border-r-0 border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-3 text-[var(--color-fg-muted)] shadow-[0_10px_30px_-12px_#000] hover:text-[var(--color-fg)]"
          aria-label="Open agent"
        >
          <Sparkles className="size-4 text-[var(--color-brand)]" />
          <span className="text-[11px] font-medium tracking-wide [writing-mode:vertical-rl]">Agent</span>
        </button>
      )}

      {/* Expanded panel. z-[60] keeps it (and its close button) above the
          fixed Sign-out button (z-50), which used to cover the header. */}
      <AnimatePresence>
        {expanded && (
          <motion.aside
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed right-0 top-0 z-[60] flex h-full w-[380px] max-w-[92vw] flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight">Agent</div>
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">Deployment copilot</div>
                </div>
              </div>
              <button onClick={toggle} className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)]" aria-label="Close agent">
                <X className="size-4" />
              </button>
            </header>

            <ProviderBar config={config} onChanged={refreshConfig} />
            <KeyBar config={config} onChanged={refreshConfig} />
            <ModelBar config={config} onChanged={refreshConfig} />

            {configured === false ? (
              <SetupCard />
            ) : (
              <>
                <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                  {messages.length === 0 && <EmptyChat />}
                  {messages.map((m, i) => (
                    <Message key={i} msg={m} />
                  ))}
                </div>

                <div className="border-t border-[var(--color-border)] p-3">
                  <div className="flex items-end gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 focus-within:border-[var(--color-brand)]">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={1}
                      placeholder="Ask to deploy, configure, inspect…"
                      className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-[var(--color-fg-subtle)]"
                    />
                    <button
                      onClick={send}
                      disabled={streaming || !input.trim()}
                      className="rounded-lg bg-[var(--color-brand)] p-1.5 text-white hover:bg-[var(--color-brand-strong)] disabled:opacity-50"
                      aria-label="Send"
                    >
                      {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function Message({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-[var(--color-brand-soft)] px-3 py-2 text-sm text-[var(--color-fg)]">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {msg.tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {msg.tools.map((t) => (
            <ToolPill key={t.id} chip={t} />
          ))}
        </div>
      )}
      {msg.content && (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-fg)]">{msg.content}</div>
      )}
    </div>
  );
}

function ToolPill({ chip }: { chip: ToolChip }) {
  const icon =
    chip.status === "running" ? (
      <Loader2 className="size-3 animate-spin" />
    ) : chip.status === "error" ? (
      <AlertTriangle className="size-3 text-[var(--color-danger)]" />
    ) : (
      <Check className="size-3 text-[var(--color-ok)]" />
    );
  return (
    <span
      title={chip.detail}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)]"
    >
      <Wrench className="size-3 text-[var(--color-fg-subtle)]" />
      {icon}
      {chip.label}
    </span>
  );
}

/** Provider toggle: Anthropic (Messages API) vs any OpenAI-compatible endpoint. */
function ProviderBar({ config, onChanged }: { config: AgentConfig | null; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const provider = config?.provider ?? "anthropic";

  const pick = async (p: "anthropic" | "openai") => {
    if (p === provider || saving) return;
    setSaving(true);
    try {
      await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p }),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const seg = (p: "anthropic" | "openai", label: string) => (
    <button
      onClick={() => pick(p)}
      disabled={saving}
      className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
        provider === p
          ? "bg-[var(--color-brand)] text-white"
          : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
      <Server className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" />
      <span className="text-[11px] text-[var(--color-fg-muted)]">Provider</span>
      <div className="flex overflow-hidden rounded-lg border border-[var(--color-border-strong)]">
        {seg("anthropic", "Anthropic")}
        {seg("openai", "OpenAI-compatible")}
      </div>
      {saving && <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--color-fg-subtle)]" />}
    </div>
  );
}

/**
 * Model row. For Anthropic it's a dropdown of the catalog; for the
 * OpenAI-compatible provider it's a free-text id (any model the endpoint
 * serves) with suggestions from the chosen preset.
 */
function ModelBar({ config, onChanged }: { config: AgentConfig | null; onChanged: () => void }) {
  const provider = config?.provider ?? "anthropic";
  const models = config?.models ?? [];
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(config?.model ?? "");
  const [prevModel, setPrevModel] = useState(config?.model);

  // Resync the free-text draft when the server-side model changes — render-time
  // adjustment, the endorsed alternative to a setState-in-effect.
  if (config?.model !== prevModel) {
    setPrevModel(config?.model);
    setDraft(config?.model ?? "");
  }

  const post = async (model: string) => {
    setSaving(true);
    try {
      await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const commitDraft = () => {
    const m = draft.trim();
    if (m && m !== config?.model) post(m);
  };

  const suggestions =
    config?.presets?.find((p) => p.baseUrl && p.baseUrl === config?.baseUrl)?.models ?? [];
  const anthropicHint = models.find((m) => m.id === config?.model)?.hint;

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
      <Cpu className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" />
      <span className="text-[11px] text-[var(--color-fg-muted)]">Model</span>
      {provider === "anthropic" ? (
        <>
          <select
            value={config?.model ?? ""}
            onChange={(e) => e.target.value !== config?.model && post(e.target.value)}
            disabled={saving || models.length === 0}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[11px] outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
          >
            {models.length === 0 && config?.model && <option value={config.model}>{config.model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {anthropicHint && (
            <span className="hidden shrink-0 text-[10px] text-[var(--color-fg-subtle)] sm:inline">{anthropicHint}</span>
          )}
        </>
      ) : (
        <>
          <input
            list="switchyard-model-suggestions"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitDraft()}
            onBlur={commitDraft}
            placeholder="model id, e.g. nousresearch/hermes-4-405b"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-1 font-mono text-[11px] outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
          />
          <datalist id="switchyard-model-suggestions">
            {suggestions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </>
      )}
      {saving && <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--color-fg-subtle)]" />}
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
        <Sparkles className="size-5" />
      </div>
      <p className="text-sm font-medium">Deployment copilot</p>
      <p className="max-w-[16rem] text-xs text-[var(--color-fg-muted)]">
        Try &ldquo;deploy n8n&rdquo;, &ldquo;spin up a postgres&rdquo;, or &ldquo;show me the logs for my app&rdquo;. Destructive changes are staged for your approval.
      </p>
    </div>
  );
}

function SetupCard() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
        <KeyRound className="size-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">Connect the copilot</h3>
      <p className="mt-1.5 max-w-[17rem] text-xs text-[var(--color-fg-muted)]">
        Pick a provider above and paste a key. Use <strong>Anthropic</strong> with
        an API key for frontier quality, or <strong>OpenAI-compatible</strong> to
        bring a cheap key (OpenRouter, Together, Groq…) and run open models like
        Hermes, DeepSeek, Llama, or Qwen.
      </p>
      <p className="mt-1.5 max-w-[17rem] text-[11px] text-[var(--color-fg-subtle)]">
        The key stays on the server and is your own metered pool — it never shares
        a rate limit with anything else.
      </p>
    </div>
  );
}

/**
 * Credential box at the top of the panel. Provider-aware: for Anthropic it takes
 * an sk-ant-… API key; for the OpenAI-compatible provider it takes a base URL
 * (with preset shortcuts) plus that provider's key. The credential never
 * round-trips to the browser; only a masked tail is shown.
 */
function KeyBar({ config, onChanged }: { config: AgentConfig | null; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseDraft, setBaseDraft] = useState(config?.baseUrl ?? "");
  const [prevBase, setPrevBase] = useState(config?.baseUrl);

  const provider = config?.provider ?? "anthropic";
  const presets = config?.presets ?? [];
  // Not configured -> the form IS the empty state; keep it open.
  const open = editing || config?.configured === false;

  // Resync the base-URL draft when the server value changes — render-time
  // adjustment instead of a setState-in-effect.
  if (config?.baseUrl !== prevBase) {
    setPrevBase(config?.baseUrl);
    setBaseDraft(config?.baseUrl ?? "");
  }

  const postField = async (payload: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch("/api/agent/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Request failed.");
      return false;
    }
    return true;
  };

  const save = async () => {
    const key = value.trim();
    if (!key || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (await postField({ key })) {
        setValue("");
        setEditing(false);
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await postField({ clear: true });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const setBase = async (url: string) => {
    if (url === (config?.baseUrl ?? "")) return;
    setSaving(true);
    setError(null);
    try {
      if (await postField({ baseUrl: url })) onChanged();
    } finally {
      setSaving(false);
    }
  };

  const pickPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setBaseDraft(p.baseUrl);
    setBase(p.baseUrl);
  };

  const keyHint =
    provider === "openai"
      ? presets.find((p) => p.baseUrl && p.baseUrl === config?.baseUrl)?.keyHint || "provider API key"
      : "sk-ant-api…";

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" />
        {config?.configured ? (
          <>
            <code className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
              {config.masked}
            </code>
            <span className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
              {config.loginActive
                ? "Claude subscription"
                : config.source === "ui"
                  ? "set in UI"
                  : "env"}
            </span>
            <span className="flex-1" />
            <button
              onClick={() => setEditing((v) => !v)}
              className="shrink-0 text-[11px] font-medium text-[var(--color-brand)] hover:underline"
            >
              {editing ? "Cancel" : "Replace"}
            </button>
            {config.source === "ui" && (
              <button
                onClick={clear}
                disabled={saving}
                className="shrink-0 text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)]"
              >
                {config.loginActive ? "Sign out" : "Remove"}
              </button>
            )}
          </>
        ) : (
          <span className="text-[11px] text-[var(--color-fg-muted)]">Not connected</span>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {provider === "openai" && (
            <div className="space-y-1.5">
              <select
                value={presets.find((p) => p.baseUrl && p.baseUrl === baseDraft)?.id ?? "custom"}
                onChange={(e) => pickPreset(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-[11px] outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                value={baseDraft}
                onChange={(e) => setBaseDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setBase(baseDraft.trim())}
                onBlur={() => setBase(baseDraft.trim())}
                placeholder="https://openrouter.ai/api/v1"
                autoComplete="off"
                className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 font-mono text-[11px] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]"
              />
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder={keyHint}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 font-mono text-[11px] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]"
            />
            <button
              onClick={save}
              disabled={saving || !value.trim()}
              className="shrink-0 rounded-lg bg-[var(--color-brand-strong)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
          {error && <p className="text-[11px] text-[var(--color-danger)]">{error}</p>}
          {provider === "openai" ? (
            <p className="text-[10px] leading-relaxed text-[var(--color-fg-subtle)]">
              Bring a key from any OpenAI-compatible provider (OpenRouter, Together,
              Groq…) and pick a cheap model below — Hermes, DeepSeek, Llama, Qwen, GPT.
              It&rsquo;s your own metered pool.
            </p>
          ) : (
            <p className="text-[10px] leading-relaxed text-[var(--color-fg-subtle)]">
              Paste an{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-brand)] hover:underline"
              >
                Anthropic API key ↗
              </a>{" "}
              (<code className="font-mono">sk-ant-api…</code>). Pay-as-you-go, no
              rate-limit walls.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
