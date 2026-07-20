"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  GitFork,
  Loader2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Lock,
  X,
} from "lucide-react";
import type { GithubProvider, GithubRepository, GithubBranch } from "@/lib/dokploy";
import {
  githubConnectionsAction,
  githubRepositoriesAction,
  githubBranchesAction,
  quickDeployGithubAction,
} from "@/app/actions";
import { useDialogFocus } from "@/components/use-focus-trap";

/**
 * GitHub App deploy flow: pick installation -> repo -> branch -> deploy.
 * Private repos work because Dokploy clones through the App installation.
 * Creating/installing the App itself happens in Dokploy's settings (needs a
 * public callback), so when no installation exists we deep-link there.
 *
 * Selecting an installation or repo is a user event, so those fetches live in
 * the change handlers rather than effects; the only effect syncs to the `open`
 * prop, and it updates state exclusively in its async continuation. `providers
 * === null` is the "still loading" sentinel.
 */
export function GithubDeployModal({
  open,
  onClose,
  environmentId,
  onDeployed,
}: {
  open: boolean;
  onClose: () => void;
  environmentId?: string;
  onDeployed: (id: string) => void;
}) {
  const [providers, setProviders] = useState<GithubProvider[] | null>(null);
  const [connectUrl, setConnectUrl] = useState<string>("");
  const [githubId, setGithubId] = useState("");

  const [repos, setRepos] = useState<GithubRepository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoKey, setRepoKey] = useState(""); // "owner/name"

  const [branches, setBranches] = useState<GithubBranch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branch, setBranch] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [deploying, startDeploy] = useTransition();

  const selectedRepo = repos.find((r) => `${r.owner}/${r.name}` === repoKey) ?? null;

  // Fetch an installation's repositories and reset any downstream selection.
  // Called from the installation <select> and from the single-installation
  // auto-select — both event/async contexts, never synchronously in an effect.
  function selectInstallation(id: string) {
    setGithubId(id);
    setRepos([]);
    setRepoKey("");
    setBranches([]);
    setBranch("");
    setError(null);
    if (!id) return;
    setLoadingRepos(true);
    githubRepositoriesAction(id).then((res) => {
      setLoadingRepos(false);
      if (res.ok) setRepos(res.data);
      else setError(res.error);
    });
  }

  // Fetch a repo's branches and preselect its default branch.
  function selectRepo(key: string) {
    setRepoKey(key);
    setBranches([]);
    setBranch("");
    const repo = repos.find((r) => `${r.owner}/${r.name}` === key) ?? null;
    if (!repo) return;
    setError(null);
    setLoadingBranches(true);
    githubBranchesAction(githubId, repo.owner, repo.name).then((res) => {
      setLoadingBranches(false);
      if (res.ok) {
        setBranches(res.data);
        const fallback = repo.defaultBranch ?? res.data[0]?.name ?? "";
        setBranch(res.data.some((b) => b.name === fallback) ? fallback : res.data[0]?.name ?? "");
      } else setError(res.error);
    });
  }

  function applyProviders(res: Awaited<ReturnType<typeof githubConnectionsAction>>) {
    if (res.ok) {
      setProviders(res.data.providers);
      setConnectUrl(res.data.connectUrl);
      // Auto-select (and load repos for) the sole installation.
      if (res.data.providers.length === 1) selectInstallation(res.data.providers[0].githubId);
    } else {
      setProviders([]);
      setError(res.error);
    }
  }

  // Refresh button: back to the loading state, then re-fetch installations.
  function reloadProviders() {
    setProviders(null);
    setError(null);
    githubConnectionsAction().then(applyProviders);
  }

  // Reset to a clean slate before handing the close back to the parent, so a
  // reopen starts fresh (the effect below re-fetches installations).
  function handleClose() {
    setProviders(null);
    setGithubId("");
    setRepos([]);
    setRepoKey("");
    setBranches([]);
    setBranch("");
    setError(null);
    onClose();
  }

  // Load installations whenever the modal opens. All state updates happen in the
  // async continuation, so nothing is set synchronously inside the effect.
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    githubConnectionsAction().then((res) => {
      if (!ignore) applyProviders(res);
    });
    return () => {
      ignore = true;
    };
    // applyProviders/selectInstallation are stable enough for this modal's
    // lifecycle; re-running only on `open` is the intended behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function deploy() {
    if (!selectedRepo || !branch) return;
    setError(null);
    startDeploy(async () => {
      const res = await quickDeployGithubAction({
        githubId,
        owner: selectedRepo.owner,
        repository: selectedRepo.name,
        branch,
        environmentId,
      });
      if (res.ok) {
        handleClose();
        onDeployed(res.id);
      } else setError(res.error);
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={handleClose}
          />
          <FocusTrapPanel
            onClose={handleClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="github-deploy-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-fg)]">
                <GitFork className="size-4.5" />
              </span>
              <div className="flex-1">
                <h2 id="github-deploy-title" className="text-sm font-semibold">Deploy from GitHub</h2>
                <p className="text-[11px] text-[var(--color-fg-subtle)]">
                  Private repos, auto-deploy on push.
                </p>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
              >
                <X className="size-4" />
              </button>
            </div>

            {providers === null ? (
              <div role="status" className="flex items-center gap-2 py-8 text-sm text-[var(--color-fg-muted)]">
                <Loader2 className="size-4 animate-spin" /> Loading installations…
              </div>
            ) : providers.length === 0 ? (
              <div className="space-y-3 py-2">
                <p className="text-xs text-[var(--color-fg-muted)]">
                  No GitHub App is connected yet. Create and install one in Dokploy, then come back
                  and refresh — your installations will appear here.
                </p>
                <div className="flex items-center gap-2">
                  <a
                    href={connectUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)]"
                  >
                    <GitFork className="size-4" /> Connect GitHub App
                    <ExternalLink className="size-3" />
                  </a>
                  <button
                    onClick={reloadProviders}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                  >
                    <RefreshCw className="size-3.5" /> Refresh
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Labeled label="Installation">
                  <select
                    value={githubId}
                    onChange={(e) => selectInstallation(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Select an installation…</option>
                    {providers.map((p) => (
                      <option key={p.githubId} value={p.githubId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Labeled>

                <Labeled
                  label="Repository"
                  hint={loadingRepos ? "loading…" : undefined}
                >
                  <select
                    value={repoKey}
                    onChange={(e) => selectRepo(e.target.value)}
                    disabled={!githubId || loadingRepos}
                    className={selectCls}
                  >
                    <option value="">Select a repository…</option>
                    {repos.map((r) => (
                      <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                        {r.owner}/{r.name}
                        {r.isPrivate ? " (private)" : ""}
                      </option>
                    ))}
                  </select>
                </Labeled>

                <Labeled label="Branch" hint={loadingBranches ? "loading…" : undefined}>
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    disabled={!selectedRepo || loadingBranches}
                    className={selectCls}
                  >
                    <option value="">Select a branch…</option>
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Labeled>

                <div className="flex items-center justify-between pt-1">
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)]">
                    <Lock className="size-3" /> Pushes to the branch auto-deploy.
                  </span>
                  <button
                    onClick={deploy}
                    disabled={!selectedRepo || !branch || deploying}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
                  >
                    {deploying ? <Loader2 className="size-4 animate-spin" /> : null}
                    Deploy
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="mt-3 flex items-start gap-1.5 text-xs text-[var(--color-danger)]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </div>
            )}
          </FocusTrapPanel>
        </>
      )}
    </AnimatePresence>
  );
}

const selectCls =
  "w-full rounded-lg border border-[var(--color-border-control)] bg-[var(--color-surface)] px-2.5 py-2 text-xs outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50 disabled:opacity-50";

/**
 * motion.div that mounts and unmounts with the overlay it renders, so
 * useDialogFocus (whose effect runs on mount) can trap focus for exactly the
 * overlay's lifetime.
 */
function FocusTrapPanel({
  onClose,
  ...props
}: { onClose: () => void } & React.ComponentProps<typeof motion.div>) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return <motion.div {...props} ref={ref} />;
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {label}
        {hint && (
          <span role="status" className="normal-case tracking-normal">
            · {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
