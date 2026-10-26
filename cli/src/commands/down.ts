import { loadConfig, saveConfig } from "../core/config.js";
import { CONTROL_PLANE_RESET_NOTICE, CONTROL_PLANE_STOP_NOTICE } from "../core/control-plane.js";
import { docker, probeDocker } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { LOCAL_INGRESS_CONTAINER } from "../core/local-ingress.js";
import { askConfirm, p, pc } from "../core/prompts.js";
import { CONTAINER_NAME } from "../core/switchyard-container.js";
import { platformFor } from "../platform/index.js";
import { CLI_VERSION } from "../version.js";

export interface DownFlags {
  purge?: boolean;
  yes?: boolean;
}

export async function downCommand(flags: DownFlags): Promise<void> {
  p.intro(pc.bold(`switchyard v${CLI_VERSION} — down${flags.purge ? " --purge" : ""}`));
  const { config: cfg, path } = loadConfig();
  p.log.warn(flags.purge ? CONTROL_PLANE_RESET_NOTICE : CONTROL_PLANE_STOP_NOTICE);

  if (!flags.yes && process.stdin.isTTY) {
    const message = flags.purge
      ? "Delete control-plane data? Deployed workloads and their volumes will be left orphaned."
      : "Stop the control plane? Deployed workloads keep running; data volumes survive.";
    if (!(await askConfirm({ message, initialValue: !flags.purge }))) {
      p.cancel("Nothing changed.");
      return;
    }
  } else if (flags.purge && !flags.yes) {
    throw new UserError("--purge without a TTY requires --yes to confirm deleting control-plane data.");
  }

  if ((await probeDocker()).availability !== "ok") {
    throw new UserError("Docker isn't reachable — nothing to stop (start Docker and re-run if the stack exists).");
  }

  if (cfg.platform === "linux") {
    p.log.step("Removing the Switchyard container ...");
    await docker(["rm", "-f", CONTAINER_NAME]); // tolerate absence
    await docker(["rm", "-f", LOCAL_INGRESS_CONTAINER]); // opt-in local ingress, if it was running
  }

  const platform = platformFor(cfg.platform);
  await platform.downDokploy({ purge: !!flags.purge }, (m) => p.log.step(m));

  if (flags.purge) {
    // The admin account died with the postgres volume; stale creds would
    // send the next `up` down the wrong path.
    cfg.adminEmail = "";
    cfg.adminPassword = "";
    // The metrics-store volume is gone too; drop its password so the next `up`
    // regenerates one that matches a fresh store.
    cfg.storePassword = "";
    saveConfig(cfg, path);
    p.log.info("Cleared the stored admin credentials (the account was deleted with the data).");
  }

  p.outro(flags.purge
    ? "Control plane removed. Workloads and their volumes remain; their Dokploy metadata is gone."
    : "Control plane stopped. Workloads keep running; `switchyard up` restores management.");
}
