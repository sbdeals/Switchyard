import "server-only";
import { getDokployRole } from "../dokploy";
import type { SwitchyardSession } from "../session";

/** Global configuration only; agent usage remains available to signed-in users. */
export async function agentConfigAccess(session: SwitchyardSession) {
  try {
    const role = await getDokployRole(session.dokployCookie);
    const canConfigure = role === "owner" || role === "admin";
    return {
      canConfigure,
      error: canConfigure ? null : "Only workspace admins can change the agent provider.",
    };
  } catch {
    return {
      canConfigure: false,
      error: "Could not verify your workspace admin role with Dokploy. Agent configuration is disabled; try again.",
    };
  }
}
