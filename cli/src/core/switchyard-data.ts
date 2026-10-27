import { docker } from "./docker.js";
import { UserError } from "./errors.js";

export const DATA_VOLUME_NAME = "switchyard-data";

/** Both launchers keep dashboard data on stop and verify its removal on purge. */
export async function removeSwitchyardDataVolume(
  purge: boolean,
  log: (message: string) => void,
  runDocker: typeof docker = docker,
): Promise<void> {
  if (!purge) return;

  log(`Removing dashboard data volume ${DATA_VOLUME_NAME} ...`);
  await runDocker(["volume", "rm", DATA_VOLUME_NAME]);
  // A failed removal can mean "already absent" or "still in use". Verify
  // absence before callers clear credentials or report a fresh slate.
  const remaining = await runDocker(["volume", "inspect", DATA_VOLUME_NAME]);
  if (remaining.code !== 0 && /no such volume|\bvolume switchyard-data not found\s*$/i.test(remaining.stderr)) return;

  throw new UserError(
    remaining.code === 0
      ? `Purge incomplete: dashboard data volume ${DATA_VOLUME_NAME} still exists. ` +
          "Remove any containers using it, then re-run `switchyard down --purge --yes`."
      : `Purge incomplete: could not verify removal of dashboard data volume ${DATA_VOLUME_NAME}. ` +
          "Check Docker, then re-run `switchyard down --purge --yes`.",
  );
}
