"use client";

import { useCallback, useEffect, useState } from "react";
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
import type { CreateMountInput, Mount, MountPatch, MountServiceType, MountType, Service } from "@/lib/dokploy";
import {
  listMountsAction,
  type MountsResult,
} from "@/app/actions";
import { inputCls, Field } from "@/components/service/primitives";
import { useStagedForm, useStagedState, useStaging } from "@/components/service/StagedChanges";
import { stagedCollection, stagedMountValues } from "@/lib/staged-collections";
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
  const [adding, setAdding] = useStagedState("mount:adding", false);
  const [newId, setNewId] = useStagedState("mount:new-id", "");
  const [editing, setEditing] = useStagedState<string | null>("mount:editing", null);
  const { operations, pending, stage, discard } = useStaging();
  const visibleMounts = mounts && stagedCollection<Mount>(mounts, operations, {
    key: (mount) => mount.mountId, create: "createMountAction", update: "updateMountAction", remove: "removeMountAction",
    added: (op) => {
      const input = op.args[0] as CreateMountInput;
      return { mountId: op.id, type: input.type, mountPath: input.mountPath,
        volumeName: input.volumeName ?? null, hostPath: input.hostPath ?? null,
        filePath: input.filePath ?? null, content: input.content ?? null };
    },
    updated: (mount, op) => ({ ...mount, ...op.args[1] as MountPatch }),
  });

  function remove(mount: Mount) {
    if (!confirm(`Stage removal of mount at "${mount.mountPath}"?`)) return;
    if (operations.some((op) => op.id === mount.mountId && op.action === "createMountAction")) {
      discard(mount.mountId);
      return;
    }
    const original = mounts?.find((item) => item.mountId === mount.mountId) ?? mount;
    stage({ id: `mount:${mount.mountId}`, action: "removeMountAction", args: [mount.mountId],
      changes: [{ field: "Mount", before: `${mountSource(original)} → ${original.mountPath}`, after: null }] });
  }

  const applyResult = useCallback((res: MountsResult) => {
    if (res.ok) {
      setMounts(res.mounts);
      setLoadError(null);
    } else {
      setLoadError(res.error);
    }
  }, []);

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
  }, [applyResult, serviceType, service.id, service]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Persistent storage for this service. Mount changes are staged until you deploy.
      </p>

      {loadError && <p role="alert" className="text-xs text-[var(--color-danger)]">{loadError}</p>}

      {mounts === null && !loadError ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--color-fg-subtle)]">
          <Loader2 className="size-4 animate-spin" /> loading…
        </div>
      ) : visibleMounts && visibleMounts.length > 0 ? (
        <div className="space-y-2">
          {visibleMounts.map((m) =>
            editing === m.mountId ? (
              <MountForm
                key={m.mountId}
                serviceType={serviceType}
                serviceId={service.id}
                existing={m}
                original={mounts?.find((mount) => mount.mountId === m.mountId)}
                draftId={m.mountId}
                onDone={() => {
                  setEditing(null);
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
                pending={pending}
                onRemove={() => remove(m)}
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
          draftId={newId}
          onDone={() => {
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => {
            setEditing(null);
            setNewId(`mount:add:${crypto.randomUUID()}`);
            setAdding(true);
          }}
          disabled={pending}
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
  pending,
  onRemove,
}: {
  mount: Mount;
  onEdit: () => void;
  pending: boolean;
  onRemove: () => void;
}) {
  const meta = TYPE_META[mount.type];

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
          aria-label={`Edit mount ${mount.mountPath}`}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={onRemove}
          disabled={pending}
          aria-label={`Remove mount ${mount.mountPath}`}
          className="shrink-0 rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-[var(--color-fg-subtle)]" title={mountSource(mount)}>
        {mountSource(mount)}
      </div>
    </div>
  );
}

function MountForm({
  serviceType,
  serviceId,
  existing,
  original,
  draftId,
  onDone,
  onCancel,
}: {
  serviceType: MountServiceType;
  serviceId: string;
  existing?: Mount;
  original?: Mount;
  draftId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useStagedState<MountType>(`${draftId}:type`, existing?.type ?? "volume");
  const [mountPath, setMountPath] = useStagedState(`${draftId}:mountPath`, existing?.mountPath ?? "");
  const [volumeName, setVolumeName] = useStagedState(`${draftId}:volumeName`, existing?.volumeName ?? "");
  const [hostPath, setHostPath] = useStagedState(`${draftId}:hostPath`, existing?.hostPath ?? "");
  const [filePath, setFilePath] = useStagedState(`${draftId}:filePath`, existing?.filePath ?? "");
  const [content, setContent] = useStagedState(`${draftId}:content`, existing?.content ?? "");
  const { pending, stage } = useStaging();

  const primaryOk =
    type === "volume"
      ? volumeName.trim()
      : type === "bind"
        ? hostPath.trim()
        : filePath.trim();
  const valid = Boolean(mountPath.trim() && primaryOk);

  const patch = {
    type,
    mountPath: mountPath.trim(),
    volumeName: type === "volume" ? volumeName.trim() : undefined,
    hostPath: type === "bind" ? hostPath.trim() : undefined,
    filePath: type === "file" ? filePath.trim() : undefined,
    content: type === "file" ? content : undefined,
  };
  const diff = stagedMountValues(original, patch);
  useStagedForm({
    id: original ? `mount:${original.mountId}` : draftId,
    action: original ? "updateMountAction" : "createMountAction",
    args: original ? [original.mountId, patch] : [{ serviceType, serviceId, ...patch }],
    before: existing ? diff.before : {}, after: existing ? diff.after : {},
    secretFields: diff.secretFields,
    error: existing && !valid ? "A mount path and source are required." : undefined,
  });

  function submit() {
    if (!valid) return;
    if (!existing) {
      const changes = Object.keys(diff.after).map((field) => ({
        field, before: diff.before[field], after: diff.after[field], secret: diff.secretFields.includes(field),
      }));
      stage({ id: draftId, action: "createMountAction", args: [{ serviceType, serviceId, ...patch }], changes });
    }
    onDone();
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]">
          {existing ? "Edit mount" : "New mount"}
        </span>
        <button
          onClick={onCancel}
          aria-label={existing ? "Close mount editor" : "Cancel"}
          className="rounded-md p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div role="radiogroup" aria-label="Mount type" className="grid grid-cols-3 gap-1.5">
        {(Object.keys(TYPE_META) as MountType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            role="radio"
            aria-checked={type === t}
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
            autoFocus
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
            autoFocus
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
              autoFocus
              className={inputCls}
            />
          </Field>
          <Field label="Content">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              placeholder={"NODE_ENV=production\nPORT=3000\n"}
              className="min-h-28 w-full resize-none rounded-lg border border-[var(--color-border-control)] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
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

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={pending || !valid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {existing ? "Done" : "Add mount"}
        </button>
      </div>
    </div>
  );
}
