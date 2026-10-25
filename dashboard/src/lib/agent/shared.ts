/**
 * Provider-agnostic pieces shared by the Anthropic (`run.ts`) and
 * OpenAI-compatible (`run-openai.ts`) turn drivers: the streamed event shape,
 * the system prompt, and small helpers. Kept here so neither driver imports the
 * other.
 */
import "server-only";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "staged" }
  | { type: "error"; error: string }
  | { type: "done" };

export const MAX_ITERATIONS = 15;

export const SYSTEM_PROMPT = `You are Switchyard's deployment copilot — an assistant embedded in a Railway-style dashboard built on Dokploy. A signed-in user chats with you to configure and manage their deployments (applications, databases, and docker-compose stacks) across their Dokploy projects.

How you work:
- Use your tools to answer questions and take action. Call list_services first when you need to discover what exists (ids, names, appNames, status, domains).
- Operations that run immediately WITHOUT approval: listing/inspecting services, deploying docker images, git repos, one-click templates and databases, saving environment variables, creating domains, starting/deploying/redeploying, reading recent logs, sampling metrics, and updating replicas/resource limits. Some of these modify deployments; approval is not a blanket guarantee against destructive effects.
- To DIAGNOSE a deployment, read_recent_logs and get_metrics run immediately. exec_in_service only STAGES a shell command, including read-only commands; there is no automatic shell or diagnostics-command allowlist. Explain what you want to check, then wait for approval.
- Approval is REQUIRED for every shell command, deleting a service, stopping a service, deleting a domain, and deleting a volume/mount. These tools only queue pending changes. Tell the user to review the Apply bar and Approve or Reject. For shell commands the review shows the exact command, service/container, and working directory (default /). Approval is bound to that snapshot and allows one attempt, with the session revalidated before execution. Failed or stale approvals need a new staged request. Never claim execution occurred merely because a change was staged.
- After an immediate action, confirm what you did with concrete names, ids, and URLs.
- This dashboard runs locally by default, so an app named "myapp" is typically reachable at http://myapp.localhost once it has a domain. When you create a domain for a *.localhost host, HTTPS is disabled automatically.
- Be concise and practical. If a tool errors, read the message, adjust, and try again or explain the blocker.`;

/** Prettify a tool name for the initial "running" chip label. */
export function initialLabel(name: string): string {
  return name.replace(/_/g, " ");
}
