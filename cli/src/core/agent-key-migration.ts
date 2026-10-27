import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import { docker } from "./docker.js";
import { UserError } from "./errors.js";
import { DATA_VOLUME_NAME } from "./switchyard-data.js";

export interface AgentKeyContainer {
  Mounts: { Type: string; Name?: string; Destination: string }[];
  Config: { Env?: string[]; User?: string; WorkingDir?: string };
}

/** Null means the container already uses our durable data volume. */
export function agentKeyMigrationPath(container: AgentKeyContainer): string | null {
  if (container.Mounts.some((m) => m.Type === "volume" && m.Name === DATA_VOLUME_NAME && m.Destination === "/app/data")) {
    return null;
  }
  const env = new Map((container.Config.Env ?? []).map((pair) => {
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
  const override = env.get("SWITCHYARD_AGENT_KEY_FILE")?.trim();
  const home = env.get("HOME");
  // Released dashboard images run as root. For a custom user, don't guess a
  // home and silently treat its real settings as absent (stopped containers
  // cannot answer an `exec node ... os.homedir()` probe).
  if (!override && !home && !["", "root", "0"].includes((container.Config.User ?? "").split(":")[0]!)) {
    throw new Error("Cannot determine custom container user's home directory");
  }
  return posix.resolve(container.Config.WorkingDir || "/app", override || posix.join(home || "/root", ".switchyard/agent-key.json"));
}

// The helper receives the file only on stdin. Publish atomically without
// overwriting an existing volume copy (including retries after a failed swap).
const IMPORT_KEY = `
const fs = require('node:fs');
const target = '/app/data/agent-key.json';
const temporary = '/app/data/.agent-key-' + require('node:crypto').randomUUID();
try {
  const content = fs.readFileSync(0);
  fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
  try {
    fs.linkSync(temporary, target);
    process.stdout.write('migrated');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!fs.lstatSync(target).isFile()) throw new Error('Invalid existing settings file');
    if (!fs.readFileSync(target).equals(content)) throw new Error('Conflicting saved settings');
    process.stdout.write('existing');
  }
} catch {
  process.exitCode = 1;
} finally {
  try { fs.unlinkSync(temporary); } catch {}
}
`;

/** Call while the old container is stopped, and before removing it. */
export async function migrateAgentKey(
  containerName: string,
  sourcePath: string,
  image: string,
  log: (message: string) => void,
  runDocker: typeof docker = docker,
): Promise<void> {
  let temporary: string | undefined;
  try {
    // mkdtemp creates a private 0700 directory; chmod the copied file before
    // reading it, even if an older dashboard wrote overly broad permissions.
    temporary = mkdtempSync(join(tmpdir(), "switchyard-agent-key-"));
    const keyFile = join(temporary, "agent-key.json");
    const copied = await runDocker(["cp", `${containerName}:${sourcePath}`, keyFile]);
    if (copied.code !== 0) {
      // Docker reports a missing source distinctly. Daemon/permission errors
      // are NOT evidence that no settings exist, and must preserve the old container.
      if (/Could not find the file .+ in container /i.test(copied.stderr)) return;
      throw new Error("Could not copy legacy settings");
    }
    if (!lstatSync(keyFile).isFile()) throw new Error("Legacy settings are not a regular file");
    chmodSync(keyFile, 0o600);
    const imported = await runDocker([
      "run", "--rm", "-i", "--network", "none",
      "-v", `${DATA_VOLUME_NAME}:/app/data`,
      "--entrypoint", "node", image, "-e", IMPORT_KEY,
    ], { input: readFileSync(keyFile, "utf8") });
    if (imported.code !== 0 || !["migrated", "existing"].includes(imported.stdout)) {
      throw new Error("Could not import legacy settings");
    }
    log(imported.stdout === "migrated"
      ? "Migrated saved agent settings into switchyard-data."
      : "Identical agent settings already exist in switchyard-data.");
  } catch {
    // Never echo Docker/helper output or file contents: both may hold secrets.
    throw new UserError(
      "Agent settings migration failed; the existing Switchyard container has not been removed. " +
      "Check Docker, available disk space, and conflicting settings in switchyard-data, then retry. " +
      "Back up the old agent-key.json before any manual removal.",
    );
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}
