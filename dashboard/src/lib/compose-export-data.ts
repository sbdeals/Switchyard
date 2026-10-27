import "server-only";

import { listMounts, request, type Application } from "./dokploy";
import type { ComposeExportInput } from "./compose-export";

type ApplicationDetail = Partial<Pick<
  Application,
  "name" | "appName" | "sourceType" | "dockerImage" | "env" | "ports" |
  "cpuLimit" | "memoryLimit" | "restartPolicySwarm"
>>;

interface ProjectScope {
  environments?: { applications?: { applicationId: string }[] }[];
}

/** Check the current user's project tree before reading any application data. */
async function ownedApplication(id: string): Promise<ApplicationDetail> {
  if (typeof id !== "string" || !id.trim() || id.length > 200) {
    throw new Error("Invalid application");
  }
  const projects = await request<ProjectScope[]>("project.all");
  const owned = projects.some((project) =>
    project.environments?.some((environment) =>
      environment.applications?.some((application) => application.applicationId === id)
    )
  );
  if (!owned) throw new Error("Application unavailable");
  return request<ApplicationDetail>(`application.one?applicationId=${encodeURIComponent(id)}`);
}

/** Dotenv syntax: quoted multiline values, optional export, and inline comments. */
export function exportEnvironment(env: string, includeValues: boolean) {
  const values = new Map<string, string>();
  const pattern = /(?:^|\n)[ \t]*(?:export[ \t]+)?([\w.-]+)[ \t]*=[ \t]*('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^\r\n]*)/g;
  // Keep quoted values intact while parsing so an embedded newline cannot be
  // mistaken for another key, especially in the default names-only response.
  for (const match of env.replace(/\r\n?/g, "\n").matchAll(pattern)) {
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === "'" || quote === '"' || quote === "`") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    } else {
      value = value.split("#", 1)[0].trim();
    }
    values.set(match[1], value);
  }
  return [...values].map(([key, value]) => includeValues ? { key, value } : { key });
}

/** Minimal export DTO; file contents and unrelated application fields stay server-side. */
export async function loadComposeExportData(
  id: string,
  includeValues = false
): Promise<ComposeExportInput> {
  if (typeof includeValues !== "boolean") throw new Error("Invalid export option");
  const application = await ownedApplication(id);
  const mounts = await listMounts("application", id);
  const restart = application.restartPolicySwarm;
  return {
    name: application.appName || application.name || "application",
    sourceType: application.sourceType ?? null,
    dockerImage: application.dockerImage ?? null,
    environment: exportEnvironment(application.env ?? "", includeValues),
    ports: (application.ports ?? []).map((port) => ({
      publishedPort: port.publishedPort,
      targetPort: port.targetPort,
      protocol: port.protocol,
      publishMode: port.publishMode,
    })),
    mounts: mounts.map((mount) => ({
      type: mount.type,
      mountPath: mount.mountPath,
      volumeName: mount.volumeName,
      hostPath: mount.hostPath,
      filePath: mount.filePath,
    })),
    cpuLimit: application.cpuLimit ?? null,
    memoryLimit: application.memoryLimit ?? null,
    restartPolicySwarm: restart ? {
      Condition: restart.Condition,
      Delay: restart.Delay,
      MaxAttempts: restart.MaxAttempts,
      Window: restart.Window,
    } : null,
  };
}
