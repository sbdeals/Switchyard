import { dump, load } from "js-yaml";
import type { HealthCheckSwarm } from "./dokploy";

export interface DeployCheckInput {
  healthcheckPath: string;
  healthcheckTimeout: number;
  healthcheckPort: number;
  preDeployCommand: string;
  serviceName?: string;
}

export const DEFAULT_DEPLOY_CHECKS: DeployCheckInput = {
  healthcheckPath: "",
  healthcheckTimeout: 60,
  healthcheckPort: 3000,
  preDeployCommand: "",
};

const METADATA = "x-switchyard-deploy-checks";
export const PREDEPLOY_SERVICE = "sy-predeploy";
type Mapping = Record<string, unknown>;

function isMapping(value: unknown): value is Mapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateDeployChecks(input: DeployCheckInput): DeployCheckInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Deploy-check settings must be an object.");
  }
  if (typeof input.healthcheckPath !== "string" || typeof input.preDeployCommand !== "string") {
    throw new Error("Healthcheck path and pre-deploy command must be text.");
  }
  const healthcheckPath = input.healthcheckPath.trim();
  const preDeployCommand = input.preDeployCommand.trim();
  if (healthcheckPath && (!healthcheckPath.startsWith("/") || healthcheckPath.startsWith("//") ||
    /[^\x21-\x7e]|[\\#]/.test(healthcheckPath) || healthcheckPath.length > 2048)) {
    throw new Error("Healthcheck path must start with / and contain no spaces, fragment, or backslash (maximum 2048 characters).");
  }
  if (!Number.isInteger(input.healthcheckTimeout) || input.healthcheckTimeout < 5 || input.healthcheckTimeout > 600) {
    throw new Error("Healthcheck timeout must be a whole number between 5 and 600 seconds.");
  }
  if (!Number.isInteger(input.healthcheckPort) || input.healthcheckPort < 1 || input.healthcheckPort > 65535) {
    throw new Error("Healthcheck port must be a whole number between 1 and 65535.");
  }
  if (preDeployCommand.length > 4096 || preDeployCommand.includes("\0")) {
    throw new Error("Pre-deploy command must contain no NUL characters and be at most 4096 characters.");
  }
  if (input.serviceName !== undefined && (typeof input.serviceName !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(input.serviceName))) {
    throw new Error("Invalid Compose service name.");
  }
  return { ...input, healthcheckPath, preDeployCommand };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function probe(input: DeployCheckInput): string {
  const url = `http://127.0.0.1:${input.healthcheckPort}${input.healthcheckPath}`;
  // curl's -f accepts redirects, so explicitly require a 2xx response instead.
  return `status=$(curl --disable --noproxy '*' --globoff --silent --output /dev/null --write-out '%{http_code}' --max-time 1 --url ${shellQuote(url)}) && case "$status" in 2[0-9][0-9]) exit 0;; *) exit 1;; esac`;
}

export function mapApplicationChecks(input: DeployCheckInput): { healthCheckSwarm: HealthCheckSwarm | null } {
  const settings = validateDeployChecks(input);
  if (settings.preDeployCommand) {
    throw new Error("Application pre-deploy commands are not supported by Dokploy v0.30.10. Use a raw Compose service.");
  }
  return {
    healthCheckSwarm: settings.healthcheckPath ? {
      Test: ["CMD-SHELL", probe(settings)],
      Interval: 1_000_000_000,
      Timeout: 1_000_000_000,
      StartPeriod: 0,
      Retries: settings.healthcheckTimeout,
    } : null,
  };
}

export function readApplicationChecks(healthcheck: HealthCheckSwarm | null | undefined): DeployCheckInput | null {
  if (!healthcheck) return { ...DEFAULT_DEPLOY_CHECKS };
  const command = healthcheck.Test?.[1];
  if (!command) return null;
  const match = command.match(/--max-time 1 --url 'http:\/\/127\.0\.0\.1:(\d+)(.*)'\) && case/);
  if (!match) return null;
  try {
    const settings = validateDeployChecks({
      ...DEFAULT_DEPLOY_CHECKS,
      healthcheckPath: match[2].replace(/'\\''/g, "'"),
      healthcheckPort: Number(match[1]),
      healthcheckTimeout: healthcheck.Retries ?? 0,
    });
    return equal(healthcheck, mapApplicationChecks(settings).healthCheckSwarm) ? settings : null;
  } catch {
    return null;
  }
}

function parseCompose(file: string): Mapping & { services: Mapping } {
  let document: unknown;
  try {
    document = load(file);
  } catch {
    throw new Error("Compose YAML could not be parsed.");
  }
  if (!isMapping(document) || !isMapping(document.services)) {
    throw new Error("Compose YAML must contain a services mapping.");
  }
  if (Object.hasOwn(document, "include")) {
    throw new Error("Deploy checks do not support Compose include files.");
  }
  return document as Mapping & { services: Mapping };
}

function equal(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (isMapping(left) && isMapping(right)) {
    return Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
  }
  return left === right;
}

function composeHealthcheck(settings: DeployCheckInput): Mapping {
  return {
    test: ["CMD-SHELL", probe(settings).replace(/\$/g, "$$$$")],
    interval: "1s",
    timeout: "1s",
    start_period: "0s",
    retries: settings.healthcheckTimeout,
  };
}

function preDeployService(service: Mapping, command: string): Mapping {
  // Copy runtime inputs, but never routing, published ports, the server's start
  // command, restart policy, or container identity into the one-shot job.
  const job: Mapping = {};
  for (const key of ["image", "build", "pull_policy", "platform", "environment", "env_file", "volumes",
    "networks", "working_dir", "user", "group_add", "secrets", "configs", "extra_hosts", "dns",
    "dns_search", "dns_opt", "init", "read_only", "tmpfs", "cap_add", "cap_drop", "security_opt", "ulimits"]) {
    if (Object.hasOwn(service, key)) job[key] = service[key];
  }
  return {
    ...job,
    entrypoint: ["/bin/sh", "-c"],
    command: [command.replace(/\$/g, "$$$$")],
    restart: "no",
    healthcheck: { disable: true },
  };
}

interface SavedChecks {
  settings: DeployCheckInput;
  originalCommand: string | null;
}

function savedChecks(document: Mapping & { services: Mapping }): SavedChecks | null {
  const metadata = document[METADATA];
  if (metadata === undefined) return null;
  if (!isMapping(metadata) || metadata.version !== 1 || !isMapping(metadata.settings) ||
    (metadata.originalCommand !== null && typeof metadata.originalCommand !== "string")) {
    throw new Error("Switchyard deploy-check metadata is invalid.");
  }
  const settings = validateDeployChecks(metadata.settings as unknown as DeployCheckInput);
  const service = settings.serviceName && document.services[settings.serviceName];
  if (!isMapping(service)) throw new Error("The configured Compose service no longer exists.");
  const expectedHealthcheck = settings.healthcheckPath ? composeHealthcheck(settings) : undefined;
  const expectedDependency = settings.preDeployCommand ? { [PREDEPLOY_SERVICE]: { condition: "service_completed_successfully" } } : undefined;
  const expectedJob = settings.preDeployCommand ? preDeployService(service, settings.preDeployCommand) : undefined;
  if (!equal(service.healthcheck, expectedHealthcheck) || !equal(service.depends_on, expectedDependency) ||
    !equal(document.services[PREDEPLOY_SERVICE], expectedJob)) {
    throw new Error("Compose deploy-check configuration was changed outside Settings. Restore it before editing these fields.");
  }
  return { settings, originalCommand: metadata.originalCommand as string | null };
}

export function readComposeChecks(file: string): DeployCheckInput | null {
  try {
    const document = parseCompose(file);
    return savedChecks(document)?.settings ?? null;
  } catch {
    return null;
  }
}

export function composeDeployChecksSupport(file: string, sourceType: string): { supported: boolean; reason?: string; serviceName?: string } {
  if (sourceType !== "raw") return { supported: false, reason: "Deploy checks require a raw Compose service." };
  try {
    const document = parseCompose(file);
    const saved = savedChecks(document);
    const names = Object.keys(document.services).filter((name) => saved && name === PREDEPLOY_SERVICE ? false : true);
    if (names.length !== 1 || names[0] === PREDEPLOY_SERVICE) {
      throw new Error("Deploy checks currently support one application service in raw Compose YAML.");
    }
    const service = document.services[names[0]];
    if (!isMapping(service) || (!service.image && !service.build)) throw new Error("The Compose service needs an image or build configuration.");
    if (service.profiles || service.extends || service.network_mode) {
      throw new Error("Deploy checks do not support Compose profiles, extends, or network_mode.");
    }
    if (!saved && (service.healthcheck !== undefined || service.depends_on !== undefined)) {
      throw new Error("This Compose service has a custom healthcheck or dependencies. Manage its checks in Compose YAML.");
    }
    return { supported: true, serviceName: names[0] };
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : "Unsupported Compose YAML." };
  }
}

function deployCommand(appName: string, timeout: number): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(appName)) throw new Error("Invalid Compose project name.");
  // Dokploy prepends `docker` and executes this from the compose directory.
  return `compose -p ${shellQuote(appName)} -f docker-compose.yml up -d --build --remove-orphans --force-recreate --wait --wait-timeout ${timeout}`;
}

export function mapComposeChecks(file: string, appName: string, existingCommand: string | null, input: DeployCheckInput): { composeFile: string; command: string | null } {
  const settings = validateDeployChecks(input);
  const support = composeDeployChecksSupport(file, "raw");
  if (!support.supported) throw new Error(support.reason);
  if (settings.serviceName && settings.serviceName !== support.serviceName) throw new Error("The selected Compose service does not match the YAML.");
  settings.serviceName = support.serviceName;
  const document = parseCompose(file);
  const saved = savedChecks(document);
  if (saved && existingCommand !== deployCommand(appName, saved.settings.healthcheckTimeout)) {
    throw new Error("The Compose deploy command was changed outside Settings. Restore it before editing these fields.");
  }
  if (!saved && existingCommand?.trim()) {
    throw new Error("Deploy checks cannot replace a custom Compose deploy command.");
  }
  const service = document.services[settings.serviceName!] as Mapping;
  delete service.healthcheck;
  delete service.depends_on;
  delete document.services[PREDEPLOY_SERVICE];
  delete document[METADATA];
  if (!settings.healthcheckPath && !settings.preDeployCommand) {
    return { composeFile: saved ? dump(document, { noRefs: true, lineWidth: -1 }) : file, command: saved ? saved.originalCommand : existingCommand };
  }
  if (settings.healthcheckPath) service.healthcheck = composeHealthcheck(settings);
  if (settings.preDeployCommand) {
    document.services[PREDEPLOY_SERVICE] = preDeployService(service, settings.preDeployCommand);
    service.depends_on = { [PREDEPLOY_SERVICE]: { condition: "service_completed_successfully" } };
  }
  document[METADATA] = { version: 1, settings, originalCommand: saved ? saved.originalCommand : existingCommand };
  return { composeFile: dump(document, { noRefs: true, lineWidth: -1 }), command: deployCommand(appName, settings.healthcheckTimeout) };
}
