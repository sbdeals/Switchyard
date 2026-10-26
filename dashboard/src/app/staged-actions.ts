"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import * as actions from "./actions";
import {
  generateHostFor,
  listMounts,
  listProjects,
  loadWorkspace,
  request,
  redeployManagedImage,
  type ApplicationPatch,
  type BuildTypePatch,
  type CreateMountInput,
  type DatabasePatch,
  type DomainInput,
  type GeneratedHost,
  type MountPatch,
  type Service,
} from "@/lib/dokploy";
import { friendlyEngineError } from "@/lib/deploy-errors";
import { parseManaged } from "@/lib/managed-compose";
import {
  applyStagedOperations,
  STAGED_ACTION_ORDER,
  type ApplyOperation,
  type StagedApplyReport,
  type StagedTarget,
} from "@/lib/staged-apply";

type Operation = ApplyOperation & {
  args: unknown[];
  changes?: { before: unknown; after: unknown; secret?: boolean }[];
};

function check(condition: unknown, message = "Invalid staged change."): asserts condition {
  if (!condition) throw new Error(message);
}

function string(value: unknown): asserts value is string {
  check(typeof value === "string");
}

function fields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value));
  check(Object.keys(value).every((key) => allowed.includes(key)), "Unsupported settings field.");
}

function port(value: unknown): asserts value is number {
  check(typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535,
    "Port must be a whole number between 1 and 65535.");
}

function domain(value: unknown): asserts value is DomainInput {
  fields(value, ["host", "port", "https", "certificateType", "path"]);
  string(value.host);
  check(value.host.trim(), "Host is required.");
  port(value.port);
  check(typeof value.https === "boolean" && ["none", "letsencrypt", "custom"].includes(String(value.certificateType)));
  if (value.path !== undefined) string(value.path);
}

/** Validate every resource selector before the first write. Dokploy still authorizes each action. */
function prepare(service: Service, mounts: Set<string>, operation: Operation): () => Promise<actions.ActionResult> {
  const a = operation.args;
  check(Array.isArray(a));
  const own = (kind: Service["kind"] = service.kind, index = 0) => {
    check(service.kind === kind && a[index] === service.id, "The change does not belong to this service.");
  };
  const child = (ids: string[]) => {
    string(a[0]);
    check(ids.includes(a[0]), "The change does not belong to this service.");
    return a[0];
  };
  switch (operation.action) {
    case "updateApplicationAction":
      own("application");
      fields(a[1], ["name", "description", "cpuLimit", "memoryLimit", "cpuReservation", "memoryReservation", "command", "replicas", "healthCheckSwarm", "restartPolicySwarm"]);
      return () => actions.updateApplicationAction(service.id, a[1] as ApplicationPatch, false);
    case "saveAppBuildTypeAction":
      own("application");
      fields(a[1], ["buildType", "dockerfile", "dockerContextPath", "dockerBuildStage", "railpackVersion", "herokuVersion", "publishDirectory", "isStaticSpa"]);
      return () => actions.saveAppBuildTypeAction(service.id, a[1] as unknown as BuildTypePatch, false);
    case "setAppDockerSourceAction":
      own("application");
      string(a[1]);
      check(a[1].trim(), "Image is required.");
      if (a[2] != null) {
        fields(a[2], ["username", "password", "registryUrl"]);
        Object.values(a[2]).forEach(string);
      }
      return async () => {
        let registry = a[2] as Parameters<typeof actions.setAppDockerSourceAction>[2];
        // An image-only edit must not clear credentials the client never reads.
        if (registry == null) {
          const stored = await request<{ username?: string | null; password?: string | null; registryUrl?: string | null }>(
            `application.one?applicationId=${encodeURIComponent(service.id)}`
          );
          registry = { username: stored.username ?? "", password: stored.password ?? "", registryUrl: stored.registryUrl ?? "" };
        }
        const result = await actions.setAppDockerSourceAction(service.id, a[1] as string, registry, false);
        return result.ok ? result : {
          ...result, error: safeError(result.error, [{ ...operation, args: [service.id, a[1], registry] }]),
        };
      };
    case "updateGitDeployAction":
      own("application");
      fields(a[1], ["gitUrl", "branch", "buildPath", "watchPaths", "autoDeploy"]);
      check(typeof a[1].autoDeploy === "boolean");
      return () => actions.updateGitDeployAction(service.id, a[1] as Parameters<typeof actions.updateGitDeployAction>[1]);
    case "saveComposeFileAction":
      own("compose");
      string(a[1]);
      return () => actions.saveComposeFileAction(service.id, a[1] as string, false);
    case "updateDatabaseAction":
      own("database", 1);
      check(service.kind === "database" && a[0] === service.engine && a[2] === service.appName,
        "The change does not belong to this database.");
      fields(a[3], ["name", "dockerImage", "externalPort", "cpuLimit", "memoryLimit"]);
      if (a[3].externalPort != null) port(a[3].externalPort);
      return () => actions.updateDatabaseAction(service.engine, service.id, service.appName, a[3] as DatabasePatch, false);
    case "saveEnvironmentAction":
      own("database", 1);
      check(service.kind === "database" && a[0] === service.engine);
      string(a[2]);
      return () => actions.saveEnvironmentAction(service.engine, service.id, a[2] as string);
    case "saveApplicationEnvAction":
      own("application");
      string(a[1]);
      return () => actions.saveApplicationEnvAction(service.id, a[1] as string);
    case "saveComposeEnvAction":
      own("compose");
      string(a[1]);
      return () => actions.saveComposeEnvAction(service.id, a[1] as string);
    case "createDomainAction":
      own("application");
      domain(a[1]);
      return () => actions.createDomainAction(service.id, a[1] as DomainInput);
    case "createComposeDomainAction":
      own("compose");
      string(a[1]);
      string(a[2]);
      check(a[1].trim() && a[2].trim(), "Service and host are required.");
      if (a[3] !== undefined) port(a[3]);
      if (a[4] != null) fields(a[4], ["https", "certificateType"]);
      return () => actions.createComposeDomainAction(service.id, a[1] as string, a[2] as string, a[3] as number | undefined,
        a[4] as Parameters<typeof actions.createComposeDomainAction>[4], false);
    case "updateDomainAction":
    case "deleteDomainAction": {
      check(service.kind !== "database");
      const id = child(service.domains.map((d) => d.domainId));
      const composeId = service.kind === "compose" ? service.id : undefined;
      if (operation.action === "deleteDomainAction") {
        check(a[1] == null || a[1] === composeId);
        return () => actions.deleteDomainAction(id, composeId, false);
      }
      check(a[2] == null || a[2] === composeId);
      domain(a[1]);
      return () => actions.updateDomainAction(id, a[1] as DomainInput, composeId, false);
    }
    case "createRedirectAction":
      own("application");
      string(a[1]); string(a[2]); check(typeof a[3] === "boolean");
      return () => actions.createRedirectAction(service.id, a[1] as string, a[2] as string, a[3] as boolean);
    case "createPortAction":
      own("application");
      port(a[1]); port(a[2]);
      check(a[3] === "tcp" || a[3] === "udp");
      check(a[4] === "host" || a[4] === "ingress");
      return () => actions.createPortAction(service.id, a[1] as number, a[2] as number, a[3] as "tcp" | "udp", a[4] as "host" | "ingress");
    case "createSecurityAction":
      own("application");
      string(a[1]); string(a[2]);
      return () => actions.createSecurityAction(service.id, a[1] as string, a[2] as string);
    case "deleteRedirectAction": {
      check(service.kind === "application");
      const id = child(service.redirects.map((r) => r.redirectId));
      return () => actions.deleteRedirectAction(id);
    }
    case "deletePortAction": {
      check(service.kind === "application");
      const id = child(service.ports.map((p) => p.portId));
      return () => actions.deletePortAction(id);
    }
    case "deleteSecurityAction": {
      check(service.kind === "application");
      const id = child(service.security.map((s) => s.securityId));
      return () => actions.deleteSecurityAction(id);
    }
    case "createMountAction": {
      fields(a[0], ["serviceType", "serviceId", "type", "mountPath", "volumeName", "hostPath", "filePath", "content"]);
      const serviceType = service.kind === "database" ? service.engine : service.kind;
      check(a[0].serviceType === serviceType && a[0].serviceId === service.id, "The volume does not belong to this service.");
      return () => actions.createMountAction(a[0] as unknown as CreateMountInput);
    }
    case "updateMountAction": {
      const id = child([...mounts]);
      fields(a[1], ["type", "mountPath", "volumeName", "hostPath", "filePath", "content"]);
      return () => actions.updateMountAction(id, a[1] as MountPatch);
    }
    case "removeMountAction": {
      const id = child([...mounts]);
      return () => actions.removeMountAction(id);
    }
  }
}

/** Engine errors can include submitted values. Do not echo secrets in batch reports. */
function safeError(message: string, operations: Operation[], failedId?: string): string {
  const opaque = operations.some((op) => {
    if (failedId !== undefined && failedId !== "deploy" && op.id !== failedId) return false;
    if (op.action === "saveComposeFileAction") return true;
    if (op.action === "createMountAction" || op.action === "updateMountAction") {
      const input = op.args[op.action === "createMountAction" ? 0 : 1] as MountPatch;
      return !!input?.content;
    }
    return false;
  });
  if (opaque) return "The engine rejected the configuration. Check the service settings and try again.";
  const secrets = new Set<string>();
  const seen = new Set<object>();
  const collect = (value: unknown) => {
    if (typeof value === "string" && value) {
      secrets.add(value);
      for (const line of value.split("\n")) {
        const separator = line.indexOf("=");
        if (separator >= 0 && line.slice(separator + 1).trim()) {
          const entry = line.slice(separator + 1).trim();
          secrets.add(entry);
          const unquoted = entry.replace(/^(["'])(.*)\1$/, "$2");
          if (unquoted) secrets.add(unquoted);
        }
      }
    } else if (value && typeof value === "object" && !seen.has(value)) {
      seen.add(value);
      Object.values(value).forEach(collect);
    }
  };
  for (const op of operations) {
    for (const change of Array.isArray(op.changes) ? op.changes : []) {
      if (change?.secret) { collect(change.before); collect(change.after); }
    }
    if (/Env|Environment/.test(op.action)) collect(op.args.at(-1));
    if (op.action === "createSecurityAction") collect(op.args[2]);
    if (op.action === "setAppDockerSourceAction") collect(op.args[2]);
    if (op.action === "saveComposeFileAction") collect(op.args[1]);
    if (op.action === "createMountAction" || op.action === "updateMountAction") {
      const input = op.args[op.action === "createMountAction" ? 0 : 1] as MountPatch;
      collect(input?.content);
    }
  }
  let result = message;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length < 4 && result.includes(secret)) return "The engine rejected this change. Review its values and try again.";
    result = result.split(secret).join("••••••");
    result = result.split(JSON.stringify(secret).slice(1, -1)).join("••••••");
  }
  return result;
}

export async function generateDomainPreviewAction(serviceName: string): Promise<
  ({ ok: true } & GeneratedHost) | { ok: false; error: string }
> {
  try {
    string(serviceName);
    await listProjects(); // Require the same authenticated Dokploy session as other actions.
    return { ok: true, ...await generateHostFor(serviceName) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: friendlyEngineError(error instanceof Error ? error.message : String(error)) };
  }
}

/** One request, ordered settings writes, then exactly one deployment request. */
export async function applyStagedChangesAction(target: StagedTarget, operations: Operation[]): Promise<StagedApplyReport> {
  let failedId = "validation";
  try {
    check(Array.isArray(operations) && operations.length <= 200);
    check(target && typeof target.id === "string" && ["application", "compose", "database"].includes(target.kind));
    check(target.networkingChanged === undefined || typeof target.networkingChanged === "boolean");
    const ids = new Set<string>();
    for (const operation of operations) {
      check(operation && typeof operation.id === "string" && operation.id.length > 0);
      failedId = operation.id;
      check(Array.isArray(operation.args));
      check(!ids.has(operation.id) && Object.hasOwn(STAGED_ACTION_ORDER, operation.action));
      ids.add(operation.id);
    }
    failedId = "validation";
    const { services } = await loadWorkspace();
    const service = services.find((s) => s.id === target.id && s.kind === target.kind);
    check(service, "Service not found or access denied.");
    if (service.kind === "database") check(target.engine === service.engine && target.appName === service.appName);
    const needsMounts = operations.some((op) => op.action === "updateMountAction" || op.action === "removeMountAction");
    const mounts = needsMounts
      ? await listMounts(service.kind === "database" ? service.engine : service.kind, service.id)
      : [];
    const mountIds = new Set(mounts.map((m) => m.mountId));
    const prepared = new Map<string, () => Promise<actions.ActionResult>>();
    for (const operation of operations) {
      failedId = operation.id;
      prepared.set(operation.id, prepare(service, mountIds, operation));
    }
    const report = await applyStagedOperations(operations, (op) => prepared.get(op.id)!(), async () => {
      if (service.kind === "application") return actions.appLifecycleAction(service.id, "deploy");
      if (service.kind === "database") return actions.lifecycleAction(service.engine, service.id, "deploy");
      if (target.networkingChanged || operations.some((op) => /DomainAction$/.test(op.action))) {
        // A staged file can change whether the stack is managed. Inspect the
        // saved file so a conversion to ordinary Compose still deploys once.
        const detail = await request<{ composeFile?: string | null }>(`compose.one?composeId=${encodeURIComponent(service.id)}`);
        const managed = parseManaged(detail.composeFile);
        if (managed?.kind === "image" || managed?.kind === "repo") {
          await redeployManagedImage(service.id);
          revalidatePath("/");
          return { ok: true };
        }
      }
      return actions.composeLifecycleAction(service.id, "deploy");
    }, unstable_rethrow);
    if (report.failed) report.failed.error = safeError(report.failed.error, operations, report.failed.id);
    if (report.error) report.error = safeError(report.error, operations, "deploy");
    return report;
  } catch (error) {
    unstable_rethrow(error);
    const valid = Array.isArray(operations) ? operations.filter((op) => op && typeof op.id === "string" && Array.isArray(op.args)) : [];
    return {
      ok: false, applied: [],
      failed: { id: failedId, error: safeError(friendlyEngineError(error instanceof Error ? error.message : String(error)), valid, failedId) },
      skipped: valid.filter((op) => op.id !== failedId).map((op) => op.id), deploy: "skipped",
    };
  }
}
