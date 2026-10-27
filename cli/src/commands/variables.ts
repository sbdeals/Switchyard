import { Command } from "commander";

import { loadConfig } from "../core/config.js";
import { UserError } from "../core/errors.js";
import { resolveApplication } from "../core/link.js";
import { connectDeployClient, type DeployClient } from "./deploy.js";

export interface VariablesFlags {
  service?: string;
  reveal?: boolean;
  deploy?: boolean;
}

interface Assignment {
  key: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  comment: string;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUOTED_VALUE = /^(?:"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|`(?:\\`|[^`])*`)(?=[ \t]*(?:#[^\r\n]*)?(?:\r\n|\r|\n|$))/;

export function createVariablesCommand(
  action: (action: string, values: string[], flags: VariablesFlags) => Promise<void> = variablesCommand,
): Command {
  return new Command("variables")
    .description("List or edit an application's environment variables")
    .argument("[action]", "list, set, or unset", "list")
    .argument("[values...]", "KEY=VALUE pairs for set, or keys for unset")
    .option("--service <name>", "application name or ID (default: linked service)")
    .option("--reveal", "show variable values when listing")
    .option("--deploy", "redeploy after saving variables")
    .action(action);
}

export async function variablesCommand(action: string, values: string[], flags: VariablesFlags): Promise<void> {
  const { config } = loadConfig();
  await variables(action, values, flags, await connectDeployClient(config));
}

function lineBoundary(env: string, start: number): { lineEnd: number; end: number } {
  const offset = env.slice(start).search(/[\r\n]/);
  const lineEnd = offset < 0 ? env.length : start + offset;
  const end = lineEnd < env.length ? lineEnd + (env.startsWith("\r\n", lineEnd) ? 2 : 1) : lineEnd;
  return { lineEnd, end };
}

/** Keep offsets into the original text so edits never reformat unrelated lines. */
function assignments(env: string): Assignment[] {
  const result: Assignment[] = [];
  let start = 0;
  while (start < env.length) {
    let { lineEnd, end } = lineBoundary(env, start);
    // Existing dotenv keys are broader than the portable names accepted by set.
    const match = /^[ \t\uFEFF]*(?:export[ \t]+)?([\w.-]+)(?:[ \t]*=[ \t]*|:[ \t]+)/.exec(env.slice(start, lineEnd));
    if (!match) {
      start = end;
      continue;
    }
    const assignmentStart = start === 0 && env.startsWith("\uFEFF") ? start + 1 : start;
    const valueStart = start + match[0].length;
    let valueEnd: number;
    const quote = env[valueStart];
    if (quote === '"' || quote === "'" || quote === "`") {
      const quoted = QUOTED_VALUE.exec(env.slice(valueStart));
      if (!quoted) throw new UserError("The application's environment contains an invalid or unterminated quoted value. Fix it in the dashboard before editing variables.");
      valueEnd = valueStart + quoted[0].length;
      ({ lineEnd, end } = lineBoundary(env, valueEnd));
    } else {
      const hash = env.indexOf("#", valueStart);
      valueEnd = hash >= 0 && hash < lineEnd ? hash : lineEnd;
      while (valueEnd > valueStart && /[ \t\r]/.test(env[valueEnd - 1]!)) valueEnd--;
    }
    const commentStart = env.indexOf("#", valueEnd);
    const comment = commentStart >= 0 && commentStart < lineEnd
      ? env.slice(assignmentStart, valueStart).match(/^[ \t]*/)![0] + env.slice(commentStart, end)
      : "";
    result.push({ key: match[1]!, start: assignmentStart, end, valueStart, valueEnd, comment });
    start = end;
  }
  return result;
}

function encodeValue(value: string): string {
  if (value.includes("\0")) throw new UserError("Variable values must not contain a NUL character.");
  if (value === "" || (!/[#\r\n]/.test(value) && value.trim() === value && !/^["'`]/.test(value))) return value;
  // A backslash before the closing quote can absorb following dotenv assignments.
  if (value.endsWith("\\")) throw new UserError("A variable value requiring quotes must not end in a backslash; dotenv can interpret it as an escaped closing quote.");
  // Single quotes and backticks preserve backslashes literally in dotenv.
  for (const quote of ["'", "`", '"']) {
    if (!value.includes(quote) && !(quote === '"' && /\\[nr]/.test(value))) return quote + value + quote;
  }
  throw new UserError("A variable value cannot be safely quoted as dotenv. Remove one kind of quote character from that value.");
}

export async function variables(
  action: string,
  values: string[],
  flags: VariablesFlags,
  client: Pick<DeployClient, "request">,
  options: { log?: (message: string) => void; directory?: string } = {},
): Promise<void> {
  const log = options.log ?? console.log;
  if (!["list", "set", "unset"].includes(action)) throw new UserError("Variables action must be list, set, or unset.");
  if (action === "list" && (values.length > 0 || flags.deploy)) throw new UserError("variables list accepts no values or --deploy flag.");
  if (action !== "list" && (values.length === 0 || flags.reveal)) throw new UserError("variables set/unset needs at least one value/key and does not accept --reveal.");
  const updates = new Map<string, string>();
  for (const value of values) {
    const equals = value.indexOf("=");
    const key = action === "set" ? value.slice(0, equals < 0 ? value.length : equals) : value;
    if (!KEY.test(key) || (action === "set" && equals < 0)) {
      throw new UserError("Use KEY=VALUE for set or KEY for unset; keys must contain only letters, digits, and underscores and must not start with a digit.");
    }
    updates.set(key, action === "set" ? encodeValue(value.slice(equals + 1)) : "");
  }

  const safeClient: Pick<DeployClient, "request"> = {
    async request<T>(path: string): Promise<T> {
      try {
        return await client.request<T>(path);
      } catch {
        throw new UserError("Could not resolve the service from Dokploy. Check the platform and try again.");
      }
    },
  };
  const { applicationId } = await resolveApplication(safeClient, flags.service, options.directory);
  let env: string;
  try {
    const application = await client.request<{ env?: string | null }>(`application.one?applicationId=${encodeURIComponent(applicationId)}`);
    env = application.env ?? "";
  } catch {
    // API errors can contain the response body, including environment values.
    throw new UserError("Could not read variables from Dokploy. Check the platform and try again.");
  }
  const entries = assignments(env);
  if (action === "list") {
    const listed = new Map(entries.map((entry) => [entry.key, env.slice(entry.valueStart, entry.valueEnd)]));
    for (const [key, value] of listed) log(`${key}=${flags.reveal ? value : "********"}`);
    if (listed.size === 0) log("No variables configured.");
    return;
  }

  const present = new Set(entries.map((entry) => entry.key));
  // Work backwards so replacing a multiline value cannot invalidate offsets.
  for (const entry of entries.reverse()) {
    if (!updates.has(entry.key)) continue;
    env = action === "set"
      ? env.slice(0, entry.valueStart) + updates.get(entry.key)! + env.slice(entry.valueEnd)
      : env.slice(0, entry.start) + entry.comment + env.slice(entry.end);
  }
  if (action === "set") {
    const newline = env.match(/\r\n|\r|\n/)?.[0] ?? "\n";
    for (const [key, value] of updates) {
      if (present.has(key)) continue;
      if (env && !/[\r\n]$/.test(env)) env += newline;
      env += `${key}=${value}${newline}`;
    }
  }
  try {
    await client.request("application.update", { method: "POST", body: { applicationId, env } });
  } catch {
    throw new UserError("Could not save variables to Dokploy. Check the platform and try again.");
  }
  if (flags.deploy) {
    try {
      await client.request("application.deploy", { method: "POST", body: { applicationId } });
    } catch {
      throw new UserError("Variables saved, but deployment could not be queued; redeploy to apply.");
    }
    log("Variables saved; deployment queued.");
  } else {
    log("Variables saved; redeploy to apply.");
  }
}
