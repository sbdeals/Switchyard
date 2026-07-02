import { dockerInherit } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { CONTAINER_NAME } from "../core/switchyard-container.js";

export interface LogsFlags {
  follow?: boolean;
}

export async function logsCommand(target: string, flags: LogsFlags): Promise<void> {
  const follow = flags.follow ? ["--follow"] : [];
  let code: number;
  if (target === "switchyard") {
    code = await dockerInherit(["logs", ...follow, "--tail", "200", CONTAINER_NAME]);
  } else if (target === "dokploy") {
    code = await dockerInherit(["service", "logs", ...follow, "--tail", "200", "dokploy"]);
  } else {
    throw new UserError(`Unknown logs target: ${target} (expected switchyard|dokploy)`);
  }
  process.exitCode = code;
}
