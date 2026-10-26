"use client";

import { useState, useTransition } from "react";
import { Globe, ExternalLink, Plus, Loader2, RotateCcw, X } from "lucide-react";
import type { ComposeService } from "@/lib/dokploy";
import { repoReleaseTiming } from "@/lib/bridge-repo-release";
import { ENGINE_META } from "@/lib/engines";
import { isStopped, serviceLabel } from "@/lib/service-meta";
import { BRIDGE_NETWORK, managedConnectionString, type ManagedMeta } from "@/lib/managed-compose";
import { DomainRow } from "@/components/service/AppTabs";
import { ContextMenu } from "@/components/ContextMenu";
import { deploymentMenuItems } from "@/lib/context-menu";
import {
  composeLifecycleAction,
  loadServiceEnvAction,
  rollbackComposeAction,
} from "@/app/actions";
import {
  inputCls,
  Btn,
  Field,
  Info,
  CopyButton,
  LifecycleButtons,
  DangerZone,
  PublicUrlBar,
  GenerateUrlBtn,
  useLifecycle,
} from "@/components/service/primitives";

import { useStagedForm, useStagedState, useStaging } from "@/components/service/StagedChanges";
import { generateDomainPreviewAction } from "@/app/staged-actions";

const useComposeLifecycle = (c: ComposeService) =>
  useLifecycle((action) => composeLifecycleAction(c.id, action));

export function ComposeOverviewTab({ compose }: { compose: ComposeService }) {
  const { pending, error, run } = useComposeLifecycle(compose);
  const { hasChanges } = useStaging();
  const [rollbackPending, startRollback] = useTransition();
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const managedApp = compose.managed?.kind === "image" || compose.managed?.kind === "repo"
    ? compose.managed : null;
  const busy = pending || rollbackPending || Boolean(managedApp && compose.status === "running");

  function rollback(timestamp: string, image: string) {
    if (hasChanges) return;
    if (!confirm(`Roll back "${compose.name}" to ${image}? This redeploys the service.`)) return;
    setRollbackError(null);
    startRollback(async () => {
      const res = await rollbackComposeAction(compose.id, timestamp);
      if (!res.ok) setRollbackError(res.error);
    });
  }

  return (
    <div className="space-y-5">
      {compose.managed?.kind !== "database" && (
        <PublicUrlBar domains={compose.domains} status={compose.status} />
      )}
      <LifecycleButtons
        status={compose.status}
        stopped={isStopped(compose)}
        pending={busy}
        error={error}
        run={run}
        deployLabel={managedApp?.kind === "repo" && managedApp.pinnedTag
          ? `Redeploy latest from ${managedApp.branch}` : undefined}
      />
      {compose.managed ? (
        <ManagedOverview compose={compose} managed={compose.managed} />
      ) : (
        <>
          <p className="text-xs text-[var(--color-fg-muted)]">
            A raw <code className="font-mono">docker-compose</code> stack. Edit the file in the
            Compose tab, then deploy.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Info label="Type" value={compose.composeType ?? "docker-compose"} />
            <Info label="App name" value={compose.appName} mono />
          </div>
        </>
      )}
      {managedApp && (
        <PreviousDeploys
          compose={compose}
          managed={managedApp}
          pending={busy}
          staged={hasChanges}
          error={rollbackError}
          rollback={rollback}
        />
      )}
    </div>
  );
}

function PreviousDeploys({ compose, managed, pending, staged, error, rollback }: {
  compose: ComposeService;
  managed: Exclude<ManagedMeta, { kind: "database" }>;
  pending: boolean;
  staged: boolean;
  error: string | null;
  rollback: (timestamp: string, image: string) => void;
}) {
  const history = managed.history ?? [];
  const currentImage = managed.kind === "repo" ? managed.pinnedTag ?? managed.image : managed.image;
  const currentIndex = history.findIndex((entry) => entry.image === currentImage);
  const { timestamp, includesPortFixup } = repoReleaseTiming(compose.deployments);
  const rows = history.map((entry, index) => ({ ...entry, current: index === currentIndex, saved: true }));
  if (managed.kind === "repo" && currentIndex === -1) {
    rows.unshift({ image: currentImage, timestamp, current: true, saved: false });
  }

  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
      <h3 className="text-xs font-medium text-[var(--color-fg-muted)]">Previous deploys</h3>
      {rows.length ? rows.map((entry) => (
        <ContextMenu key={`${entry.timestamp}-${entry.image}`} label={`${entry.image} actions`} items={deploymentMenuItems({ rollbackAvailable: !entry.current && entry.saved, pending: pending || staged }).filter((item) => item.id === "rollback").map((item) => ({ ...item, onSelect: () => rollback(entry.timestamp, entry.image) }))}>
          {(trigger) => (
        <div {...trigger} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs" title={entry.image}>{entry.image}</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
              {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "Not deployed yet"}
            </div>
          </div>
          {entry.current ? (
            <span title="Current configured image; see Deploys for deployment status." className="shrink-0 rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-brand)]">
              Current
            </span>
          ) : entry.saved && (
            <Btn onClick={() => rollback(entry.timestamp, entry.image)} disabled={pending || staged}>
              <RotateCcw className="size-3" /> Roll back
            </Btn>
          )}
        </div>
          )}
        </ContextMenu>
      )) : (
        <p className="text-xs text-[var(--color-fg-subtle)]">No previous deploys saved yet. Deploy this service to start its history.</p>
      )}
      {staged && <p className="text-xs text-[var(--color-fg-muted)]">Deploy or discard staged changes before rolling back.</p>}
      <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
        Up to five saved images. Current marks the configured image; check Deploys for its status.
        {managed.kind === "repo" && (managed.pinnedTag
          ? " Pinned to a saved image. Redeploy latest rebuilds from the branch head."
          : " The running image is saved before the next redeploy.")}
      </p>
      {managed.kind === "repo" && includesPortFixup && (
        <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
          Includes an automatic port fix-up (same release).
        </p>
      )}
      {managed.rollbackUnavailable && (
        <p role="status" className="text-xs text-[var(--color-warn)]">
          The previous running image could not be saved. Rollback is unavailable for that deploy.
        </p>
      )}
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

/**
 * Overview body for a one-click database or app that Switchyard runs as
 * a compose project on the local bridge network.
 */
function ManagedOverview({ compose, managed }: { compose: ComposeService; managed: ManagedMeta }) {
  const [conn, setConn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revealConnection() {
    if (managed.kind !== "database") return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await loadServiceEnvAction("compose", compose.id);
        if (result.ok) setConn(managedConnectionString(managed.engine, compose.appName, result.env));
        else setError(result.error);
      } catch {
        setError("Could not load connection string.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {managed.kind === "database" && (
        <Field label="Connection string">
          {conn ? <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
            <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
              {conn}
            </code>
            <CopyButton text={conn} />
          </div> : (
            <Btn onClick={revealConnection} disabled={pending}>
              {pending && <Loader2 className="size-3 animate-spin" />} Reveal connection string
            </Btn>
          )}
          {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        {managed.kind === "repo" ? (
          <>
            <Info label="Source" value={serviceLabel(compose)} />
            <Info label="Repository" value={managed.repoUrl} mono />
            <Info label="Branch" value={managed.branch} mono />
            <Info label="Build" value={managed.dockerfile ?? "Dockerfile"} mono />
            {managed.subdirectory && <Info label="Subdirectory" value={managed.subdirectory} mono />}
          </>
        ) : <Info label="Image" value={managed.image} mono />}
        {managed.kind === "database" && (
          <Info label="Internal port" value={String(ENGINE_META[managed.engine].defaultPort)} />
        )}
        <Info label="Internal host" value={compose.appName} mono />
        <Info label="Network" value={`${BRIDGE_NETWORK} (local bridge)`} mono />
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
        Runs as a container on this host&apos;s local network, reachable from your other services
        at <span className="font-mono">{compose.appName}</span>.
        {managed.kind === "database" && " Credentials live in Variables; data persists in a named volume."}
        {managed.kind === "repo" && " Redeploy rebuilds from the current branch head; pushes do not deploy automatically."}
      </p>
    </div>
  );
}

export function ComposeEditorTab({ compose }: { compose: ComposeService }) {
  const [value, setValue] = useStagedState("compose-file", compose.composeFile ?? "");
  const { pending } = useStaging();
  useStagedForm({ id: "compose-file", action: "saveComposeFileAction", args: [compose.id, value, false],
    before: { "Compose file": compose.composeFile ?? "" }, after: { "Compose file": value },
    secretFields: ["Compose file"] });

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs text-[var(--color-fg-muted)]">docker-compose.yml — edits are staged until you deploy.</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        aria-label="docker-compose.yml contents"
        disabled={pending}
        className="min-h-72 flex-1 resize-none rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
      />
    </div>
  );
}

/**
 * Best-effort extraction of the top-level service names from a compose file,
 * used to suggest domain targets. No YAML dependency: read the keys directly
 * under `services:` at the first child indent level. Free-text entry still
 * works (via the datalist) when parsing misses an entry.
 */
function composeServiceNames(file: string | null): string[] {
  if (!file) return [];
  const lines = file.split("\n");
  const start = lines.findIndex((l) => /^services:\s*(#.*)?$/.test(l));
  if (start === -1) return [];
  const names: string[] = [];
  let childIndent: number | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^(\s*)/)![1].length;
    if (indent === 0) break; // dedented back to a top-level key — block ended
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue; // deeper (a service's own keys)
    const m = line.match(/^\s+([A-Za-z0-9._-]+):\s*(#.*)?$/);
    if (m) names.push(m[1]);
  }
  return names;
}

export function ComposeDomainsTab({ compose }: { compose: ComposeService }) {
  const managedApp = compose.managed?.kind === "image" || compose.managed?.kind === "repo";
  const services = composeServiceNames(compose.composeFile);
  const [serviceName, setServiceName] = useStagedState("compose-domain:service", managedApp ? "app" : services[0] ?? "");
  const [host, setHost] = useStagedState("compose-domain:host", "");
  // Blank means the server detects PORT / local image EXPOSE metadata for managed apps.
  const [port, setPort] = useStagedState("compose-domain:port", managedApp ? "" : "80");
  const targetPort = managedApp ? (port ? Number(port) : undefined) : Number(port) || 80;
  const [generating, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { operations, stage, discard, pending: deploying } = useStaging();
  const pending = deploying || generating;
  const added = operations.filter((op) => op.action === "createComposeDomainAction");

  function stageDomain(nextHost: string, tls?: { https: boolean; certificateType: "none" | "letsencrypt" }) {
    stage({ id: `domain:add:${crypto.randomUUID()}`, action: "createComposeDomainAction",
      args: [compose.id, serviceName.trim(), nextHost.trim(), targetPort, tls],
      changes: [{ field: "Domain", before: null, after: `${nextHost.trim()} → ${serviceName.trim()}:${targetPort ?? "Auto"}` }] });
  }

  function add() {
    if (!host.trim() || !serviceName.trim()) return;
    setError(null);
    stageDomain(host);
    setHost("");
  }

  function generate() {
    if (!serviceName.trim()) return;
    setError(null);
    start(async () => {
      const res = await generateDomainPreviewAction(managedApp ? compose.appName : serviceName);
      if (res.ok) stageDomain(res.host, { https: res.https, certificateType: res.certificateType });
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Attach a domain to one service in this stack (auto-SSL via Let&apos;s Encrypt). Point the
        domain&apos;s DNS at this server for it to resolve. Changes are staged until you deploy.
      </p>

      {compose.domains.length > 0 ? (
        <div className="space-y-2">
          {compose.domains.map((d) => managedApp ? (
            <DomainRow key={d.domainId} d={d} composeId={compose.id} />
          ) : (
            <a
              key={d.domainId}
              href={`${d.https ? "https" : "http"}://${d.host}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)]"
            >
              <Globe className="size-3.5 text-[var(--color-brand)]" />
              <span className="flex-1 truncate">{d.host}</span>
              {d.serviceName && (
                <span className="text-xs text-[var(--color-fg-subtle)]">→ {d.serviceName}</span>
              )}
              {d.port && <span className="text-xs text-[var(--color-fg-subtle)]">:{d.port}</span>}
              <ExternalLink className="size-3 text-[var(--color-fg-subtle)]" />
            </a>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-fg-subtle)]">No domains attached.</p>
      )}

      {added.map((operation) => (
        <div key={operation.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
          <Globe className="size-3.5 text-[var(--color-brand)]" />
          <span className="flex-1 truncate">{String(operation.args[2])} → {String(operation.args[1])}:{String(operation.args[3] ?? "Auto")}</span>
          <span className="text-[var(--color-fg-subtle)]">Staged</span>
          <button onClick={() => discard(operation.id)} disabled={pending} aria-label={`Discard domain ${operation.args[2]}`} className="rounded p-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            <X className="size-3.5" />
          </button>
        </div>
      ))}

      <div className="flex items-end gap-2">
        <div className="w-32">
          <Field label="Service" hint="in this stack">
            <input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              readOnly={managedApp}
              placeholder="web"
              list="compose-services"
              className={inputCls}
            />
            <datalist id="compose-services">
              {services.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Host">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="app.example.com"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="w-16">
          <Field label="Port">
            <input
              value={port}
              placeholder={managedApp ? "Auto" : "80"}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputCls}
            />
          </Field>
        </div>
        <GenerateUrlBtn pending={pending} disabled={!serviceName.trim()} onClick={generate} />
        <button
          onClick={add}
          disabled={pending || !host.trim() || !serviceName.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

export function ComposeSettingsTab({
  compose,
  onClose,
}: {
  compose: ComposeService;
  onClose: () => void;
}) {
  const { pending, error, run } = useComposeLifecycle(compose);
  return (
    <div className="space-y-5">
      <Info label="App name" value={compose.appName} mono />
      <Info
        label="Created"
        value={compose.createdAt ? new Date(compose.createdAt).toLocaleString() : "—"}
      />
      <DangerZone
        name={compose.name}
        message="Destroying removes the stack and all its containers."
        pending={pending}
        error={error}
        onDestroy={() => run("remove", onClose)}
      />
    </div>
  );
}
