"use server";

import { unstable_rethrow } from "next/navigation";
import { ENGINES, loadWorkspace, type MountServiceType } from "@/lib/dokploy";
import { referenceTargets } from "@/lib/reference-vars";
import { resolveTemplate, type RefIssue } from "@/lib/references";
import { validateVariableReferences } from "@/lib/variable-references";
import type { VariableRow, VariableRowIssue } from "@/lib/variable-rows";

/** Check references on demand without sending other services' values to the editor. */
export async function validateServiceReferencesAction(
  type: MountServiceType,
  id: string,
  template: string,
  rows?: readonly Pick<VariableRow, "index" | "key" | "value">[]
): Promise<{ ok: true; referencing: string[]; issues: RefIssue[]; rowIssues: VariableRowIssue[] } | { ok: false; error: string }> {
  try {
    if (!["application", "compose", ...ENGINES].includes(type) || !id || typeof template !== "string" ||
      (rows !== undefined && (!Array.isArray(rows) || rows.some((row) => !row ||
        !Number.isInteger(row.index) || row.index < 0 || typeof row.key !== "string" || typeof row.value !== "string")))) {
      throw new Error("Invalid service.");
    }
    // loadWorkspace uses the signed-in user's project tree and session. Match
    // both kind and id before resolving against that owned workspace.
    const { services } = await loadWorkspace();
    const self = services.find((service) => service.id === id &&
      (service.kind === "database" ? service.engine : service.kind) === type);
    if (!self) throw new Error("Service unavailable.");
    const targets = referenceTargets(services.filter((service) =>
      service.projectId === self.projectId && service.environmentId === self.environmentId));
    const { referencing, issues } = resolveTemplate(template, self.name, targets);
    const rowIssues = validateVariableReferences(template, self.name, targets, rows);
    return { ok: true, referencing: [...referencing], issues, rowIssues };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: "Could not validate variable references." };
  }
}
