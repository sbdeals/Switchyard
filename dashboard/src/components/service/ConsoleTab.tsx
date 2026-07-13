"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronRight, Loader2, TerminalSquare } from "lucide-react";

interface Entry {
  id: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
  error?: string;
}

interface ExecResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  truncated?: boolean;
  error?: string;
}

/**
 * A non-interactive, in-deployment console: each submitted line runs as
 * `sh -c <cmd>` inside the service's container (via /api/services/exec) and the
 * output is appended to the transcript. Not a live PTY — see the route handler
 * for why — but it covers "run commands inside the container".
 */
export function ConsoleTab({ appName }: { appName: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const nextId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stickToBottom = () =>
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });

  async function run(cmd: string) {
    setRunning(true);
    let entry: Entry;
    try {
      const res = await fetch("/api/services/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: appName, command: cmd }),
      });
      const data = (await res.json()) as ExecResponse;
      entry = {
        id: nextId.current++,
        command: cmd,
        stdout: data.stdout ?? "",
        stderr: data.stderr ?? "",
        exitCode: data.exitCode ?? null,
        truncated: data.truncated ?? false,
        error: res.ok ? undefined : data.error ?? `HTTP ${res.status}`,
      };
    } catch (e) {
      entry = {
        id: nextId.current++,
        command: cmd,
        stdout: "",
        stderr: "",
        exitCode: null,
        truncated: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    setEntries((prev) => [...prev, entry]);
    setRunning(false);
    stickToBottom();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || running) return;
    setHistory((h) => [...h, cmd]);
    setHistIdx(-1);
    setCommand("");
    run(cmd);
    stickToBottom();
  }

  // Up/Down recall previous commands, like a shell.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setCommand(history[idx]);
    } else if (e.key === "ArrowDown") {
      if (histIdx === -1) return;
      e.preventDefault();
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setCommand("");
      } else {
        setHistIdx(idx);
        setCommand(history[idx]);
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
        <TerminalSquare className="size-4" />
        <span>
          Runs <code className="font-mono text-[var(--color-fg)]">sh -c</code> inside the container.
          One command per line.
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-3 font-mono text-[11px] leading-relaxed"
      >
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[var(--color-fg-subtle)]">
            Try <span className="mx-1 text-[var(--color-fg-muted)]">ls -la</span> or
            <span className="ml-1 text-[var(--color-fg-muted)]">env</span>
          </div>
        ) : (
          entries.map((en) => (
            <div key={en.id} className="mb-2">
              <div className="flex gap-1.5 text-[var(--color-fg)]">
                <ChevronRight className="mt-px size-3 shrink-0 text-[var(--color-brand)]" />
                <span className="break-all">{en.command}</span>
              </div>
              {en.stdout && (
                <pre className="whitespace-pre-wrap break-all text-[var(--color-fg-muted)]">
                  {en.stdout}
                </pre>
              )}
              {en.stderr && (
                <pre className="whitespace-pre-wrap break-all text-[var(--color-danger)]">
                  {en.stderr}
                </pre>
              )}
              {en.error && (
                <pre className="whitespace-pre-wrap break-all text-[var(--color-danger)]">
                  {en.error}
                </pre>
              )}
              {(en.exitCode ?? 0) !== 0 && en.exitCode !== null && (
                <div className="text-[10px] text-[var(--color-fg-subtle)]">
                  exit {en.exitCode}
                  {en.truncated && " · output truncated"}
                </div>
              )}
              {en.truncated && (en.exitCode ?? 0) === 0 && (
                <div className="text-[10px] text-[var(--color-fg-subtle)]">output truncated</div>
              )}
            </div>
          ))
        )}
      </div>

      <form onSubmit={submit} className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <ChevronRight className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-brand)]" />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Run a command…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={running}
            className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1.5 pl-8 pr-3 font-mono text-xs outline-none focus:border-[var(--color-brand)] disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={running || !command.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : "Run"}
        </button>
      </form>
    </div>
  );
}
