"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

            <ConnectionBar config={config} onChanged={refreshConfig} />

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

// --- connection bar ----------------------------------------------------------
// One compact block for the whole copilot credential: Provider, API key, Model.
// The OpenAI-compatible base URL is folded INTO the provider choice (pick
// "Moonshot (Kimi)" and the endpoint is set for you); only "Custom" reveals a
// raw URL field. The model list is a real dropdown, populated live from
// /api/agent/models — the Anthropic catalog, or the chosen endpoint's own
// /v1/models — so it's always current.

const selectCls =
  "min-w-0 flex-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[11px] outline-none focus:border-[var(--color-brand)] disabled:opacity-50";
const inputCls =
  "min-w-0 flex-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-1 font-mono text-[11px] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)]";

/** A labelled control row: fixed-width icon+label on the left, control(s) right. */
function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-[4.25rem] shrink-0 items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)]">
        <span className="text-[var(--color-fg-subtle)]">{icon}</span>
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** The OpenAI-compatible preset whose base URL matches the active endpoint, if any. */
function activePreset(config: AgentConfig | null): ProviderPreset | undefined {
  return config?.presets?.find((p) => p.baseUrl && p.baseUrl === config?.baseUrl);
}

function ConnectionBar({ config, onChanged }: { config: AgentConfig | null; onChanged: () => void }) {
  const presets = config?.presets ?? [];
  const provider = config?.provider ?? "anthropic";
  const [busy, setBusy] = useState(false);

  // Which provider-dropdown entry is active: "anthropic", a preset id, or "custom".
  const providerValue = provider === "anthropic" ? "anthropic" : activePreset(config)?.id ?? "custom";

  // Base-URL draft for the "custom" case (render-time resync, per this codebase's
  // convention — no setState-in-effect).
  const [urlDraft, setUrlDraft] = useState(config?.baseUrl ?? "");
  const [prevBase, setPrevBase] = useState(config?.baseUrl);
  if (config?.baseUrl !== prevBase) {
    setPrevBase(config?.baseUrl);
    setUrlDraft(config?.baseUrl ?? "");
  }

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const pickProvider = async (value: string) => {
    if (value === providerValue) return;
    if (value === "anthropic") {
      await post({ provider: "anthropic" });
      return;
    }
    // OpenAI-compatible: switch the provider first.
    await post({ provider: "openai" });
    if (value === "custom") {
      // Clear the endpoint so providerValue derives to "custom" (it's read from
      // baseUrl) and the Endpoint field appears for the user to fill in.
      await post({ baseUrl: "" });
      return;
    }
    const preset = presets.find((p) => p.id === value);
    if (preset?.baseUrl) await post({ baseUrl: preset.baseUrl });
    // Default to the endpoint's first suggested model so a model left over from
    // the previous endpoint isn't sent to this one (it would 404). The user can
    // pick another from the now-repopulated dropdown.
    if (preset?.models?.[0]) await post({ model: preset.models[0] });
  };

  const providerOptions = [
    { id: "anthropic", label: "Anthropic" },
    ...presets.filter((p) => p.id !== "custom").map((p) => ({ id: p.id, label: p.label })),
    { id: "custom", label: "Custom (OpenAI-compatible)" },
  ];

  const commitUrl = () => {
    const u = urlDraft.trim();
    if (u && u !== config?.baseUrl) post({ baseUrl: u });
  };

  return (
    <div className="space-y-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <Field icon={<Server className="size-3.5" />} label="Provider">
        <select
          value={providerValue}
          onChange={(e) => pickProvider(e.target.value)}
          disabled={busy}
          className={selectCls}
        >
          {providerOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--color-fg-subtle)]" />}
      </Field>

      {provider === "openai" && providerValue === "custom" && (
        <Field icon={<span className="inline-block size-3.5" />} label="Endpoint">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitUrl()}
            onBlur={commitUrl}
            placeholder="https://your-endpoint/v1"
            autoComplete="off"
            className={inputCls}
          />
        </Field>
      )}

      <KeyField config={config} onChanged={onChanged} />
      <ModelField config={config} onChanged={onChanged} />
    </div>
  );
}

/** API key row: masked tail + Replace/Remove when set, else an input + Save. */
function KeyField({ config, onChanged }: { config: AgentConfig | null; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = config?.provider ?? "anthropic";
  const open = editing || config?.configured === false;
  const keyHint =
    provider === "openai" ? activePreset(config)?.keyHint || "provider API key" : "sk-ant-api…";

  const save = async () => {
    const key = value.trim();
    if (!key || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? "Request failed.");
        return;
      }
      setValue("");
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <Field icon={<KeyRound className="size-3.5" />} label="API key">
        {config?.configured && !open ? (
          <>
            <code className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">{config.masked}</code>
            {config.loginActive && (
              <span className="shrink-0 rounded border border-[var(--color-border)] px-1 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
                subscription
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={() => setEditing(true)}
              className="shrink-0 text-[11px] font-medium text-[var(--color-brand)] hover:underline"
            >
              Replace
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
          <>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder={keyHint}
              autoComplete="off"
              className={inputCls}
            />
            <button
              onClick={save}
              disabled={saving || !value.trim()}
              className="shrink-0 rounded-lg bg-[var(--color-brand-strong)] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </button>
            {config?.configured && editing && (
              <button
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setError(null);
                }}
                className="shrink-0 text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                Cancel
              </button>
            )}
          </>
        )}
      </Field>
      {error && <p className="pl-[5.25rem] text-[11px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

/**
 * Model row: a real dropdown for both providers. Anthropic options come straight
 * from the catalog already in the config payload (config.models) — no fetch, so
 * the picker works even if the network blips. For OpenAI-compatible endpoints the
 * list is fetched live from /api/agent/models (the endpoint's own /v1/models),
 * the preset's curated ids seed a "Suggested" group, and a "Custom id…" option
 * always allows a hand-typed model.
 */
function ModelField({ config, onChanged }: { config: AgentConfig | null; onChanged: () => void }) {
  const CUSTOM = "__custom__";
  const provider = config?.provider ?? "anthropic";
  const [dynModels, setDynModels] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");

  const baseUrl = config?.baseUrl ?? "";
  const masked = config?.masked ?? "";
  const configured = config?.configured ?? false;

  // (Re)load the endpoint's model list when the OpenAI-compatible provider /
  // endpoint / key changes. Anthropic uses config.models directly, so it never
  // fetches. The fetch + its setState live in an async helper (not the effect
  // body) so this doesn't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (provider !== "openai") {
        // Anthropic list comes from config.models — clear any leftover fetch state.
        setLoading(false);
        setNote(null);
        return;
      }
      setLoading(true);
      setNote(null);
      try {
        const res = await fetch("/api/agent/models", { cache: "no-store" });
        const d = (await res.json()) as { models?: { id: string; label: string }[]; error?: string };
        if (cancelled) return;
        setDynModels(d.models ?? []);
        setNote(d.error ?? null);
      } catch {
        if (!cancelled) setNote("Couldn't reach the model list.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [provider, baseUrl, masked, configured]);

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

  // Curated suggestions for the active OpenAI-compatible preset.
  const suggested = provider === "openai" ? activePreset(config)?.models ?? [] : [];

  const current = config?.model ?? "";
  const seen = new Set<string>();
  const suggestedOpts: { id: string; label: string }[] = [];
  const endpointOpts: { id: string; label: string }[] = [];
  const add = (arr: typeof suggestedOpts, id: string, label?: string) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      arr.push({ id, label: label ?? id });
    }
  };
  if (provider === "anthropic") {
    // Always available in the config payload — no network dependency.
    (config?.models ?? []).forEach((m) => add(endpointOpts, m.id, m.label));
  } else {
    suggested.forEach((id) => add(suggestedOpts, id));
    dynModels.forEach((m) => add(endpointOpts, m.id));
  }
  // Always keep the currently-selected model visible/selectable.
  if (current && !seen.has(current)) add(provider === "anthropic" ? endpointOpts : suggestedOpts, current);

  const onSelect = (v: string) => {
    if (v === CUSTOM) {
      setCustomDraft("");
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    if (v && v !== config?.model) post(v);
  };
  const commitCustom = () => {
    const m = customDraft.trim();
    if (m) {
      setCustomMode(false);
      post(m);
    }
  };

  const disabled = saving || (provider === "openai" && !configured);

  return (
    <div className="space-y-1">
      <Field icon={<Cpu className="size-3.5" />} label="Model">
        {customMode ? (
          <>
            <input
              autoFocus
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitCustom()}
              onBlur={commitCustom}
              placeholder="model id, e.g. deepseek/deepseek-chat"
              autoComplete="off"
              className={inputCls}
            />
            <button
              onClick={() => setCustomMode(false)}
              className="shrink-0 text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              Cancel
            </button>
          </>
        ) : (
          <select value={current} onChange={(e) => onSelect(e.target.value)} disabled={disabled} className={selectCls}>
            {!current && (
              <option value="" disabled>
                {loading ? "Loading models…" : provider === "openai" && !configured ? "Add a key first" : "Select a model"}
              </option>
            )}
            {provider === "openai" && suggestedOpts.length > 0 ? (
              <>
                <optgroup label="Suggested">
                  {suggestedOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
                {endpointOpts.length > 0 && (
                  <optgroup label="Available at endpoint">
                    {endpointOpts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </>
            ) : (
              [...suggestedOpts, ...endpointOpts].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))
            )}
            {provider === "openai" && <option value={CUSTOM}>✎ Custom model id…</option>}
          </select>
        )}
        {loading && !customMode && <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--color-fg-subtle)]" />}
      </Field>
      {note && provider === "openai" && configured && (
        <p className="pl-[5.25rem] text-[10px] text-[var(--color-fg-subtle)]">
          Live model list unavailable — showing suggestions. Use “Custom id…” for any other model.
        </p>
      )}
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
        Pick a <strong>Provider</strong> above and paste its API key. Use{" "}
        <strong>Anthropic</strong> for frontier quality, or an{" "}
        <strong>OpenAI-compatible</strong> endpoint (OpenRouter, Moonshot/Kimi,
        Groq, Together…) to bring a cheap key and run open models — then pick a
        model from the dropdown.
      </p>
      <p className="mt-1.5 max-w-[17rem] text-[11px] text-[var(--color-fg-subtle)]">
        The key stays on the server and is your own metered pool — it never shares
        a rate limit with anything else.
      </p>
    </div>
  );
}
