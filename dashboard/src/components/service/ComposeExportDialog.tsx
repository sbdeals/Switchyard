"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, FileCode, Loader2, TerminalSquare, X } from "lucide-react";
import { loadComposeExportAction } from "@/app/compose-export-actions";
import { generateCompose, generateDockerRun, type ComposeExportInput } from "@/lib/compose-export";
import { useDialogFocus } from "@/components/use-focus-trap";
import { Btn } from "@/components/service/primitives";

export function ComposeExportButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Btn onClick={() => setOpen(true)}>
        <FileCode className="size-4" /> Export as docker-compose.yml
      </Btn>
      {open && createPortal(
        <ComposeExportDialog id={id} name={name} onClose={() => setOpen(false)} />,
        document.body
      )}
    </>
  );
}

function ComposeExportDialog({ id, name, onClose }: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const warningId = useId();
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  const [includeValues, setIncludeValues] = useState(false);
  const [data, setData] = useState<ComposeExportInput | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const requestVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const version = requestVersion.current;
    loadComposeExportAction(id, includeValues).then((result) => {
      if (cancelled || version !== requestVersion.current) return;
      if (result.ok) setData(result.data);
      else setError(result.error);
      setPending(false);
    }).catch(() => {
      if (cancelled || version !== requestVersion.current) return;
      setError("Could not load the export. Please try again.");
      setPending(false);
    });
    return () => { cancelled = true; };
  }, [id, includeValues, attempt]);

  const compose = data ? generateCompose(data) : "";

  function reload(values: boolean) {
    // Drop revealed values immediately, including while the next request runs.
    requestVersion.current += 1;
    setData(null);
    setError(null);
    setNotice("");
    setPending(true);
    setIncludeValues(values);
    setAttempt((value) => value + 1);
  }

  async function copy(format: "compose" | "run") {
    if (!data) return;
    setNotice("");
    try {
      await navigator.clipboard.writeText(format === "compose" ? compose : generateDockerRun(data));
      setNotice(format === "compose" ? "Compose copied." : "Docker run command copied.");
    } catch {
      setNotice("Could not copy. Select the preview or download the file.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([compose], { type: "application/yaml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "docker-compose.yml";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-2xl flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">Export as docker-compose.yml</h2>
            <p className="mt-1 truncate text-sm text-[var(--color-fg-muted)]">{name}</p>
          </div>
          <button type="button" data-autofocus aria-label="Close export" onClick={onClose} className="rounded-lg p-2 hover:bg-[var(--color-surface-hover)]">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
          <p className="text-xs text-[var(--color-fg-muted)]">
            Environment values use {"${KEY}"} placeholders by default. Set them locally before running Compose.
            Volume data and managed domains are not included.
          </p>
          <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
            <p id={warningId} className="mb-2 text-xs text-[var(--color-fg-muted)]">
              Warning: including values reveals secrets in the preview, clipboard, and downloaded file. Only share exports with people you trust.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={includeValues} aria-describedby={warningId} onChange={(event) => reload(event.target.checked)} />
              Include values
            </label>
          </div>
          {pending && <p role="status" className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]"><Loader2 className="size-4 animate-spin" /> Loading export…</p>}
          {error && (
            <div role="alert" className="space-y-2 text-sm text-[var(--color-danger)]">
              <p>{error}</p>
              <Btn onClick={() => reload(includeValues)}>Retry</Btn>
            </div>
          )}
          {data && <pre aria-label="Compose preview" tabIndex={0} className="min-h-64 flex-1 overflow-auto rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-4 font-mono text-xs leading-relaxed text-[var(--color-fg)]">{compose}</pre>}
        </div>
        <div className="border-t border-[var(--color-border)] p-5">
          <div className="flex flex-wrap gap-2">
            <Btn disabled={!data || pending} primary onClick={() => void copy("compose")}><Copy className="size-4" /> Copy</Btn>
            <Btn disabled={!data || pending} onClick={download}><Download className="size-4" /> Download (.yml)</Btn>
            <Btn disabled={!data || pending} onClick={() => void copy("run")}><TerminalSquare className="size-4" /> Copy as docker run</Btn>
          </div>
          <p role="status" className="mt-2 min-h-4 text-xs text-[var(--color-fg-muted)]">{notice}</p>
        </div>
      </aside>
    </>
  );
}
