"use server";

import { unstable_rethrow } from "next/navigation";
import { ENGINES, loadWorkspace, type MountServiceType } from "@/lib/dokploy";
import { referenceTargets } from "@/lib/reference-vars";
import { resolveTemplate, type RefIssue } from "@/lib/references";

/** Check references on demand without sending other services' values to the editor. */
export async function validateServiceReferencesAction(
  type: MountServiceType,
  id: string,
  template: string
): Promise<{ ok: true; referencing: string[]; issues: RefIssue[] } | { ok: false; error: string }> {
  try {
    if (!["application", "compose", ...ENGINES].includes(type) || !id || typeof template !== "string") {
      throw new Error("Invalid service.");
    }
    // loadWorkspace uses the signed-in user's project tree and session. Match
    // both kind and id before resolving against that owned workspace.
    const { services } = await loadWorkspace();
    const self = services.find((service) => service.id === id &&
      (service.kind === "database" ? service.engine : service.kind) === type);
    if (!self) throw new Error("Service unavailable.");
    const { referencing, issues } = resolveTemplate(
      template,
      self.name,
      referenceTargets(services, self.environmentId)
    );
    return { ok: true, referencing: [...referencing], issues };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: "Could not validate variable references." };
  }
}
