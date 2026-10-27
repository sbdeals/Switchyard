import { GitBranch } from "lucide-react";
import type { DeploymentCommit } from "@/lib/deployment-commit";

export function DeploymentCommitInfo({ commit }: { commit: DeploymentCommit | null }) {
  if (!commit || (!commit.sha && !commit.subject && !commit.branch)) return null;

  return (
    <div className="min-w-0 space-y-0.5 text-[11px] text-[var(--color-fg-muted)]">
      {(commit.sha || commit.subject) && (
        <div className="flex min-w-0 items-center gap-2">
          {commit.sha && (commit.url ? (
            <a
              href={commit.url}
              target="_blank"
              rel="noopener noreferrer"
              title={commit.sha}
              className="shrink-0 font-mono hover:underline"
            >
              {commit.sha.slice(0, 7)}
            </a>
          ) : (
            <span title={commit.sha} className="shrink-0 font-mono">{commit.sha.slice(0, 7)}</span>
          ))}
          {commit.subject && <span title={commit.subject} className="min-w-0 truncate">{commit.subject}</span>}
        </div>
      )}
      {commit.branch && (
        <div className="flex min-w-0 items-center gap-1 text-[var(--color-fg-subtle)]">
          <GitBranch className="size-3 shrink-0" />
          <span title={commit.branch} className="min-w-0 truncate">{commit.branch}</span>
        </div>
      )}
    </div>
  );
}
