import "server-only";

import { createHash } from "node:crypto";
import { request } from "./dokploy";
import {
  DuplicateValidationError,
  planEnvironmentDuplicate,
  summarizeEnvironmentDuplicate,
  type DuplicateOptions,
  type DuplicatePlan,
  type DuplicateServiceType,
  type RawDuplicateService,
} from "./environment-duplicate";

export type DuplicateEvent =
  | { type: "environment"; environmentId: string }
  | {
      type: "service";
      sourceId: string;
      status: "copying" | "copied" | "failed" | "deploying" | "deployed" | "deploy-failed" | "deploy-skipped";
      id?: string;
      error?: string;
    }
  | { type: "done"; failed: number; environmentId: string }
  | { type: "error"; error: string };

interface RawEnvironment {
  environmentId: string;
  name: string;
  env?: string | null;
  [key: string]: unknown;
}

interface RawProject {
  projectId: string;
  name: string;
  environments: RawEnvironment[];
}

const serviceCollections: [string, DuplicateServiceType][] = [
  ["applications", "application"], ["compose", "compose"],
  ["postgres", "postgres"], ["mysql", "mysql"], ["mariadb", "mariadb"],
  ["mongo", "mongo"], ["redis", "redis"],
];

/** Validate the request before using client-supplied IDs in API requests. */
export function duplicateOptions(input: unknown): DuplicateOptions {
  if (!input || typeof input !== "object") throw new DuplicateValidationError("Invalid duplicate options.");
  const value = input as Record<string, unknown>;
  if (typeof value.projectId !== "string" || !value.projectId ||
      typeof value.sourceEnvironmentId !== "string" || !value.sourceEnvironmentId ||
      typeof value.name !== "string" ||
      (value.copyVariables !== undefined && typeof value.copyVariables !== "boolean") ||
      (value.deploy !== undefined && typeof value.deploy !== "boolean")) {
    throw new DuplicateValidationError("Invalid duplicate options.");
  }
  return {
    projectId: value.projectId,
    sourceEnvironmentId: value.sourceEnvironmentId,
    name: value.name,
    copyVariables: value.copyVariables as boolean | undefined,
    deploy: value.deploy as boolean | undefined,
  };
}

/** Raw Dokploy error bodies can contain settings; never send them to the browser. */
export function duplicateError(error: unknown): string {
  return error instanceof DuplicateValidationError
    ? error.message
    : "Could not duplicate the environment. Check your session and Dokploy connection, then review the services left in the new environment.";
}

export async function prepareEnvironmentDuplicate(input: DuplicateOptions) {
  const options = duplicateOptions(input);
  // Every read uses the caller's Dokploy session, including the project scope check.
  const projects = await request<RawProject[]>("project.all");
  const project = projects.find((p) => p.projectId === options.projectId);
  const source = project?.environments.find((e) => e.environmentId === options.sourceEnvironmentId);
  if (!project || !source) throw new DuplicateValidationError("Source environment was not found in this project.");
  const detail = await request<RawEnvironment>(`environment.one?environmentId=${encodeURIComponent(source.environmentId)}`);
  if (Array.isArray(detail.libsql) && detail.libsql.length > 0) {
    throw new DuplicateValidationError("This environment contains libSQL services, which cannot be duplicated yet.");
  }
  const services: RawDuplicateService[] = [];
  for (const [collection, type] of serviceCollections) {
    const refs = (detail[collection] ?? source[collection] ?? []) as Record<string, unknown>[];
    for (const ref of refs) {
      const id = ref[`${type}Id`];
      if (typeof id !== "string" || !id) throw new DuplicateValidationError("A source service has no ID. Refresh the workspace and try again.");
      const [service, mounts] = await Promise.all([
        request<Record<string, unknown>>(`${type}.one?${type}Id=${encodeURIComponent(id)}`),
        request<Record<string, unknown>[]>(`mounts.listByServiceId?serviceType=${type}&serviceId=${encodeURIComponent(id)}`),
      ]);
      services.push({ type, id, detail: service, mounts });
    }
  }
  const plan = planEnvironmentDuplicate({
    ...project,
    environments: project.environments.map((e) => e.environmentId === source.environmentId ? { ...e, env: detail.env } : e),
  }, options, services);
  const fingerprint = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return { plan, summary: summarizeEnvironmentDuplicate(plan), fingerprint };
}

const running = new Set<string>();

/** Re-read the reviewed plan before any mutation; partial copies are never removed. */
export async function executeEnvironmentDuplicate(
  input: DuplicateOptions,
  fingerprint: string,
  emit: (event: DuplicateEvent) => void,
): Promise<void> {
  const options = duplicateOptions(input);
  const key = `${options.projectId}\0${options.name.trim().toLowerCase()}`;
  if (running.has(key)) throw new DuplicateValidationError("This environment is already being duplicated. Wait for it to finish and refresh.");
  running.add(key);
  try {
    const prepared = await prepareEnvironmentDuplicate(options);
    if (prepared.fingerprint !== fingerprint) {
      throw new DuplicateValidationError("The source or options changed after preflight. Review a new preflight before duplicating.");
    }
    await copyPlan(prepared.plan, emit);
  } finally {
    running.delete(key);
  }
}

async function copyPlan(plan: DuplicatePlan, emit: (event: DuplicateEvent) => void) {
  const created = await request<{ environmentId: string }>("environment.create", {
    method: "POST", body: { projectId: plan.options.projectId, name: plan.options.name },
  });
  const environmentId = created.environmentId;
  if (!environmentId) throw new DuplicateValidationError("Dokploy did not return the new environment ID. Refresh the project before trying again.");
  emit({ type: "environment", environmentId });
  if (plan.environment) {
    try {
      await request("environment.update", { method: "POST", body: { ...plan.environment, environmentId } });
    } catch {
      throw new DuplicateValidationError("The new environment was created, but its shared variables could not be copied. The environment remains available to inspect; no services were created.");
    }
  }
  const copied: { sourceId: string; type: DuplicateServiceType; id: string }[] = [];
  const volumes = new Map<string, string>();
  let failed = 0;
  for (const service of plan.services) {
    let id: string | undefined;
    let stage = "create service";
    emit({ type: "service", sourceId: service.sourceId, status: "copying" });
    try {
      const idKey = `${service.type}Id`;
      const result = await request<Record<string, unknown>>(`${service.type}.create`, {
        method: "POST", body: { ...service.create, environmentId },
      });
      if (typeof result[idKey] !== "string" || !result[idKey]) throw new Error("Missing created service ID");
      id = result[idKey] as string;
      stage = "copy service settings";
      await request(`${service.type}.update`, {
        method: "POST", body: { ...service.update, [idKey]: id },
      });
      if (service.environment) {
        stage = "copy variables";
        await request(`${service.type}.saveEnvironment`, {
          method: "POST", body: { ...service.environment, [idKey]: id },
        });
      }
      stage = "copy ports";
      for (const port of service.ports) {
        await request("port.create", { method: "POST", body: { ...port, applicationId: id } });
      }
      stage = "copy mount definitions";
      if (service.mounts.length > 0) {
        // Database creation adds a default data mount. Reuse it rather than
        // adding a second mount at the same container path.
        const defaults = await request<Record<string, unknown>[]>(`mounts.listByServiceId?serviceType=${service.type}&serviceId=${encodeURIComponent(id)}`);
        for (const [index, mount] of service.mounts.entries()) {
          const { sourceVolumeName, ...body } = mount;
          if (mount.type === "volume") {
            const key = JSON.stringify([service.create.serverId ?? null, sourceVolumeName ?? `${service.sourceId}:${index}`]);
            let name = volumes.get(key);
            if (!name) {
              name = `duplicate-${environmentId.replace(/[^a-zA-Z0-9-]/g, "-")}-${volumes.size}`;
              volumes.set(key, name);
            }
            body.volumeName = name;
          }
          const existing = defaults.find((m) => m.mountPath === mount.mountPath && typeof m.mountId === "string");
          await request(existing ? "mounts.update" : "mounts.create", {
            method: "POST",
            body: existing ? { ...body, mountId: existing.mountId } : { ...body, serviceType: service.type, serviceId: id },
          });
        }
      }
      copied.push({ sourceId: service.sourceId, type: service.type, id });
      emit({ type: "service", sourceId: service.sourceId, status: "copied", id });
    } catch {
      failed++;
      emit({ type: "service", sourceId: service.sourceId, status: "failed", id,
        error: `Could not ${stage}.${id ? " The created service remains in the new environment." : " Check the new environment before retrying."}` });
    }
  }
  if (plan.options.deploy) {
    const setupFailed = failed > 0;
    for (const service of copied) {
      if (setupFailed) {
        emit({ type: "service", sourceId: service.sourceId, status: "deploy-skipped", id: service.id,
          error: "Deployment skipped because one or more services could not be copied. Review the partial environment first." });
        continue;
      }
      emit({ type: "service", sourceId: service.sourceId, status: "deploying", id: service.id });
      try {
        await request(`${service.type}.deploy`, { method: "POST", body: { [`${service.type}Id`]: service.id } });
        emit({ type: "service", sourceId: service.sourceId, status: "deployed", id: service.id });
      } catch {
        failed++;
        emit({ type: "service", sourceId: service.sourceId, status: "deploy-failed", id: service.id,
          error: "Deployment could not be queued. The copied service remains available to inspect and deploy manually." });
      }
    }
  }
  emit({ type: "done", failed, environmentId });
}
