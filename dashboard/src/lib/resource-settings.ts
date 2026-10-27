import { ENGINES, request, type Engine } from "./dokploy";
import { parseResources, type ResourceInputs } from "./resource-limits";

type ResourceProject = {
  environments: Partial<Record<"applications" | Engine, Record<string, string>[]>>[];
};

/** Save only: the caller's project tree authorizes the target before mutation. */
export async function updateResourceSettings(
  kind: "application" | Engine,
  id: string,
  input: ResourceInputs
): Promise<void> {
  if (kind !== "application" && !ENGINES.includes(kind)) {
    throw new Error("Unsupported resource service type.");
  }
  if (typeof id !== "string" || !id) throw new Error("Service is required.");

  const tree = await request<ResourceProject[]>("project.all");
  const collection = kind === "application" ? "applications" : kind;
  const idKey = `${kind}Id`;
  const owned = tree.some((project) =>
    project.environments.some((env) => env[collection]?.some((service) => service[idKey] === id))
  );
  if (!owned) throw new Error("Service is not in your projects.");

  const patch = parseResources(input);
  await request(`${kind}.update`, {
    method: "POST",
    body: { [idKey]: id, ...patch },
  });
}
