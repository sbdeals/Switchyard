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

import { Globe, ArrowRight, Plug, Lock, Plus, Loader2 } from "lucide-react";
import type { Application, AppRedirect, AppPort, AppSecurity } from "@/lib/dokploy";
import { DomainsTab } from "@/components/service/AppTabs";
import { inputCls, Field, RemoveBtn } from "@/components/service/primitives";
import { useStagedState, useStaging } from "@/components/service/StagedChanges";
import { stagedCollection } from "@/lib/staged-collections";

export function NetworkingTab({ app }: { app: Application }) {
  return (
    <div className="space-y-8">
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Networking changes are staged until you deploy. Add an entry to stage it.
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
  const [regex, setRegex] = useStagedState("redirect:regex", "");
  const [replacement, setReplacement] = useStagedState("redirect:replacement", "");
  const [permanent, setPermanent] = useStagedState("redirect:permanent", true);
  const { pending, operations, stage, discard } = useStaging();
  const redirects = stagedCollection<AppRedirect>(app.redirects, operations, {
    key: (item) => item.redirectId, create: "createRedirectAction", remove: "deleteRedirectAction",
    added: (op) => ({ redirectId: op.id, regex: String(op.args[1]), replacement: String(op.args[2]), permanent: Boolean(op.args[3]) }),
  });

  function add() {
    if (!regex.trim() || !replacement.trim()) return;
    stage({ id: `redirect:add:${crypto.randomUUID()}`, action: "createRedirectAction",
      args: [app.id, regex.trim(), replacement.trim(), permanent],
      changes: [{ field: "Redirect", before: null, after: `${regex.trim()} → ${replacement.trim()} (${permanent ? "308" : "307"})` }] });
    setRegex("");
    setReplacement("");
  }
  function remove(id: string) {
    if (operations.some((op) => op.id === id && op.action === "createRedirectAction")) { discard(id); return; }
    const item = app.redirects.find((entry) => entry.redirectId === id);
    if (item) stage({ id: `redirect:${id}`, action: "deleteRedirectAction", args: [id],
      changes: [{ field: "Redirect", before: `${item.regex} → ${item.replacement} (${item.permanent ? "308" : "307"})`, after: null }] });
  }

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<ArrowRight className="size-4" />}
        title="Redirects"
        hint="regex → replacement"
      />
      {redirects.length > 0 ? (
        <div className="space-y-2">
          {redirects.map((r) => (
            <div key={r.redirectId} className={rowCls}>
              <code className="min-w-0 flex-1 truncate font-mono text-xs">
                {r.regex} <span className="text-[var(--color-fg-subtle)]">→</span> {r.replacement}
              </code>
              <span className={tagCls}>{r.permanent ? "308" : "307"}</span>
              <RemoveBtn
                label={`Remove redirect ${r.regex}`}
                pending={pending}
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
          pending={pending}
          disabled={!regex.trim() || !replacement.trim()}
          onClick={add}
        />
      </div>
    </section>
  );
}

function PortsSection({ app }: { app: Application }) {
  const [published, setPublished] = useStagedState("port:published", "");
  const [target, setTarget] = useStagedState("port:target", "");
  const [protocol, setProtocol] = useStagedState<"tcp" | "udp">("port:protocol", "tcp");
  const { pending, operations, stage, discard } = useStaging();
  const ports = stagedCollection<AppPort>(app.ports, operations, {
    key: (item) => item.portId, create: "createPortAction", remove: "deletePortAction",
    added: (op) => ({ portId: op.id, publishedPort: Number(op.args[1]), targetPort: Number(op.args[2]), protocol: op.args[3] as "tcp" | "udp", publishMode: "host" }),
  });
  const valid = [Number(published), Number(target)].every((port) => Number.isInteger(port) && port > 0 && port <= 65535);

  function add() {
    if (!valid) return;
    stage({ id: `port:add:${crypto.randomUUID()}`, action: "createPortAction",
      args: [app.id, Number(published), Number(target), protocol, "host"],
      changes: [{ field: "Port", before: null, after: `${published} → ${target} (${protocol})` }] });
    setPublished("");
    setTarget("");
  }
  function remove(id: string) {
    if (operations.some((op) => op.id === id && op.action === "createPortAction")) { discard(id); return; }
    const item = app.ports.find((entry) => entry.portId === id);
    if (item) stage({ id: `port:${id}`, action: "deletePortAction", args: [id],
      changes: [{ field: "Port", before: `${item.publishedPort} → ${item.targetPort} (${item.protocol})`, after: null }] });
  }

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Plug className="size-4" />}
        title="Ports"
        hint="published → target"
      />
      {ports.length > 0 ? (
        <div className="space-y-2">
          {ports.map((p) => (
            <div key={p.portId} className={rowCls}>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {p.publishedPort} <span className="text-[var(--color-fg-subtle)]">→</span>{" "}
                {p.targetPort}
              </span>
              <span className={tagCls}>{p.protocol}</span>
              <span className={tagCls}>{p.publishMode}</span>
              <RemoveBtn
                label={`Remove port ${p.publishedPort}`}
                pending={pending}
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
          pending={pending}
          disabled={!valid}
          onClick={add}
        />
      </div>
    </section>
  );
}

function SecuritySection({ app }: { app: Application }) {
  const [username, setUsername] = useStagedState("security:username", "");
  const [password, setPassword] = useStagedState("security:password", "");
  const { pending, operations, stage, discard } = useStaging();
  const security = stagedCollection<AppSecurity>(app.security, operations, {
    key: (item) => item.securityId, create: "createSecurityAction", remove: "deleteSecurityAction",
    added: (op) => ({ securityId: op.id, username: String(op.args[1]) }),
  });

  function add() {
    if (!username.trim() || !password) return;
    stage({ id: `security:add:${crypto.randomUUID()}`, action: "createSecurityAction",
      args: [app.id, username.trim(), password],
      changes: [{ field: `Basic auth ${username.trim()}`, before: null, after: password, secret: true }] });
    setUsername("");
    setPassword("");
  }
  function remove(id: string) {
    if (operations.some((op) => op.id === id && op.action === "createSecurityAction")) { discard(id); return; }
    const item = app.security.find((entry) => entry.securityId === id);
    if (item) stage({ id: `security:${id}`, action: "deleteSecurityAction", args: [id],
      changes: [{ field: `Basic auth ${item.username}`, before: "Configured", after: null, secret: true }] });
  }

  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Lock className="size-4" />}
        title="Basic auth"
        hint="HTTP credentials"
      />
      {security.length > 0 ? (
        <div className="space-y-2">
          {security.map((s) => (
            <div key={s.securityId} className={rowCls}>
              <span className="min-w-0 flex-1 truncate">{s.username}</span>
              <span className="shrink-0 font-mono text-xs text-[var(--color-fg-subtle)]">
                ••••••••
              </span>
              <RemoveBtn
                label={`Remove basic-auth user ${s.username}`}
                pending={pending}
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
          pending={pending}
          disabled={!username.trim() || !password}
          onClick={add}
        />
      </div>
    </section>
  );
}
