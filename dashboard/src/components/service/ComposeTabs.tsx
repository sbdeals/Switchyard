"use client";

import { useState, useTransition } from "react";
import { Globe, ExternalLink, Plus, Loader2 } from "lucide-react";
import type { ComposeService } from "@/lib/dokploy";
import { ENGINE_META } from "@/lib/engines";
import { isStopped } from "@/lib/service-meta";
import { BRIDGE_NETWORK, managedConnectionString, type ManagedMeta } from "@/lib/managed-compose";
import { DomainRow } from "@/components/service/AppTabs";
import {
  composeLifecycleAction,
  saveComposeFileAction,
  createComposeDomainAction,
  generateComposeDomainAction,
} from "@/app/actions";
import {
  inputCls,
  Field,
  Info,
  CopyButton,
  LifecycleButtons,
  SaveRow,
  DangerZone,
  PublicUrlBar,
  GenerateUrlBtn,
  useLifecycle,
  useSavedFlash,
} from "@/components/service/primitives";

const useComposeLifecycle = (c: ComposeService) =>
  useLifecycle((action) => composeLifecycleAction(c.id, action));

export function ComposeOverviewTab({ compose }: { compose: ComposeService }) {
  const { pending, error, run } = useComposeLifecycle(compose);
  return (
    <div className="space-y-5">
      {compose.managed?.kind !== "database" && (
        <PublicUrlBar domains={compose.domains} status={compose.status} />
      )}
      <LifecycleButtons
        status={compose.status}
        stopped={isStopped(compose)}
        pending={pending}
        error={error}
        run={run}
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
    </div>
  );
}

/**
 * Overview body for a one-click database or image app that Switchyard runs as
 * a compose project on the local bridge network.
 */
function ManagedOverview({ compose, managed }: { compose: ComposeService; managed: ManagedMeta }) {
  const conn =
    managed.kind === "database"
      ? managedConnectionString(managed.engine, compose.appName, compose.env)
      : null;
  return (
    <div className="space-y-4">
      {conn && (
        <Field label="Connection string">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[#0b0b10] p-2.5">
            <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
              {conn}
            </code>
            <CopyButton text={conn} />
          </div>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Info label="Image" value={managed.image} mono />
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
      </p>
    </div>
  );
}

export function ComposeEditorTab({ compose }: { compose: ComposeService }) {
  const [value, setValue] = useState(compose.composeFile ?? "");
  const [pending, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== (compose.composeFile ?? "");

  function save(redeploy: boolean) {
    setError(null);
    start(async () => {
      const res = await saveComposeFileAction(compose.id, value, redeploy);
      if (res.ok) flashSaved();
      else setError(res.error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-xs text-[var(--color-fg-muted)]">docker-compose.yml</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        aria-label="docker-compose.yml contents"
        className="min-h-72 flex-1 resize-none rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={() => save(false)}
          disabled={pending || !dirty}
          className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          Save
        </button>
        <SaveRow saving={pending} saved={saved} error={error} onSave={() => save(true)} label="Save & deploy" />
      </div>
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
  const managedImage = compose.managed?.kind === "image" ? compose.managed : null;
  const services = composeServiceNames(compose.composeFile);
  const [serviceName, setServiceName] = useState(managedImage ? "app" : services[0] ?? "");
  const [host, setHost] = useState("");
  // Blank means the server detects PORT / local image EXPOSE metadata for image apps.
  const [port, setPort] = useState(managedImage ? "" : "80");
  const targetPort = managedImage ? (port ? Number(port) : undefined) : Number(port) || 80;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);

  function add() {
    if (!host.trim() || !serviceName.trim()) return;
    setError(null);
    setGenerated(null);
    start(async () => {
      const res = await createComposeDomainAction(
        compose.id,
        serviceName,
        host,
        targetPort
      );
      if (res.ok) setHost("");
      else setError(res.error);
    });
  }

  // Attach a random routable host to the selected service, on the current port.
  function generate() {
    if (!serviceName.trim()) return;
    setError(null);
    setGenerated(null);
    start(async () => {
      const res = await generateComposeDomainAction(
        compose.id,
        serviceName,
        managedImage ? compose.appName : serviceName,
        targetPort
      );
      if (res.ok) setGenerated(res.host);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Attach a domain to one service in this stack (auto-SSL via Let&apos;s Encrypt). Point the
        domain&apos;s DNS at this server for it to resolve.
      </p>

      {compose.domains.length > 0 ? (
        <div className="space-y-2">
          {compose.domains.map((d) => managedImage ? (
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

      <div className="flex items-end gap-2">
        <div className="w-32">
          <Field label="Service" hint="in this stack">
            <input
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              readOnly={!!managedImage}
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
              placeholder={managedImage ? "Auto" : "80"}
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
      {generated && (
        <p role="status" className="text-xs text-[var(--color-ok)]">
          Attached {generated} → {serviceName} — it appears in the list above.
        </p>
      )}
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
