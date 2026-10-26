"use client";

import { useState, useTransition } from "react";
import type { Application, ComposeService } from "@/lib/dokploy";
import type { DeployCheckInput } from "@/lib/deploy-checks";
import { saveDeployChecksAction } from "@/app/actions";
import {
  Field,
  inputCls,
  SaveRow,
  useSavedFlash,
} from "@/components/service/primitives";

type DeployCheckService = Application | ComposeService;

export function DeployChecksSettings({ service }: { service: DeployCheckService }) {
  const checks = service.deployChecks;
  const support = service.deployCheckSupport;
  const [path, setPath] = useState(checks?.healthcheckPath ?? "");
  const [timeout, setTimeout] = useState(String(checks?.healthcheckTimeout ?? 30));
  const [port, setPort] = useState(String(checks?.healthcheckPort ?? 80));
  const [command, setCommand] = useState(checks?.preDeployCommand ?? "");
  const defaultServiceName = (service.kind === "compose" ? service.deployCheckServiceName : null) ?? "web";
  const [serviceName, setServiceName] = useState(checks?.serviceName ?? defaultServiceName);
  const [saving, start] = useTransition();
  const [saved, flashSaved] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);
  const dirty =
    path !== (checks?.healthcheckPath ?? "") ||
    timeout !== String(checks?.healthcheckTimeout ?? 30) ||
    port !== String(checks?.healthcheckPort ?? 80) ||
    command !== (checks?.preDeployCommand ?? "") ||
    serviceName !== (checks?.serviceName ?? defaultServiceName);

  function save() {
    setError(null);
    const input: DeployCheckInput = {
      healthcheckPath: path,
      healthcheckTimeout: Number(timeout),
      healthcheckPort: Number(port),
      preDeployCommand: command,
      ...(service.kind === "compose" ? { serviceName } : {}),
    };
    start(async () => {
      const res = await saveDeployChecksAction(service.kind, service.id, input);
      if (res.ok) flashSaved();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-border)] p-4">
      <h3 className="text-sm font-semibold">Deploy checks</h3>
      {support.reason && (
        <p className="text-xs text-[var(--color-fg-muted)]">{support.reason}</p>
      )}
      {service.kind === "compose" && (
        <Field label="Compose service name" hint="single service">
          <input
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            disabled={saving || !!checks?.serviceName || (!support.healthcheck && !support.preDeploy)}
            placeholder="web"
            className={inputCls}
          />
        </Field>
      )}
      <Field label="Healthcheck path" hint={support.healthcheck ? "optional" : "Not supported on this host"}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={saving || !support.healthcheck}
          placeholder="/health"
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Healthcheck timeout (seconds)">
          <input
            type="number"
            min={5}
            max={600}
            step={1}
            value={timeout}
            onChange={(e) => setTimeout(e.target.value)}
            disabled={saving || !support.healthcheck}
            className={inputCls}
          />
        </Field>
        <Field label="Container port">
          <input
            type="number"
            min={1}
            max={65535}
            step={1}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={saving || !support.healthcheck}
            className={inputCls}
          />
        </Field>
      </div>
      {support.healthcheck && (
        <p className="text-xs text-[var(--color-fg-subtle)]">
          GET the path on the container port; only a 2xx response passes. Leave the path empty to disable.
          {" The image must include curl and sh."}
          {service.kind === "application" && " Swarm uses the timeout as a retry budget; Dokploy does not wait for health before marking the deploy done."}
        </p>
      )}
      <Field label="Pre-deploy command" hint={support.preDeploy ? "optional" : "Not supported on this host"}>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={saving || !support.preDeploy}
          placeholder="npm run migrate"
          rows={2}
          spellCheck={false}
          className={`${inputCls} resize-y font-mono`}
        />
      </Field>
      {service.kind === "application" && (
        <p className="text-xs text-[var(--color-fg-subtle)]">
          Dokploy applications have no pre-deploy hook. The start command runs the application; it cannot abort a deploy before startup.
        </p>
      )}
      {service.kind === "compose" && (support.healthcheck || support.preDeploy) && (
        <p className="text-xs text-[var(--color-fg-subtle)]">
          Applies on the next deploy to a raw Compose stack with one service. The app starts after the pre-deploy command succeeds.
          Saving rewrites the Compose YAML and removes comments. This does not provide atomic traffic cutover or rollback.
        </p>
      )}
      <SaveRow
        saving={saving}
        saved={saved}
        error={error}
        disabled={!dirty || (!support.healthcheck && !support.preDeploy)}
        onSave={save}
        label="Save deploy checks"
      />
    </div>
  );
}

export function DeployChecksStatus({ service }: { service: DeployCheckService }) {
  const checks = service.deployChecks;
  const support = service.deployCheckSupport;
  const observation = service.deployCheckObservation;
  const healthcheck = !support.healthcheck
    ? "Not supported on this host"
    : observation?.healthcheck ?? (checks?.healthcheckPath ? "Not observed" : "Not configured");
  const preDeploy = !support.preDeploy
    ? "Not supported on this host"
    : observation?.preDeploy ?? (checks?.preDeployCommand ? "Not observed" : "Not configured");

  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-3">
      <h3 className="text-xs font-medium text-[var(--color-fg-muted)]">Deploy checks</h3>
      <dl className="space-y-2 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--color-fg-subtle)]">Healthcheck</dt>
          <dd className="text-right">{healthcheck}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--color-fg-subtle)]">Pre-deploy</dt>
          <dd className="text-right">{preDeploy}</dd>
        </div>
      </dl>
    </div>
  );
}
