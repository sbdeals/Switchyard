"use client";

/** Application networking and HTTP settings, applied on the next deploy. */

import { useState, useTransition } from "react";
import { Globe, ArrowRight, Plug, Lock, Plus, Loader2 } from "lucide-react";
import type { Application } from "@/lib/dokploy";
import { validatePort } from "@/lib/validation";
import { previewRedirect, validateBasicAuth, validateRedirect } from "@/lib/app-security";
import { DomainsTab } from "@/components/service/AppTabs";
import { inputCls, Field, RemoveBtn } from "@/components/service/primitives";
import {
  createRedirectAction,
  updateRedirectAction,
  deleteRedirectAction,
  createPortAction,
  deletePortAction,
  createSecurityAction,
  updateSecurityAction,
  deleteSecurityAction,
} from "@/app/actions";

export function NetworkingTab({ app }: { app: Application }) {
  return (
    <div className="space-y-8">
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Networking changes apply on the service&apos;s next deploy.
      </p>

      <section className="space-y-3">
        <SectionTitle icon={<Globe className="size-4" />} title="Domains" />
        <DomainsTab app={app} />
      </section>

      <PortsSection app={app} />
    </div>
  );
}

export function AppHttpSettings({ app }: { app: Application }) {
  return (
    <div className="space-y-5 border-b border-[var(--color-border)] pb-5">
      <div>
        <h3 className="text-sm font-semibold">HTTP settings</h3>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">Applies on next deploy.</p>
      </div>
      <RedirectsSection app={app} />
      <SecuritySection app={app} />
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--color-fg-muted)]">{icon}</span>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>}
    </div>
  );
}

function AddBtn({
  pending,
  disabled,
  onClick,
}: {
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      Add
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[var(--color-fg-subtle)]">{children}</p>;
}

const rowCls =
  "flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm";
const tagCls =
  "shrink-0 rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-subtle)]";

const actionCls =
  "rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40";
const saveCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-deep)] disabled:opacity-40";

function RedirectsSection({ app }: { app: Application }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [regex, setRegex] = useState("");
  const [replacement, setReplacement] = useState("");
  const [permanent, setPermanent] = useState(true);
  const [testUrl, setTestUrl] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const preview = testUrl ? previewRedirect(regex, replacement, testUrl) : null;

  function clear() {
    setEditingId(null);
    setRegex("");
    setReplacement("");
    setPermanent(true);
    setTestUrl("");
    setError(null);
  }

  function save() {
    const validation = validateRedirect(regex, replacement, permanent);
    setError(validation);
    if (validation) return;
    start(async () => {
      try {
        const res = editingId
          ? await updateRedirectAction(app.id, editingId, regex, replacement, permanent)
          : await createRedirectAction(app.id, regex, replacement, permanent);
        if (res.ok) clear();
        else setError(res.error);
      } catch {
        setError("Could not save the redirect. Try again.");
      }
    });
  }

  function remove(id: string) {
    setError(null);
    setRemovingId(id);
    start(async () => {
      try {
        const res = await deleteRedirectAction(app.id, id);
        if (!res.ok) setError(res.error);
        else if (editingId === id) clear();
      } catch {
        setError("Could not remove the redirect. Try again.");
      } finally {
        setRemovingId(null);
      }
    });
  }

  return (
    <section>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <SectionTitle icon={<ArrowRight className="size-4" />} title="Redirects" />
        {app.redirects.length > 0 ? (
          <div className="space-y-2">
            {app.redirects.map((r) => (
              <div key={r.redirectId} className={rowCls}>
                <code className="min-w-0 flex-1 break-all font-mono text-xs">
                  {r.regex} <span className="text-[var(--color-fg-subtle)]">→</span> {r.replacement}
                </code>
                <span className={tagCls}>{r.permanent ? "301" : "302"}</span>
                <button
                  type="button"
                  aria-label={`Edit redirect ${r.regex}`}
                  className="text-xs text-[var(--color-fg-muted)] hover:underline disabled:opacity-40"
                  onClick={() => {
                    setEditingId(r.redirectId);
                    setRegex(r.regex);
                    setReplacement(r.replacement);
                    setPermanent(r.permanent);
                    setError(null);
                  }}
                >
                  Edit
                </button>
                <RemoveBtn
                  label={`Remove redirect ${r.regex}`}
                  pending={pending && removingId === r.redirectId}
                  onClick={() => remove(r.redirectId)}
                />
              </div>
            ))}
          </div>
        ) : (
          <Empty>No redirects.</Empty>
        )}
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Regex">
              <input
                value={regex}
                onChange={(e) => { setRegex(e.target.value); setError(null); }}
                placeholder="^https?://example.com/old(.*)"
                className={inputCls}
              />
            </Field>
            <Field label="Replacement">
              <input
                value={replacement}
                onChange={(e) => { setReplacement(e.target.value); setError(null); }}
                placeholder="https://example.com/new${1}"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Test URL (optional)">
            <input
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              placeholder="https://example.com/old/path"
              className={inputCls}
            />
          </Field>
          {preview && (
            <p aria-live="polite" className="break-all text-xs text-[var(--color-fg-muted)]">
              {preview.ok
                ? `${testUrl} → ${preview.result}${preview.matched ? "" : " (no match)"}`
                : preview.error}
            </p>
          )}
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            Matches the full URL. Use {"${1}"} for capture groups. Editor supports a subset of Traefik regular expressions.
          </p>
          <div className="flex items-center gap-2">
            <label className="mr-auto flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
              <input
                type="checkbox"
                checked={permanent}
                onChange={(e) => setPermanent(e.target.checked)}
              />
              Permanent (301)
            </label>
            <button type="button" onClick={clear} className={actionCls}>Cancel</button>
            <button type="submit" disabled={!regex.trim() || !replacement.trim()} className={saveCls}>
              {pending && removingId === null && <Loader2 className="size-4 animate-spin" />}
              {editingId ? "Save redirect" : "Add redirect"}
            </button>
          </div>
        </form>
        {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      </fieldset>
    </section>
  );
}

function PortsSection({ app }: { app: Application }) {
  const [published, setPublished] = useState("");
  const [target, setTarget] = useState("");
  const [protocol, setProtocol] = useState<"tcp" | "udp">("tcp");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function add() {
    const validationError = validatePort(published, "Published port") || validatePort(target, "Target port");
    setError(validationError);
    if (validationError) return;
    const p = Number(published);
    const t = Number(target);
    start(async () => {
      // publishMode defaults to "host" (Dokploy's own default) — the common
      // case of exposing a port on the node.
      const res = await createPortAction(app.id, p, t, protocol, "host");
      if (res.ok) {
        setPublished("");
        setTarget("");
      } else setError(res.error);
    });
  }
  function remove(id: string) {
    setError(null);
    setRemovingId(id);
    start(async () => {
      const res = await deletePortAction(id);
      if (!res.ok) setError(res.error);
      setRemovingId(null);
    });
  }

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Plug className="size-4" />}
        title="Ports"
        hint="published → target"
      />
      {app.ports.length > 0 ? (
        <div className="space-y-2">
          {app.ports.map((p) => (
            <div key={p.portId} className={rowCls}>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {p.publishedPort} <span className="text-[var(--color-fg-subtle)]">→</span>{" "}
                {p.targetPort}
              </span>
              <span className={tagCls}>{p.protocol}</span>
              <span className={tagCls}>{p.publishMode}</span>
              <RemoveBtn
                label={`Remove port ${p.publishedPort}`}
                pending={pending && removingId === p.portId}
                onClick={() => remove(p.portId)}
              />
            </div>
          ))}
        </div>
      ) : (
        <Empty>No published ports.</Empty>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Published">
            <input
              value={published}
              onChange={(e) => setPublished(e.target.value)}
              inputMode="numeric"
              placeholder="8080"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Target">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="numeric"
              placeholder="80"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="w-24">
          <Field label="Protocol">
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as "tcp" | "udp")}
              className={inputCls}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
          </Field>
        </div>
        <AddBtn
          pending={pending && removingId === null}
          disabled={!published || !target}
          onClick={add}
        />
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
    </section>
  );
}

function SecuritySection({ app }: { app: Application }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function clear() {
    setEditingId(null);
    setUsername("");
    setPassword("");
    setError(null);
  }

  function save() {
    const validation = validateBasicAuth(username, password);
    setError(validation);
    if (validation) return;
    start(async () => {
      try {
        const res = editingId
          ? await updateSecurityAction(app.id, editingId, username, password)
          : await createSecurityAction(app.id, username, password);
        if (res.ok) clear();
        else setError(res.error);
      } catch {
        setError("Could not save the basic-auth user. Try again.");
      }
    });
  }

  function remove(id: string) {
    setError(null);
    setRemovingId(id);
    start(async () => {
      try {
        const res = await deleteSecurityAction(app.id, id);
        if (!res.ok) setError(res.error);
        else if (editingId === id) clear();
      } catch {
        setError("Could not remove the basic-auth user. Try again.");
      } finally {
        setRemovingId(null);
      }
    });
  }

  return (
    <section>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <SectionTitle icon={<Lock className="size-4" />} title="Basic auth" />
        {app.security.length > 0 ? (
          <div className="space-y-2">
            {app.security.map((s) => (
              <div key={s.securityId} className={rowCls}>
                <span className="min-w-0 flex-1 truncate">{s.username}</span>
                <span className="shrink-0 font-mono text-xs text-[var(--color-fg-subtle)]">••••</span>
                <button
                  type="button"
                  aria-label={`Replace password for ${s.username}`}
                  className="text-xs text-[var(--color-fg-muted)] hover:underline disabled:opacity-40"
                  onClick={() => {
                    setEditingId(s.securityId);
                    setUsername(s.username);
                    setPassword("");
                    setError(null);
                  }}
                >
                  Replace
                </button>
                <RemoveBtn
                  label={`Remove basic-auth user ${s.username}`}
                  pending={pending && removingId === s.securityId}
                  onClick={() => remove(s.securityId)}
                />
              </div>
            ))}
          </div>
        ) : (
          <Empty>No basic-auth users configured.</Empty>
        )}
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Username">
              <input
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(null); }}
                autoComplete="off"
                placeholder="admin"
                className={inputCls}
              />
            </Field>
            <Field label={editingId ? "New password" : "Password"}>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                autoComplete="new-password"
                className={inputCls}
              />
            </Field>
          </div>
          <p className="text-[11px] text-[var(--color-fg-subtle)]">Passwords are write-only. Replace a password to change it.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={clear} className={actionCls}>Cancel</button>
            <button type="submit" disabled={!username.trim() || !password} className={saveCls}>
              {pending && removingId === null && <Loader2 className="size-4 animate-spin" />}
              {editingId ? "Save user" : "Add user"}
            </button>
          </div>
        </form>
        {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      </fieldset>
    </section>
  );
}
