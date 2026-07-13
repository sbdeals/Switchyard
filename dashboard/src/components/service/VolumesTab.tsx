"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Database as VolumeIcon,
  FolderTree,
  FileText,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
} from "lucide-react";
import type { Mount, MountServiceType, MountType, Service } from "@/lib/dokploy";
import {
  listMountsAction,
  createMountAction,
  updateMountAction,
  removeMountAction,
  type MountsResult,
} from "@/app/actions";
import { inputCls, Field } from "@/components/service/primitives";
import { cn } from "@/lib/utils";

const TYPE_META: Record<MountType, { label: string; icon: React.ReactNode }> = {
  volume: { label: "Volume", icon: <VolumeIcon className="size-3.5" /> },
  bind: { label: "Bind", icon: <FolderTree className="size-3.5" /> },
  file: { label: "File", icon: <FileText className="size-3.5" /> },
};

/** The primary source a mount maps from — shown in the list row. */
function mountSource(m: Mount): string {
  if (m.type === "volume") return m.volumeName ?? "—";
  if (m.type === "bind") return m.hostPath ?? "—";
  return m.filePath ?? "—";
}

export function VolumesTab({ service }: { service: Service }) {
  const serviceType: MountServiceType =
    service.kind === "database" ? service.engine : service.kind;
  const [mounts, setMounts] = useState<Mount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const applyResult = useCallback((res: MountsResult) => {
    if (res.ok) {
      setMounts(res.mounts);
      setLoadError(null);
    } else {
      setLoadError(res.error);
    }
  }, []);

  const reload = useCallback(async () => {
    applyResult(await listMountsAction(serviceType, service.id));
  }, [applyResult, serviceType, service.id]);

  // Initial load. Kicking the fetch off with .then (rather than awaiting in the
  // effect body) keeps the state update in a microtask; the guard drops a
  // response that resolves after the tab switched to another service.
  useEffect(() => {
    let live = true;
    listMountsAction(serviceType, service.id).then((res) => {
      if (live) applyResult(res);
    });
    return () => {
      live = false;
    };
  }, [applyResult, serviceType, service.id]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Persistent storage for this service. Redeploy the service for mount changes to take
        effect.
      </p>

      {loadError && <p className="text-xs text-[var(--color-danger)]">{loadError}</p>}

      {mounts === null && !loadError ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--color-fg-subtle)]">
          <Loader2 className="size-4 animate-spin" /> loading…
        </div>
      ) : mounts && mounts.length > 0 ? (
        <div className="space-y-2">
          {mounts.map((m) =>
            editing === m.mountId ? (
              <MountForm
                key={m.mountId}
                serviceType={serviceType}
                serviceId={service.id}
                existing={m}
                onDone={() => {
                  setEditing(null);
                  reload();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <MountRow
                key={m.mountId}
                mount={m}
                onEdit={() => {
                  setAdding(false);
                  setEditing(m.mountId);
                }}
                onDeleted={reload}
              />
            )
          )}
        </div>
      ) : (
        mounts && (
          <p className="text-xs text-[var(--color-fg-subtle)]">No mounts attached.</p>
        )
      )}

      {adding ? (
        <MountForm
          serviceType={serviceType}
          serviceId={service.id}
          onDone={() => {
            setAdding(false);
            reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
        >
          <Plus className="size-4" /> Add mount
        </button>
      )}
    </div>
  );
}

function MountRow({
  mount,
  onEdit,
  onDeleted,
}: {
  mount: Mount;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const meta = TYPE_META[mount.type];

  function remove() {
    if (!confirm(`Remove mount at "${mount.mountPath}"?`)) return;
    setError(null);
    start(async () => {
      const res = await removeMountAction(mount.mountId);
      if (res.ok) onDeleted();
      else setError(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-fg-muted)]">
          {meta.icon}
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={mount.mountPath}>
          {mount.mountPath || "—"}
        </span>
        <button
          onClick={onEdit}
          disabled={pending}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={remove}
          disabled={pending}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-[var(--color-fg-subtle)]" title={mountSource(mount)}>
        {mountSource(mount)}
      </div>
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function MountForm({
  serviceType,
  serviceId,
  existing,
  onDone,
  onCancel,
}: {
  serviceType: MountServiceType;
  serviceId: string;
  existing?: Mount;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<MountType>(existing?.type ?? "volume");
  const [mountPath, setMountPath] = useState(existing?.mountPath ?? "");
  const [volumeName, setVolumeName] = useState(existing?.volumeName ?? "");
  const [hostPath, setHostPath] = useState(existing?.hostPath ?? "");
  const [filePath, setFilePath] = useState(existing?.filePath ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const primaryOk =
    type === "volume"
      ? volumeName.trim()
      : type === "bind"
        ? hostPath.trim()
        : filePath.trim();
  const valid = Boolean(mountPath.trim() && primaryOk);

  function submit() {
    if (!valid) return;
    setError(null);
    const patch = {
      type,
      mountPath: mountPath.trim(),
      volumeName: type === "volume" ? volumeName.trim() : undefined,
      hostPath: type === "bind" ? hostPath.trim() : undefined,
      filePath: type === "file" ? filePath.trim() : undefined,
      content: type === "file" ? content : undefined,
    };
    start(async () => {
      const res = existing
        ? await updateMountAction(existing.mountId, patch)
        : await createMountAction({ serviceType, serviceId, ...patch });
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]">
          {existing ? "Edit mount" : "New mount"}
        </span>
        <button
          onClick={onCancel}
          className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {(Object.keys(TYPE_META) as MountType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
              type === t
                ? "border-[var(--color-brand)] text-[var(--color-fg)]"
                : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            )}
          >
            {TYPE_META[t].icon}
            {TYPE_META[t].label}
          </button>
        ))}
      </div>

      {type === "volume" && (
        <Field label="Volume name">
          <input
            value={volumeName}
            onChange={(e) => setVolumeName(e.target.value)}
            placeholder="my-data"
            className={inputCls}
          />
        </Field>
      )}
      {type === "bind" && (
        <Field label="Host path">
          <input
            value={hostPath}
            onChange={(e) => setHostPath(e.target.value)}
            placeholder="/var/lib/my-data"
            className={inputCls}
          />
        </Field>
      )}
      {type === "file" && (
        <>
          <Field label="File name">
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="config.json"
              className={inputCls}
            />
          </Field>
          <Field label="Content">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              placeholder={"NODE_ENV=production\nPORT=3000\n"}
              className="min-h-28 w-full resize-none rounded-lg border border-[var(--color-border-strong)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]"
            />
          </Field>
        </>
      )}

      <Field label="Mount path" hint="path in the container">
        <input
          value={mountPath}
          onChange={(e) => setMountPath(e.target.value)}
          placeholder="/data"
          className={inputCls}
        />
      </Field>

      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={pending || !valid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand)] disabled:opacity-40"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {existing ? "Save mount" : "Add mount"}
        </button>
      </div>
    </div>
  );
}
