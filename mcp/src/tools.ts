/**
 * MCP tool definitions for driving Dokploy.
 *
 * Each tool is small and typed (zod input shapes). Tools that mutate or destroy
 * carry annotations; `service_action`'s remove is the only irreversible one and
 * is named plainly. Every handler is wrapped so failures come back as an MCP
 * tool error (isError) instead of crashing the server.
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ACTIONS,
  ENGINES,
  ENGINE_IMAGE,
  createDatabase,
  createDomain,
  databaseAction,
  deployCompose,
  deployImage,
  deployRepo,
  findService,
  listProjects,
  listServices,
  resolveTargetEnv,
  saveApplicationEnvironment,
  saveDatabaseEnvironment,
  serviceAction,
  type Engine,
} from "./dokploy.js";
import { readLogs, readMetrics } from "./docker.js";

// --- small helpers ----------------------------------------------------------

const SUFFIX = "abcdefghijkmnpqrstuvwxyz23456789";
function randomServiceName(prefix: string): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += SUFFIX[randomInt(SUFFIX.length)];
  return `${prefix}-${s}`;
}

const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function randomPassword(len = 20): string {
  let out = "";
  for (let i = 0; i < len; i++) out += PW_CHARS[randomInt(PW_CHARS.length)];
  return out;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function text(payload: unknown): ToolResult {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text", text: body }] };
}

/** Wrap a handler so thrown errors surface as an MCP tool error. */
function guard<A>(fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  };
}

// --- tool definitions -------------------------------------------------------

/**
 * A registrable tool. Kept as data (not inline `registerTool` calls) so the
 * test suite can assert the full tool list and each input schema.
 */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  // Handler is intentionally loosely typed here; zod validates at call time.
  handler: (args: any) => Promise<ToolResult>;
}

const serviceQuery = z
  .string()
  .describe("Service name, appName, or id (use list_services to discover values)");

export const TOOLS: ToolDef[] = [
  {
    name: "list_projects",
    title: "List projects",
    description:
      "List all Dokploy projects and their environments. Use the environmentId values to target deploys.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    handler: guard(async () => text(await listProjects())),
  },
  {
    name: "list_services",
    title: "List services",
    description:
      "List every service (database, application, compose) across the workspace with id, name, appName, kind, status, and project/environment scope.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    handler: guard(async () => text(await listServices())),
  },
  {
    name: "deploy_image",
    title: "Deploy Docker image",
    description:
      "Create an application from a public Docker image and deploy it. Returns the new service's id, name, and appName.",
    inputSchema: {
      image: z.string().describe('Docker image, e.g. "nginx:alpine" or "ghcr.io/owner/app:tag"'),
      name: z.string().optional().describe("Optional service name; auto-derived from the image if omitted"),
      environmentId: z.string().optional().describe("Target environment; the first/default env is used if omitted"),
    },
    handler: guard(async ({ image, name, environmentId }) => {
      const trimmed = String(image).trim();
      if (!trimmed) throw new Error("image is required.");
      const derived = trimmed.split("/").pop()!.split(":")[0]!;
      const env = await resolveTargetEnv(environmentId);
      const ref = await deployImage(trimmed, name?.trim() || randomServiceName(derived), env);
      return text({ deployed: ref, hint: `Read logs with get_logs { service: "${ref.name}" }` });
    }),
  },
  {
    name: "deploy_repo",
    title: "Deploy Git repo",
    description:
      "Create an application from a public Git repository (built with Nixpacks) and deploy it. Returns the new service's id, name, and appName.",
    inputSchema: {
      repoUrl: z.string().describe("Public Git clone URL, e.g. https://github.com/owner/repo"),
      branch: z.string().optional().describe('Branch to build (default "main")'),
      name: z.string().optional().describe("Optional service name; auto-derived from the repo if omitted"),
      environmentId: z.string().optional().describe("Target environment; the first/default env is used if omitted"),
    },
    handler: guard(async ({ repoUrl, branch, name, environmentId }) => {
      const url = String(repoUrl).trim();
      if (!url) throw new Error("repoUrl is required.");
      const derived = url.replace(/\.git$/, "").split("/").filter(Boolean).pop() || "app";
      const env = await resolveTargetEnv(environmentId);
      const ref = await deployRepo(url, name?.trim() || randomServiceName(derived), env, branch?.trim() || "main");
      return text({ deployed: ref, hint: `Read logs with get_logs { service: "${ref.name}" }` });
    }),
  },
  {
    name: "deploy_compose",
    title: "Deploy compose stack",
    description:
      "Create a docker-compose stack from a YAML string and deploy it. Returns the new stack's id, name, and appName.",
    inputSchema: {
      composeYaml: z.string().describe("Full docker-compose YAML as a string"),
      name: z.string().optional().describe("Optional stack name; auto-generated if omitted"),
      environmentId: z.string().optional().describe("Target environment; the first/default env is used if omitted"),
    },
    handler: guard(async ({ composeYaml, name, environmentId }) => {
      const yaml = String(composeYaml);
      if (!yaml.trim()) throw new Error("composeYaml is required.");
      const env = await resolveTargetEnv(environmentId);
      const ref = await deployCompose(name?.trim() || randomServiceName("compose"), env, yaml);
      return text({ deployed: ref });
    }),
  },
  {
    name: "service_action",
    title: "Service lifecycle action",
    description:
      "Run a lifecycle action on a service. Actions: deploy, start, stop, remove. 'remove' deletes the service and is irreversible.",
    inputSchema: {
      service: serviceQuery,
      action: z.enum(ACTIONS).describe("deploy | start | stop | remove"),
    },
    annotations: { destructiveHint: true },
    handler: guard(async ({ service, action }) => {
      const svc = await findService(service);
      await serviceAction(svc, action);
      return text({ ok: true, service: svc.name, kind: svc.kind, action });
    }),
  },
  {
    name: "get_logs",
    title: "Get service logs",
    description:
      "Read a bounded tail of a service's container logs (stdout+stderr, with timestamps) straight from the Docker engine.",
    inputSchema: {
      service: serviceQuery,
      tail: z.number().int().min(1).max(2000).optional().describe("Number of trailing lines (default 200)"),
    },
    annotations: { readOnlyHint: true },
    handler: guard(async ({ service, tail }) => {
      const svc = await findService(service);
      const { running, lines } = await readLogs(svc.appName, tail ?? 200);
      if (!running) {
        return text({ service: svc.name, appName: svc.appName, running: false, note: "No running container found for this service." });
      }
      return text({ service: svc.name, appName: svc.appName, running: true, lineCount: lines.length, logs: lines.join("\n") });
    }),
  },
  {
    name: "get_metrics",
    title: "Get service metrics",
    description: "Take a single CPU/memory sample for a service's running container.",
    inputSchema: { service: serviceQuery },
    annotations: { readOnlyHint: true },
    handler: guard(async ({ service }) => {
      const svc = await findService(service);
      const sample = await readMetrics(svc.appName);
      return text({ service: svc.name, appName: svc.appName, ...sample });
    }),
  },
  {
    name: "manage_env",
    title: "Read or replace env vars",
    description:
      "Read a service's raw environment block, or replace it wholesale. mode='read' returns the current env; mode='replace' sets it (env required). Databases and applications only.",
    inputSchema: {
      service: serviceQuery,
      mode: z.enum(["read", "replace"]).describe("read | replace"),
      env: z.string().optional().describe('Raw "KEY=value" block (newline-separated); required when mode=replace'),
    },
    handler: guard(async ({ service, mode, env }) => {
      const svc = await findService(service);
      if (mode === "read") {
        return text({ service: svc.name, kind: svc.kind, env: svc.env ?? "" });
      }
      if (env === undefined) throw new Error("env is required when mode is 'replace'.");
      if (svc.kind === "database") await saveDatabaseEnvironment(svc.engine!, svc.id, env);
      else if (svc.kind === "application") await saveApplicationEnvironment(svc.id, env);
      else throw new Error("Replacing env is supported for databases and applications only.");
      return text({ ok: true, service: svc.name, kind: svc.kind, note: "Env replaced. Redeploy the service to apply." });
    }),
  },
  {
    name: "manage_domain",
    title: "Add a domain",
    description:
      "Attach a public domain (host) to an application, with automatic HTTPS via Let's Encrypt.",
    inputSchema: {
      service: serviceQuery,
      host: z.string().describe("The domain/host to attach, e.g. app.example.com"),
      port: z.number().int().min(1).max(65535).optional().describe("Container port to route to (default 80)"),
    },
    handler: guard(async ({ service, host, port }) => {
      const svc = await findService(service);
      if (svc.kind !== "application") throw new Error("Domains can only be added to applications.");
      await createDomain(svc.id, String(host).trim(), port ?? 80);
      return text({ ok: true, service: svc.name, host: String(host).trim(), https: true });
    }),
  },
  {
    name: "create_database",
    title: "Create a database",
    description:
      "Provision a managed database (postgres, mysql, mariadb, mongo, or redis) and deploy it by default. Returns the new database's id and generated credentials.",
    inputSchema: {
      engine: z.enum(ENGINES).describe("postgres | mysql | mariadb | mongo | redis"),
      name: z.string().optional().describe("Optional name; auto-generated if omitted"),
      databaseName: z.string().optional().describe("Initial database name (ignored for redis/mongo)"),
      databaseUser: z.string().optional().describe('Database user (ignored for redis; default "admin")'),
      databasePassword: z.string().optional().describe("Password; a strong one is generated if omitted"),
      environmentId: z.string().optional().describe("Target environment; the first/default env is used if omitted"),
      deploy: z.boolean().optional().describe("Deploy immediately after create (default true)"),
    },
    handler: guard(async ({ engine, name, databaseName, databaseUser, databasePassword, environmentId, deploy }) => {
      const eng = engine as Engine;
      const env = await resolveTargetEnv(environmentId);
      const finalName = name?.trim() || randomServiceName(eng);
      const password = databasePassword || randomPassword();
      const id = await createDatabase({
        engine: eng,
        name: finalName,
        environmentId: env,
        databaseName,
        databaseUser,
        databasePassword: password,
        dockerImage: ENGINE_IMAGE[eng],
      });
      const willDeploy = deploy !== false;
      if (willDeploy) await databaseAction(eng, id, "deploy");
      return text({
        created: { id, engine: eng, name: finalName, image: ENGINE_IMAGE[eng] },
        credentials: { databaseUser: databaseUser ?? (eng === "redis" ? null : "admin"), databasePassword: password },
        deployed: willDeploy,
      });
    }),
  },
];

/** Register every tool on an McpServer instance. */
export function registerTools(server: McpServer): void {
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations ? { annotations: t.annotations } : {}),
      },
      t.handler
    );
  }
}
