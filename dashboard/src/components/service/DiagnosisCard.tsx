"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { DeploymentDiagnosis, DiagnosisTab } from "@/lib/deploy-diagnosis";

type Props = {
  deploymentId: string;
  serviceKind: "application" | "compose";
  onNavigate: (tab: DiagnosisTab) => void;
};

/** The same deployment-specific card is used in Overview and each failed row. */
export function DiagnosisCard({ deploymentId, serviceKind, onNavigate }: Props) {
  const [diagnosis, setDiagnosis] = useState<DeploymentDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/deployments/diagnosis?deploymentId=${encodeURIComponent(deploymentId)}`,
          { signal: controller.signal, cache: "no-store" }
        );
        if (!response.ok) throw new Error("Build log unavailable. Retry when Dokploy is reachable and the log is ready.");
        const data = await response.json() as { diagnosis: DeploymentDiagnosis };
        if (!controller.signal.aborted) setDiagnosis(data.diagnosis);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Build log unavailable.");
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [deploymentId, attempt]);

  return (
    <section aria-label="Deployment diagnosis" className="space-y-3 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-bg-elevated)] p-3">
      <div>
        <h3 className="text-sm font-semibold">Diagnosis</h3>
        <p className="text-xs text-[var(--color-fg-muted)]">Why did this deploy fail?</p>
      </div>
      {diagnosis ? (
        <DiagnosisDetails diagnosis={diagnosis} serviceKind={serviceKind} onNavigate={onNavigate} />
      ) : error ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-[var(--color-fg-muted)]">{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); setAttempt((value) => value + 1); }}
            className="text-xs font-medium text-[var(--color-brand)] hover:underline"
          >
            Retry diagnosis
          </button>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
          <Loader2 className="size-3.5 animate-spin" /> Reading build log…
        </p>
      )}
    </section>
  );
}

const TAB_LABELS: Record<DiagnosisTab, string> = {
  settings: "Settings",
  variables: "Variables",
  build: "Build",
  editor: "Compose",
  deploy: "Deploy",
  domains: "Networking",
};

export function DiagnosisDetails({ diagnosis, serviceKind, onNavigate }: {
  diagnosis: DeploymentDiagnosis;
  serviceKind: Props["serviceKind"];
  onNavigate: Props["onNavigate"];
}) {
  // Compose config (including images, limits and healthchecks) lives in its editor.
  const tab = diagnosis.tab && serviceKind === "compose" && diagnosis.tab !== "variables"
    ? "editor"
    : diagnosis.tab === "editor" && serviceKind === "application" ? "build" : diagnosis.tab;
  return (
    <>
      <p className="text-sm font-medium text-[var(--color-fg)]">{diagnosis.cause}</p>
      {!diagnosis.ruleId && <p className="text-xs text-[var(--color-fg-muted)]">Last 20 build log lines:</p>}
      {/* React text children escape log content; never render logs as HTML. */}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#0b0b10] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
        {diagnosis.excerpt || "The build log is empty."}
      </pre>
      {diagnosis.fix && <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">{diagnosis.fix}</p>}
      {tab && (
        <a
          href={`#drawer-tab-${tab}`}
          onClick={(event) => { event.preventDefault(); onNavigate(tab); }}
          className="inline-flex text-xs font-semibold text-[var(--color-brand)] hover:underline"
        >
          Open {TAB_LABELS[tab]} →
        </a>
      )}
    </>
  );
}
