import "server-only";

/** Use the role from requireActiveAgentSession's lookup, without a second call. */
export function agentConfigAccess(role: string) {
  const canConfigure = role === "owner" || role === "admin";
  return {
    canConfigure,
    error: canConfigure ? null : "Only workspace admins can change the agent provider.",
  };
}
