import {
  buildDuplicatePlan,
  duplicateServiceNameError,
  type DuplicateServiceRef,
} from "./service-duplicate";

type Api = (path: string, init?: { method: "POST"; body: unknown }) => Promise<unknown>;
type Row = Record<string, unknown>;
interface Environment extends Row {
  environmentId: string;
}
interface Project {
  environments: Environment[];
}

const SERVICE_TYPES = ["application", "compose", "postgres", "mysql", "mariadb", "mongo", "redis"] as const;
const collection = (type: string) => type === "application" ? "applications" : type;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];

/** Uses the caller's authenticated Dokploy client; never accepts credentials. */
export async function duplicateService(
  api: Api,
  ref: DuplicateServiceRef,
  name: string,
  environmentId: string,
  suffix: string
): Promise<string> {
  const type = ref?.kind === "database" ? ref.engine : ref?.kind;
  if (!["application", "compose", "database"].includes(ref?.kind) ||
      (ref.kind === "database" && !SERVICE_TYPES.slice(2).includes(ref.engine)) ||
      !SERVICE_TYPES.includes(type) || typeof ref.id !== "string" || !ref.id || typeof environmentId !== "string") {
    throw new Error("Invalid service or target environment.");
  }
  const nameError = typeof name === "string" ? duplicateServiceNameError(name) : "A service name is required.";
  if (nameError) throw new Error(nameError);

  // Both the source and destination must be visible in project.all, and must
  // belong to the same project. Do this before reading any source settings.
  const tree = await api("project.all") as Project[];
  const project = tree.find((p) => p.environments.some((env) =>
    rows(env[collection(type)]).some((s) => s[`${type}Id`] === ref.id)
  ));
  const target = project?.environments.find((env) => env.environmentId === environmentId);
  if (!target) throw new Error("Source and target must belong to a project you can access.");

  // Some project.all responses contain only IDs. Resolve missing names so a
  // collision with any service kind in the destination is still rejected.
  const existingNames: string[] = [];
  for (const serviceType of SERVICE_TYPES) {
    for (const service of rows(target[collection(serviceType)])) {
      const detail = typeof service.name === "string" ? service : await api(
        `${serviceType}.one?${serviceType}Id=${encodeURIComponent(String(service[`${serviceType}Id`]))}`
      ) as Row;
      if (typeof detail.name === "string") existingNames.push(detail.name);
    }
  }
  const collision = duplicateServiceNameError(name, existingNames);
  if (collision) throw new Error(collision);

  const source = await api(`${type}.one?${type}Id=${encodeURIComponent(ref.id)}`) as Row;
  if (type === "compose" && source.sourceType !== "raw") {
    // Repository compose files live in Dokploy's checkout, not necessarily in
    // compose.one. Read the current file through its API; the mapper removes
    // routing labels and replaces volumes before storing the raw snapshot.
    const composeFile = await api(`compose.getConvertedCompose?composeId=${encodeURIComponent(ref.id)}`);
    if (typeof composeFile !== "string") throw new Error("Save or fetch the source compose file before duplicating this service.");
    source.composeFile = composeFile;
  }
  const mounts = rows(await api(
    `mounts.listByServiceId?serviceType=${type}&serviceId=${encodeURIComponent(ref.id)}`
  ));
  const plan = buildDuplicatePlan({ source, ref, name, environmentId, existingNames, suffix, mounts });
  const created = await api(`${type}.create`, { method: "POST", body: plan.create }) as Row;
  const id = created[`${type}Id`];
  if (typeof id !== "string" || !id) throw new Error("Dokploy did not return the duplicated service ID.");
  const identity = { [`${type}Id`]: id };

  try {
    await api(`${type}.update`, { method: "POST", body: { ...plan.update, ...identity } });
    if (plan.environment) {
      await api(`${type}.saveEnvironment`, { method: "POST", body: { ...plan.environment, ...identity } });
    }
    if (ref.kind === "database") {
      // Database create adds a data mount. Replace it before recreating the
      // source's mount layout, otherwise the data path would be mounted twice.
      const defaults = rows(await api(`mounts.listByServiceId?serviceType=${type}&serviceId=${encodeURIComponent(id)}`));
      for (const mount of defaults) {
        await api("mounts.remove", { method: "POST", body: { mountId: mount.mountId } });
      }
    }
    for (const mount of plan.mounts) {
      await api("mounts.create", { method: "POST", body: { ...mount, serviceType: type, serviceId: id } });
    }
    for (const port of plan.ports) {
      await api("port.create", { method: "POST", body: { ...port, applicationId: id } });
    }
    return id;
  } catch (error) {
    // Only the record made by this invocation is eligible for cleanup.
    try {
      await api(`${type}.${ref.kind === "database" ? "remove" : "delete"}`, {
        method: "POST", body: { ...identity, ...(type === "compose" ? { deleteVolumes: false } : {}) },
      });
    } catch {
      throw new Error(`Duplication failed and cleanup failed. Remove the incomplete service "${name.trim()}" (${id}) before retrying.`);
    }
    throw error;
  }
}
