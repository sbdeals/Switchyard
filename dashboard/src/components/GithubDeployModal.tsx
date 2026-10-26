"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { canDeployPrivateRepo, GIT_PROVIDER_LABELS, type GitConnection, type GitRepository, type PrivateRepoInput } from "@/lib/private-repo";
import {
  gitConnectionsAction,
  gitRepositoriesAction,
  gitBranchesAction,
  quickDeployConnectedGitAction,
} from "@/app/actions";
import { useDialogFocus } from "@/components/use-focus-trap";

/**
 * Pick a Dokploy connection -> repo -> branch -> deploy. Bridge hosts also
 * support GitLab, Bitbucket, Gitea and custom Git with a registered SSH key.
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
  const [providers, setProviders] = useState<GitConnection[] | null>(null);
  const [connectUrl, setConnectUrl] = useState<string>("");
  const [sshKeysUrl, setSshKeysUrl] = useState("");
  const [bridge, setBridge] = useState(false);
  const [providerKey, setProviderKey] = useState("");
  const selection = useRef(0);

  const [repos, setRepos] = useState<GitRepository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoKey, setRepoKey] = useState(""); // "owner/name"

  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branch, setBranch] = useState("");
  const [subdirectory, setSubdirectory] = useState("");
  const [dockerfile, setDockerfile] = useState("Dockerfile");
  const [port, setPort] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [deploying, startDeploy] = useTransition();

  const provider = providers?.find((p) => `${p.kind}:${p.id}` === providerKey);
  const selectedRepo = repos.find((r) => r.key === repoKey) ?? null;
  const input: PrivateRepoInput = {
    providerKind: provider?.kind ?? "github", providerId: provider?.id ?? "",
    repository: repoKey, branch, subdirectory: subdirectory.trim() || undefined,
    dockerfile: dockerfile.trim() || "Dockerfile", port: port.trim() ? Number(port) : undefined,
  };
  const canDeploy = canDeployPrivateRepo(input, deploying || loadingRepos || loadingBranches) &&
    (provider?.kind === "ssh" || !!selectedRepo);

  // Fetch an installation's repositories and reset any downstream selection.
  // Called from the installation <select> and from the single-installation
  // auto-select — both event/async contexts, never synchronously in an effect.
  function selectConnection(connection: GitConnection | null) {
    const version = ++selection.current;
    setProviderKey(connection ? `${connection.kind}:${connection.id}` : "");
    setRepos([]);
    setRepoKey("");
    setBranches([]);
    setBranch(connection?.kind === "ssh" ? "main" : "");
    setError(null);
    setLoadingRepos(false);
    setLoadingBranches(false);
    if (!connection || connection.kind === "ssh") return;
    setLoadingRepos(true);
    gitRepositoriesAction(connection.kind, connection.id).then((res) => {
      if (selection.current !== version) return;
      setLoadingRepos(false);
      if (res.ok) setRepos(res.data);
      else setError(res.error);
    });
  }

  // Fetch a repo's branches and preselect its default branch.
  function selectRepo(key: string) {
    const version = ++selection.current;
    setRepoKey(key);
    setBranches([]);
    setBranch("");
    setLoadingBranches(false);
    const repo = repos.find((r) => r.key === key) ?? null;
    if (!repo || !provider) return;
    setError(null);
    setLoadingBranches(true);
    gitBranchesAction(provider.kind, provider.id, repo.key).then((res) => {
      if (selection.current !== version) return;
      setLoadingBranches(false);
      if (res.ok) {
        setBranches(res.data);
        const fallback = repo.defaultBranch ?? res.data[0]?.name ?? "";
        setBranch(res.data.some((b) => b.name === fallback) ? fallback : res.data[0]?.name ?? "");
      } else setError(res.error);
    });
  }

  function applyProviders(res: Awaited<ReturnType<typeof gitConnectionsAction>>) {
    setProviders(res.providers);
    setConnectUrl(res.connectUrl);
    setSshKeysUrl(res.sshKeysUrl);
    setBridge(res.bridge);
    setError(res.error ?? null);
    if (res.providers.length === 1) selectConnection(res.providers[0]);
  }

  // Refresh button: back to the loading state, then re-fetch installations.
  function reloadProviders() {
    selectConnection(null);
    setProviders(null);
    setError(null);
    gitConnectionsAction().then(applyProviders);
  }

  // Reset to a clean slate before handing the close back to the parent, so a
  // reopen starts fresh (the effect below re-fetches installations).
  function handleClose() {
    ++selection.current;
    setProviders(null);
    setProviderKey("");
    setRepos([]);
    setRepoKey("");
    setBranches([]);
    setBranch("");
    setSubdirectory("");
    setDockerfile("Dockerfile");
    setPort("");
    setError(null);
    onClose();
  }

  // Load installations whenever the modal opens. All state updates happen in the
  // async continuation, so nothing is set synchronously inside the effect.
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    gitConnectionsAction().then((res) => {
      if (!ignore) applyProviders(res);
    });
    return () => {
      ignore = true;
    };
    // applyProviders/selectConnection are stable enough for this modal's
    // lifecycle; re-running only on `open` is the intended behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function deploy() {
    if (!canDeploy) return;
    setError(null);
    startDeploy(async () => {
      const res = await quickDeployConnectedGitAction({ ...input, environmentId });
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
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-fg)]">
                <GitFork className="size-4.5" />
              </span>
              <div className="flex-1">
                <h2 id="github-deploy-title" className="text-sm font-semibold">Connected Git repo</h2>
                <p className="text-[11px] text-[var(--color-fg-subtle)]">
                  {bridge ? "Dockerfile or auto-detected Node, Python, Go and static builds." : "Deploy through your GitHub App connection."}
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
                <Loader2 className="size-4 animate-spin" /> Loading connections…
              </div>
            ) : providers.length === 0 ? (
              <div className="space-y-3 py-2">
                <GitConnectionHelp connectUrl={connectUrl} sshKeysUrl={bridge ? sshKeysUrl : undefined} />
                <div className="flex items-center gap-2">
                  <a
                    href={connectUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)]"
                  >
                    <GitFork className="size-4" /> Connect Git provider
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
                <Labeled label="Connection">
                  <select
                    value={providerKey}
                    onChange={(e) => selectConnection(providers.find((p) => `${p.kind}:${p.id}` === e.target.value) ?? null)}
                    disabled={deploying}
                    className={selectCls}
                  >
                    <option value="">Select a provider or SSH key…</option>
                    {providers.map((p) => (
                      <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                        {GIT_PROVIDER_LABELS[p.kind]} · {p.name}
                      </option>
                    ))}
                  </select>
                </Labeled>

                <Labeled
                  label="Repository"
                  hint={loadingRepos ? "loading…" : undefined}
                >
                  {provider?.kind === "ssh" ? <input
                    value={repoKey} onChange={(e) => setRepoKey(e.target.value)} disabled={deploying}
                    placeholder="git@host:owner/repo.git" className={selectCls} autoComplete="off"
                  /> : <select
                    value={repoKey}
                    onChange={(e) => selectRepo(e.target.value)}
                    disabled={!provider || loadingRepos || deploying}
                    className={selectCls}
                  >
                    <option value="">Select a repository…</option>
                    {repos.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.path}
                      </option>
                    ))}
                  </select>}
                </Labeled>

                <Labeled label="Branch" hint={loadingBranches ? "loading…" : undefined}>
                  {provider?.kind === "ssh" ? <input
                    value={branch} onChange={(e) => setBranch(e.target.value)} disabled={deploying}
                    placeholder="main" className={selectCls}
                  /> : <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    disabled={!selectedRepo || loadingBranches || deploying}
                    className={selectCls}
                  >
                    <option value="">Select a branch…</option>
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>}
                </Labeled>

                {bridge && <>
                  <div className="grid grid-cols-2 gap-2">
                    <Labeled label="Subdirectory">
                      <input value={subdirectory} onChange={(e) => setSubdirectory(e.target.value)} disabled={deploying} placeholder="Repository root" className={selectCls} />
                    </Labeled>
                    <Labeled label="Dockerfile">
                      <input value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} disabled={deploying} placeholder="Dockerfile" className={selectCls} />
                    </Labeled>
                  </div>
                  <Labeled label="App port">
                    <input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} disabled={deploying} placeholder="Auto-detect" className={selectCls} />
                  </Labeled>
                  <p className="text-[11px] text-[var(--color-fg-subtle)]">Detection runs on tracked files after Dokploy clones. A Dockerfile takes priority. Leave the port empty to detect it, or override it for your app.</p>
                </>}

                <GitConnectionHelp connectUrl={connectUrl} sshKeysUrl={bridge ? sshKeysUrl : undefined} />

                <button onClick={reloadProviders} disabled={deploying} className="text-xs text-[var(--color-fg-subtle)] hover:underline disabled:opacity-40">
                  Refresh connections
                </button>

                <div className="flex items-center justify-between pt-1">
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)]">
                    <Lock className="size-3" /> {bridge ? "Credentials stay in Dokploy." : "Pushes to the branch auto-deploy."}
                  </span>
                  <button
                    onClick={deploy}
                    disabled={!canDeploy}
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

export function GitConnectionHelp({ connectUrl, sshKeysUrl }: { connectUrl: string; sshKeysUrl?: string }) {
  return <p className="text-xs text-[var(--color-fg-muted)]">
    Connect a <a href={connectUrl} target="_blank" rel="noreferrer" className="underline">Git provider</a>
    {sshKeysUrl && <> or <a href={sshKeysUrl} target="_blank" rel="noreferrer" className="underline">SSH key</a></>}
    {" in Dokploy, then refresh to see it here."}
  </p>;
}

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
