"use client";

import { apiFetch } from "@/lib/api-client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { ProjectNode } from "@/lib/dokploy";
import type { DuplicateEvent } from "@/lib/environment-duplicate-server";
import { preflightDuplicateEnvironmentAction } from "@/app/environment-duplicate-actions";

type Preflight = Extract<Awaited<ReturnType<typeof preflightDuplicateEnvironmentAction>>, { ok: true }>;
type ServiceProgress = Extract<DuplicateEvent, { type: "service" }>;

const statusLabels: Record<ServiceProgress["status"], string> = {
  copying: "Copying…",
  copied: "Copied",
  failed: "Copy failed",
  deploying: "Requesting deploy…",
  deployed: "Deploy requested",
  "deploy-failed": "Deploy request failed",
  "deploy-skipped": "Deploy skipped",
};

export function DuplicateEnvironmentForm({
  project,
  environmentId,
  environmentName,
  onBack,
  onBusyChange,
}: {
  project: ProjectNode;
  environmentId: string;
  environmentName: string;
  onBack: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(`${environmentName}-copy`);
  const [copyVariables, setCopyVariables] = useState(true);
  const [deploy, setDeploy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [started, setStarted] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ServiceProgress>>({});
  const [failed, setFailed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function working(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }

  async function preview() {
    working(true);
    setError(null);
    try {
      const result = await preflightDuplicateEnvironmentAction({
        projectId: project.projectId, sourceEnvironmentId: environmentId, name, copyVariables, deploy,
      });
      if (result.ok) setPreflight(result);
      else setError(result.error);
    } catch {
      setError("Could not load preflight. Check your connection and try again.");
    } finally {
      working(false);
    }
  }

  async function duplicate() {
    if (!preflight || busy) return;
    working(true);
    setStarted(true);
    setError(null);
    let completed = false;
    try {
      const response = await apiFetch("/api/environments/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: preflight.summary.options, fingerprint: preflight.fingerprint }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Duplication could not start.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as DuplicateEvent;
          if (event.type === "environment") setTargetId(event.environmentId);
          if (event.type === "service") setProgress((current) => ({ ...current, [event.sourceId]: event }));
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "done") {
            completed = true;
            setFailed(event.failed);
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error("Connection interrupted. The result is unknown; refresh Projects before trying again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Duplication failed.");
    } finally {
      working(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4 text-xs">
      <button onClick={onBack} disabled={busy} className="inline-flex items-center gap-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-40">
        <ArrowLeft className="size-3.5" /> Back to projects
      </button>
      <p className="text-[var(--color-fg-muted)]">{project.name} / {environmentName}</p>
      {!preflight ? (
        <form onSubmit={(event) => { event.preventDefault(); void preview(); }} className="space-y-4">
          <label className="block space-y-1.5">
            <span>New environment name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              required
              maxLength={64}
              className="w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={copyVariables} disabled={busy} onChange={(event) => setCopyVariables(event.target.checked)} />
            Copy variables
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deploy} disabled={busy} onChange={(event) => setDeploy(event.target.checked)} />
            Deploy after duplicating
          </label>
          <button type="submit" disabled={busy || !name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 className="size-3.5 animate-spin" />} Review duplication
          </button>
        </form>
      ) : (
        <>
          <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h3 className="text-sm font-semibold">{preflight.summary.services.length} services → {preflight.summary.options.name}</h3>
            <p>Copy service names, source / image / Compose file, build settings, ports and supported mount definitions.</p>
            <p>{preflight.summary.options.copyVariables ? "Saved variables will be copied." : "Saved variables will not be copied."} {preflight.summary.options.deploy ? "Request deploys after all services are copied." : "Services will remain undeployed."}</p>
            {preflight.summary.environmentVariableCount > 0 && <p>{preflight.summary.environmentVariableCount} shared environment variable{preflight.summary.environmentVariableCount === 1 ? "" : "s"} will be copied.</p>}
            {preflight.summary.domainsNotCopied.length > 0 && <p>Domains not copied: {preflight.summary.domainsNotCopied.join(", ")}</p>}
            {preflight.summary.warnings.map((warning, index) => <p key={index} className="text-[var(--color-fg-muted)]">{warning}</p>)}
          </div>
          <ul aria-label="Service duplication results" aria-live="polite" className="space-y-2">
            {preflight.summary.services.map((service) => {
              const result = progress[service.sourceId];
              return (
                <li key={service.sourceId} className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{service.name} <span className="font-normal text-[var(--color-fg-subtle)]">({service.type})</span></span>
                    <span>{result ? statusLabels[result.status] : started ? "Waiting" : "Ready"}</span>
                  </div>
                  <p className="mt-1 text-[var(--color-fg-muted)]">
                    {service.variableCount} saved variables · {service.type === "compose" ? "Compose file and mount definitions preserved" : `${service.portCount} ports · ${service.mountCount} mounts`}
                  </p>
                  {service.warnings.map((warning, index) => <p key={index} className="mt-1 text-[var(--color-fg-muted)]">{warning}</p>)}
                  {result?.id && <p className="mt-1 break-all text-[var(--color-fg-subtle)]">Created: {result.id}</p>}
                  {result?.error && <p className="mt-1 text-[var(--color-danger)]">{result.error}</p>}
                </li>
              );
            })}
          </ul>
          {targetId && <p className="break-all text-[var(--color-fg-muted)]">Created environment: {preflight.summary.options.name} ({targetId})</p>}
          {started && <p className="text-[var(--color-fg-muted)]">{busy ? "Keep this panel open for progress. " : ""}Created resources are kept, including partial copies. Nothing is deleted automatically.</p>}
          {failed !== null && <p role="status" className="font-medium">{failed ? `Finished with ${failed} service failure${failed === 1 ? "" : "s"}. Review the results above.` : "Duplication complete."}</p>}
          {!started && (
            <div className="flex gap-2">
              <button onClick={() => setPreflight(null)} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2">Edit options</button>
              <button onClick={() => void duplicate()} className="rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 font-semibold text-white">Duplicate environment</button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
