/**
 * Tool surface exposed to the model. Each tool wraps existing dokploy.ts
 * operations (via ./ops). SAFE tools execute immediately; the four DESTRUCTIVE
 * tools never execute — they append to the per-user staged-changes store and
 * return `{staged}` so the model can tell the user to review the Apply bar.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import * as ops from "./ops";
import { addStaged, type StagedChange } from "./store";

export interface ToolContext {
  sessionKey: string;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  staged?: StagedChange;
  /** Short human label for the UI activity chip, e.g. "Deploying n8n". */
  label: string;
}

type Input = Record<string, unknown>;
type Handler = (input: Input, ctx: ToolContext) => Promise<ToolOutcome>;

interface ToolDef {
  schema: Anthropic.Tool;
  run: Handler;
}

// --- input helpers ----------------------------------------------------------

function str(input: Input, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function reqStr(input: Input, key: string): string {
  const v = str(input, key);
  if (!v) throw new Error(`Missing required parameter "${key}".`);
  return v;
}
function num(input: Input, key: string): number | undefined {
  const v = input[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function resolveOrThrow(input: Input) {
  const svc = await ops.resolveService(reqStr(input, "service"));
  if (!svc) throw new Error(`No service matched "${String(input.service)}".`);
  return svc;
}

// --- tool table -------------------------------------------------------------

const TOOLS: Record<string, ToolDef> = {
  list_services: {
    schema: {
      name: "list_services",
      description:
        "List every deployed service (applications, databases, compose stacks) plus the project/environment tree. Call this first to discover ids, names, appNames and current status.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => ({
      content: JSON.stringify(await ops.workspaceSummary()),
      label: "Listing services",
    }),
  },

  get_service_detail: {
    schema: {
      name: "get_service_detail",
      description:
        "Get full detail for one service by id or name: env vars, image, domains (with domainId), replicas, resource limits, deployments.",
      input_schema: {
        type: "object",
        properties: { service: { type: "string", description: "Service id, name, or appName." } },
        required: ["service"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      return { content: JSON.stringify(svc), label: `Reading ${svc.name}` };
    },
  },

  deploy_docker_image: {
    schema: {
      name: "deploy_docker_image",
      description:
        "Create an application from a public Docker image and deploy it. Returns the new service id.",
      input_schema: {
        type: "object",
        properties: {
          image: { type: "string", description: 'Image reference, e.g. "nginx:alpine".' },
          name: { type: "string", description: "Optional service name (auto-generated if omitted)." },
          environmentId: { type: "string", description: "Optional target environment id." },
        },
        required: ["image"],
      },
    },
    run: async (input) => {
      const image = reqStr(input, "image");
      const r = await ops.deployDockerImage(image, str(input, "name"), str(input, "environmentId"));
      return { content: `Deployed application "${r.name}" (id ${r.id}) from ${image}.`, label: `Deploying ${image}` };
    },
  },

  deploy_git_repo: {
    schema: {
      name: "deploy_git_repo",
      description:
        "Create an application from a public Git repository (Nixpacks build) and deploy it. Returns the new service id.",
      input_schema: {
        type: "object",
        properties: {
          repoUrl: { type: "string", description: "Public git clone URL." },
          branch: { type: "string", description: "Branch (default main)." },
          environmentId: { type: "string", description: "Optional target environment id." },
        },
        required: ["repoUrl"],
      },
    },
    run: async (input) => {
      const url = reqStr(input, "repoUrl");
      const r = await ops.deployGitRepo(url, str(input, "branch"), str(input, "environmentId"));
      return { content: `Deployed application "${r.name}" (id ${r.id}) from ${url}.`, label: `Deploying ${url}` };
    },
  },

  deploy_template: {
    schema: {
      name: "deploy_template",
      description:
        "Deploy a one-click template from Dokploy's catalog (e.g. n8n, Plausible, Supabase) by name. Creates and deploys a compose stack.",
      input_schema: {
        type: "object",
        properties: {
          template: { type: "string", description: "Template name or id to search for." },
          environmentId: { type: "string", description: "Optional target environment id." },
        },
        required: ["template"],
      },
    },
    run: async (input) => {
      const q = reqStr(input, "template");
      const r = await ops.deployTemplate(q, str(input, "environmentId"));
      return { content: `Deployed template "${r.name}" as compose stack (id ${r.id}).`, label: `Deploying ${q}` };
    },
  },

  create_database: {
    schema: {
      name: "create_database",
      description:
        "Provision and deploy a managed database with a random name/password on the latest engine version.",
      input_schema: {
        type: "object",
        properties: {
          engine: { type: "string", enum: ["postgres", "mysql", "mariadb", "mongo", "redis"] },
          name: { type: "string", description: "Optional name (auto-generated if omitted)." },
          environmentId: { type: "string", description: "Optional target environment id." },
        },
        required: ["engine"],
      },
    },
    run: async (input) => {
      const engine = reqStr(input, "engine");
      const r = await ops.createDatabaseOp(engine, str(input, "name"), str(input, "environmentId"));
      return { content: `Deployed ${engine} database "${r.name}" (id ${r.id}).`, label: `Deploying ${engine}` };
    },
  },

  save_environment: {
    schema: {
      name: "save_environment",
      description:
        "Replace a service's environment variables with a raw KEY=value block (one per line). Works for applications, databases, and compose stacks.",
      input_schema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service id, name, or appName." },
          env: { type: "string", description: 'Full env block, e.g. "KEY=value\\nOTHER=1".' },
        },
        required: ["service", "env"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      await ops.saveServiceEnvironment(svc, reqStr(input, "env"));
      return { content: `Saved environment variables for "${svc.name}". Redeploy for them to take effect.`, label: `Env for ${svc.name}` };
    },
  },

  create_domain: {
    schema: {
      name: "create_domain",
      description:
        "Attach a public domain to an application. For *.localhost hosts HTTPS is disabled automatically; otherwise a Let's Encrypt cert is requested.",
      input_schema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Application id, name, or appName." },
          host: { type: "string", description: "Hostname, e.g. app.example.com or app.localhost." },
          port: { type: "number", description: "Container port to route to (default 80)." },
        },
        required: ["service", "host"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      const host = reqStr(input, "host");
      await ops.createDomainForService(svc, host, num(input, "port") ?? 80);
      return { content: `Attached domain ${host} to "${svc.name}".`, label: `Domain ${host}` };
    },
  },

  create_compose_domain: {
    schema: {
      name: "create_compose_domain",
      description:
        "Attach a public domain to a specific service inside a compose stack (needs the compose service name to route to).",
      input_schema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Compose stack id or name." },
          serviceName: { type: "string", description: "Target service inside the compose file (e.g. kong)." },
          host: { type: "string", description: "Hostname." },
          port: { type: "number", description: "Container port (default 80)." },
        },
        required: ["service", "serviceName", "host"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      const host = reqStr(input, "host");
      await ops.createDomainForService(svc, host, num(input, "port") ?? 80, reqStr(input, "serviceName"));
      return { content: `Attached domain ${host} to compose service ${String(input.serviceName)}.`, label: `Domain ${host}` };
    },
  },

  lifecycle_action: {
    schema: {
      name: "lifecycle_action",
      description:
        "Run a non-destructive lifecycle action on a service: start, deploy, or redeploy. (Stopping or removing a service is a separate staged action.)",
      input_schema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service id, name, or appName." },
          action: { type: "string", enum: ["start", "deploy", "redeploy"] },
        },
        required: ["service", "action"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      const action = reqStr(input, "action") as "start" | "deploy" | "redeploy";
      if (!["start", "deploy", "redeploy"].includes(action)) throw new Error(`Unsupported action "${action}".`);
      await ops.lifecycle(svc, action);
      return { content: `Ran ${action} on "${svc.name}".`, label: `${action} ${svc.name}` };
    },
  },

  read_recent_logs: {
    schema: {
      name: "read_recent_logs",
      description: "Read the most recent container log lines for a service (capped at 300).",
      input_schema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service id, name, or appName." },
          tail: { type: "number", description: "How many recent lines (default 100, max 300)." },
        },
        required: ["service"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      const lines = await ops.recentLogs(svc, num(input, "tail") ?? 100);
      const text = lines.length ? lines.map((l) => l.text).join("\n") : "(no logs — container may not be running)";
      return { content: text.slice(0, 12000), label: `Logs for ${svc.name}` };
    },
  },

  exec_in_service: {
    schema: {
      name: "exec_in_service",
      description:
        "Run a shell command (via `sh -c`) INSIDE a service's running container and get its stdout/stderr/exit code back. This is your window into a deployment for diagnosis — inspect files and processes, check config, curl an internal endpoint, or query a database (e.g. `psql -U postgres -c 'select 1'`, `env`, `cat /app/config.json`, `ls -la`, `ps aux`). Output is capped (~1MB, 15s). Prefer read-only/diagnostic commands; state changes to Dokploy objects still go through the dedicated tools.",
      input_schema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service id, name, or appName (or a full container name to target one compose container)." },
          command: { type: "string", description: "Shell command to run inside the container." },
        },
        required: ["service", "command"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      const command = reqStr(input, "command");
      const r = await ops.execInService(svc, command);
      if (!r) return { content: `Container for "${svc.name}" is not running — cannot exec.`, isError: true, label: `Exec in ${svc.name}` };
      const parts = [
        r.stdout && `stdout:\n${r.stdout}`,
        r.stderr && `stderr:\n${r.stderr}`,
        `exit code: ${r.exitCode ?? "unknown"}${r.truncated ? " (output truncated)" : ""}`,
      ].filter(Boolean);
      return { content: parts.join("\n\n").slice(0, 12000), label: `Exec in ${svc.name}` };
    },
  },

  get_metrics: {
    schema: {
      name: "get_metrics",
      description: "Sample a running service's current CPU (%) and memory (used / limit) usage.",
      input_schema: {
        type: "object",
        properties: { service: { type: "string", description: "Service id, name, or appName." } },
        required: ["service"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      const s = await ops.serviceMetrics(svc);
      if (!s) return { content: `"${svc.name}" is not running — no metrics.`, label: `Metrics for ${svc.name}` };
      const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;
      return {
        content: JSON.stringify({ cpuPercent: Number(s.cpu.toFixed(1)), memoryUsed: mb(s.memUsed), memoryLimit: s.memLimit ? mb(s.memLimit) : "unlimited" }),
        label: `Metrics for ${svc.name}`,
      };
    },
  },

  update_application: {
    schema: {
      name: "update_application",
      description:
        "Update an application's replica count and/or resource limits. Redeploy the app afterwards to apply changes.",
      input_schema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Application id, name, or appName." },
          replicas: { type: "number", description: "Desired replica count." },
          cpuLimit: { type: "string", description: 'Docker CPU limit, e.g. "0.5".' },
          memoryLimit: { type: "string", description: 'Docker memory limit, e.g. "512m".' },
        },
        required: ["service"],
      },
    },
    run: async (input) => {
      const svc = await resolveOrThrow(input);
      await ops.updateApplicationOp(svc, {
        replicas: num(input, "replicas"),
        cpuLimit: str(input, "cpuLimit"),
        memoryLimit: str(input, "memoryLimit"),
      });
      return { content: `Updated "${svc.name}". Redeploy it to apply the new settings.`, label: `Update ${svc.name}` };
    },
  },

  // --- DESTRUCTIVE (staged, never executed here) ----------------------------

  delete_service: {
    schema: {
      name: "delete_service",
      description:
        "STAGE the permanent removal of a service. This does not execute — it queues the change for the user to approve in the Apply bar.",
      input_schema: {
        type: "object",
        properties: { service: { type: "string", description: "Service id, name, or appName." } },
        required: ["service"],
      },
    },
    run: async (input, ctx) => {
      const svc = await resolveOrThrow(input);
      const description = `Delete ${svc.kind} "${svc.name}"`;
      const change = addStaged(ctx.sessionKey, {
        kind: "delete_service",
        params: { kind: svc.kind, id: svc.id, engine: svc.kind === "database" ? svc.engine : "" },
        description,
      });
      return { content: `Staged for approval: ${description} (id ${change.id}). Ask the user to review the Apply bar.`, staged: change, label: `Stage: delete ${svc.name}` };
    },
  },

  stop_service: {
    schema: {
      name: "stop_service",
      description:
        "STAGE stopping a running service. This does not execute — it queues the change for approval.",
      input_schema: {
        type: "object",
        properties: { service: { type: "string", description: "Service id, name, or appName." } },
        required: ["service"],
      },
    },
    run: async (input, ctx) => {
      const svc = await resolveOrThrow(input);
      const description = `Stop ${svc.kind} "${svc.name}"`;
      const change = addStaged(ctx.sessionKey, {
        kind: "stop_service",
        params: { kind: svc.kind, id: svc.id, engine: svc.kind === "database" ? svc.engine : "" },
        description,
      });
      return { content: `Staged for approval: ${description} (id ${change.id}). Ask the user to review the Apply bar.`, staged: change, label: `Stage: stop ${svc.name}` };
    },
  },

  delete_domain: {
    schema: {
      name: "delete_domain",
      description:
        "STAGE removing a domain from a service. Provide the domainId (from get_service_detail). This does not execute — it queues the change for approval.",
      input_schema: {
        type: "object",
        properties: {
          domainId: { type: "string", description: "The domain's id." },
          host: { type: "string", description: "Optional host, used only for the description." },
        },
        required: ["domainId"],
      },
    },
    run: async (input, ctx) => {
      const domainId = reqStr(input, "domainId");
      const host = str(input, "host");
      const description = `Delete domain ${host ?? domainId}`;
      const change = addStaged(ctx.sessionKey, { kind: "delete_domain", params: { domainId }, description });
      return { content: `Staged for approval: ${description} (id ${change.id}). Ask the user to review the Apply bar.`, staged: change, label: `Stage: delete domain` };
    },
  },

  delete_mount: {
    schema: {
      name: "delete_mount",
      description:
        "STAGE removing a volume/mount by mountId. This does not execute — it queues the change for approval.",
      input_schema: {
        type: "object",
        properties: {
          mountId: { type: "string", description: "The mount's id." },
          description: { type: "string", description: "Optional human description of the mount." },
        },
        required: ["mountId"],
      },
    },
    run: async (input, ctx) => {
      const mountId = reqStr(input, "mountId");
      const description = `Delete mount ${str(input, "description") ?? mountId}`;
      const change = addStaged(ctx.sessionKey, { kind: "delete_mount", params: { mountId }, description });
      return { content: `Staged for approval: ${description} (id ${change.id}). Ask the user to review the Apply bar.`, staged: change, label: `Stage: delete mount` };
    },
  },
};

/** The tool schemas passed to the Anthropic API. */
export const toolSchemas: Anthropic.Tool[] = Object.values(TOOLS).map((t) => t.schema);

/** Run a tool by name; unknown tools return an error outcome. */
export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<ToolOutcome> {
  const def = TOOLS[name];
  if (!def) return { content: `Unknown tool "${name}".`, isError: true, label: name };
  try {
    return await def.run(input, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: `Error: ${msg}`, isError: true, label: name };
  }
}
