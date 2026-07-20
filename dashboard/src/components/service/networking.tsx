"use client";

/**
 * The application "Networking" surface (Railway-style): public domains, proxy
 * path redirects, published ports, and HTTP basic-auth. Every list is backed
 * by real Dokploy fields on `application.one` (domains/redirects/ports/
 * security). Config changes take effect on the service's next deploy.
 *
 * Kept in its own module so the redirect/port/security sections don't bloat
 * the frequently-edited AppTabs.tsx. The Domains section reuses DomainsTab.
 */

import { useState, useTransition } from "react";
import { Globe, ArrowRight, Plug, Lock, Plus, Loader2 } from "lucide-react";
import type { Application } from "@/lib/dokploy";
import { DomainsTab } from "@/components/service/AppTabs";
import { inputCls, Field, RemoveBtn } from "@/components/service/primitives";
import {
  createRedirectAction,
  deleteRedirectAction,
  createPortAction,
  deletePortAction,
  createSecurityAction,
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

      <RedirectsSection app={app} />
      <PortsSection app={app} />
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

function RedirectsSection({ app }: { app: Application }) {
  const [regex, setRegex] = useState("");
  const [replacement, setReplacement] = useState("");
  const [permanent, setPermanent] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function add() {
    if (!regex.trim() || !replacement.trim()) return;
    setError(null);
    start(async () => {
      const res = await createRedirectAction(app.id, regex, replacement, permanent);
      if (res.ok) {
        setRegex("");
        setReplacement("");
      } else setError(res.error);
    });
  }
  function remove(id: string) {
    setError(null);
    setRemovingId(id);
    start(async () => {
      const res = await deleteRedirectAction(id);
      if (!res.ok) setError(res.error);
      setRemovingId(null);
    });
  }

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<ArrowRight className="size-4" />}
        title="Redirects"
        hint="regex → replacement"
      />
      {app.redirects.length > 0 ? (
        <div className="space-y-2">
          {app.redirects.map((r) => (
            <div key={r.redirectId} className={rowCls}>
              <code className="min-w-0 flex-1 truncate font-mono text-xs">
                {r.regex} <span className="text-[var(--color-fg-subtle)]">→</span> {r.replacement}
              </code>
              <span className={tagCls}>{r.permanent ? "308" : "307"}</span>
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
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Regex">
            <input
              value={regex}
              onChange={(e) => setRegex(e.target.value)}
              placeholder="^/old(.*)"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Replacement">
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="/new$1"
              className={inputCls}
            />
          </Field>
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-[var(--color-fg-muted)]">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
          />
          Permanent
        </label>
        <AddBtn
          pending={pending && removingId === null}
          disabled={!regex.trim() || !replacement.trim()}
          onClick={add}
        />
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
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
    const p = Number(published);
    const t = Number(target);
    if (!p || !t) return;
    setError(null);
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
              onChange={(e) => setPublished(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="8080"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Target">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, ""))}
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function add() {
    if (!username.trim() || !password) return;
    setError(null);
    start(async () => {
      const res = await createSecurityAction(app.id, username, password);
      if (res.ok) {
        setUsername("");
        setPassword("");
      } else setError(res.error);
    });
  }
  function remove(id: string) {
    setError(null);
    setRemovingId(id);
    start(async () => {
      const res = await deleteSecurityAction(id);
      if (!res.ok) setError(res.error);
      setRemovingId(null);
    });
  }

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Lock className="size-4" />}
        title="Basic auth"
        hint="HTTP credentials"
      />
      {app.security.length > 0 ? (
        <div className="space-y-2">
          {app.security.map((s) => (
            <div key={s.securityId} className={rowCls}>
              <span className="min-w-0 flex-1 truncate">{s.username}</span>
              <span className="shrink-0 font-mono text-xs text-[var(--color-fg-subtle)]">
                ••••••••
              </span>
              <RemoveBtn
                label={`Remove basic-auth user ${s.username}`}
                pending={pending && removingId === s.securityId}
                onClick={() => remove(s.securityId)}
              />
            </div>
          ))}
        </div>
      ) : (
        <Empty>No basic-auth users — the app is publicly reachable.</Empty>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Username">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
            />
          </Field>
        </div>
        <AddBtn
          pending={pending && removingId === null}
          disabled={!username.trim() || !password}
          onClick={add}
        />
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
    </section>
  );
}
