import type { Service } from "./dokploy";
import { stripUrlCredentials } from "./url-credentials";
import { variableCount } from "./delete-impact";

/** Only service keys are needed by Networking; never pass the YAML to it. */
function composeServiceNames(file: string | null): string[] {
  if (!file) return [];
  const lines = file.split("\n");
  const start = lines.findIndex((line) => /^services:\s*(#.*)?$/.test(line));
  if (start === -1) return [];
  const names: string[] = [];
  let childIndent: number | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^(\s*)/)![1].length;
    if (indent === 0) break;
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue;
    const match = line.match(/^\s+([A-Za-z0-9._-]+):\s*(#.*)?$/);
    if (match) names.push(match[1]);
  }
  return names;
}

const redactUrl = (value: string | null) => value === null ? null : stripUrlCredentials(value);

/** Redact page props without changing the full services used on the server. */
export function redactServiceForClient(service: Service): Service {
  const base = {
    ...service,
    environmentVariableCount: service.environmentVariableCount ?? variableCount(service.env),
    env: null,
    dockerImage: redactUrl(service.dockerImage),
  };
  if (base.kind === "compose") {
    return {
      ...base,
      composeFile: null,
      serviceNames: composeServiceNames(base.composeFile),
      hasPostgres: /^[ \t]*image:[ \t]*["']?[^\n#"']*postgres/im.test(base.composeFile ?? ""),
    };
  }
  if (base.kind === "application") {
    return {
      ...base,
      description: null,
      webhookUrl: null,
      hasWebhook: Boolean(base.webhookUrl),
      repository: redactUrl(base.repository),
      gitUrl: redactUrl(base.gitUrl),
      registryUrl: redactUrl(base.registryUrl),
      redirects: base.redirects.map((redirect) => ({
        ...redirect,
        replacement: stripUrlCredentials(redirect.replacement),
      })),
      command: null,
      healthCheckSwarm: null,
    };
  }
  // Database commands have no client editor. databasePassword is handled by #134.
  return { ...base, command: null };
}
