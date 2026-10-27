import { loadConfig, saveConfig, STORE_VOLUME } from "../core/config.js";
import { docker, probeDocker } from "../core/docker.js";
import { UserError } from "../core/errors.js";
import { LOCAL_INGRESS_CONTAINER } from "../core/local-ingress.js";
import { askConfirm, p, pc } from "../core/prompts.js";
import { inspectPurgeResources } from "../core/purge.js";
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

  if (!flags.yes && process.stdin.isTTY) {
    const message = flags.purge
      ? "Stop the stack AND DELETE the network, secrets, and data volumes (Dokploy and dashboard data)?"
      : "Stop the Dokploy services and remove the Switchyard container? (Data volumes survive.)";
    if (!(await askConfirm({ message, initialValue: !flags.purge }))) {
      p.cancel("Nothing changed.");
      return;
    }
  } else if (flags.purge && !flags.yes) {
    throw new UserError("--purge without a TTY requires --yes to confirm deleting all data.");
  }

  if ((await probeDocker()).availability !== "ok") {
    throw new UserError("Docker isn't reachable — nothing to stop (start Docker and re-run if the stack exists).");
  }

  p.log.step("Removing the Switchyard container ...");
  await docker(["rm", "-f", CONTAINER_NAME]); // tolerate absence
  await docker(["rm", "-f", LOCAL_INGRESS_CONTAINER]); // opt-in local ingress, if it was running

  const platform = platformFor(cfg.platform);
  let failure: string | undefined;
  try {
    await platform.downDokploy({ purge: !!flags.purge }, (m) => p.log.step(m));
  } catch (e) {
    if (!flags.purge) throw e;
    failure = e instanceof Error ? e.message : String(e);
  }

  if (flags.purge) {
    // Even a failed purge can remove some data. Clear only credentials whose
    // volumes are confirmed gone; keep the rest for recovery or a retry.
    const result = await inspectPurgeResources();
    const adminRemoved = ["dokploy", "dokploy-postgres"].every((v) => result.removedVolumes.includes(v));
    const storeRemoved = result.removedVolumes.includes(STORE_VOLUME);
    if (adminRemoved) {
      cfg.adminEmail = "";
      cfg.adminPassword = "";
    }
    if (storeRemoved) cfg.storePassword = "";
    saveConfig(cfg, path);
    if (adminRemoved) p.log.info("Cleared the stored admin credentials (the account was deleted with the data).");
    if (storeRemoved) p.log.info("Cleared the stored metrics password (the metrics data was removed).");
    if (!adminRemoved || !storeRemoved) {
      p.log.info("Kept stored credentials for volumes still present or whose removal could not be verified.");
    }
    if (result.error || failure) {
      throw new UserError(result.error ?? `Purge incomplete: ${failure}\nRetry \`switchyard down --purge --yes\` after resolving the Docker errors.`);
    }
  }

  p.outro(flags.purge ? "Stack removed — a fresh slate." : "Stack stopped. Data volumes survive; `switchyard up` brings it back.");
}
