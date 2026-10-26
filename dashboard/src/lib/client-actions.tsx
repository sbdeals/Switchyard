"use client";

import { useSyncExternalStore } from "react";
import * as serverActions from "@/app/actions";
import { logoutAction as serverLogoutAction } from "@/app/login/actions";
import { callAction, SESSION_EXPIRED_MESSAGE, signInHref } from "@/lib/action-call";
import { useDialogFocus } from "@/components/use-focus-trap";

export type { ActionResult, MountsResult } from "@/app/actions";

let sessionExpired = false;
const listeners = new Set<() => void>();

function setSessionExpired(value: boolean) {
  sessionExpired = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One boundary for every workspace action, including reads. */
function guardAction<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>) {
  return async (...args: Args) => {
    const result = await callAction(() => action(...args), () => setSessionExpired(true));
    if (result && typeof result === "object" && "ok" in result && result.ok) setSessionExpired(false);
    return result;
  };
}

export function SessionExpiredBanner() {
  const expired = useSyncExternalStore(subscribe, () => sessionExpired, () => false);
  const dialogRef = useDialogFocus<HTMLDivElement>(() => setSessionExpired(false));
  if (!expired) return null;
  const { pathname, search, hash } = window.location;

  // Sign in separately to keep editors mounted without copying variable values
  // (which may be credentials) into browser storage. Join the dialog focus stack
  // so the link is reachable even when a drawer or deploy modal is open.
  return (
    <div ref={dialogRef} role="alertdialog" aria-label="Session expired" aria-modal="true" className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-lg rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-bg-elevated)] p-4 shadow-xl">
      <p className="text-sm font-medium">{SESSION_EXPIRED_MESSAGE}</p>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
        Keep this tab open to preserve your edits. Sign in in a new tab, then return here and retry.
      </p>
      <div className="mt-3 flex items-center gap-4 text-xs">
        <a data-autofocus href={signInHref(pathname + search + hash)} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--color-brand)] underline">
          Sign in <span className="sr-only">(opens in a new tab)</span>
        </a>
        <button type="button" onClick={() => setSessionExpired(false)} className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
          Dismiss
        </button>
      </div>
    </div>
  );
}

// Keep callers' argument and result types while routing all calls through the
// same recovery path. Import workspace actions from this module on the client.
export const quickDeployDatabaseAction = guardAction(serverActions.quickDeployDatabaseAction);
export const lifecycleAction = guardAction(serverActions.lifecycleAction);
export const updateDatabaseAction = guardAction(serverActions.updateDatabaseAction);
export const saveEnvironmentAction = guardAction(serverActions.saveEnvironmentAction);
export const createProjectAction = guardAction(serverActions.createProjectAction);
export const renameProjectAction = guardAction(serverActions.renameProjectAction);
export const removeProjectAction = guardAction(serverActions.removeProjectAction);
export const createEnvironmentAction = guardAction(serverActions.createEnvironmentAction);
export const renameEnvironmentAction = guardAction(serverActions.renameEnvironmentAction);
export const removeEnvironmentAction = guardAction(serverActions.removeEnvironmentAction);
export const quickDeployImageAction = guardAction(serverActions.quickDeployImageAction);
export const quickDeployRepoAction = guardAction(serverActions.quickDeployRepoAction);
export const githubConnectionsAction = guardAction(serverActions.githubConnectionsAction);
export const githubRepositoriesAction = guardAction(serverActions.githubRepositoriesAction);
export const githubBranchesAction = guardAction(serverActions.githubBranchesAction);
export const quickDeployGithubAction = guardAction(serverActions.quickDeployGithubAction);
export const appLifecycleAction = guardAction(serverActions.appLifecycleAction);
export const updateApplicationAction = guardAction(serverActions.updateApplicationAction);
export const saveApplicationEnvAction = guardAction(serverActions.saveApplicationEnvAction);
export const saveAppBuildTypeAction = guardAction(serverActions.saveAppBuildTypeAction);
export const setAppDockerSourceAction = guardAction(serverActions.setAppDockerSourceAction);
export const createDomainAction = guardAction(serverActions.createDomainAction);
export const updateDomainAction = guardAction(serverActions.updateDomainAction);
export const deleteDomainAction = guardAction(serverActions.deleteDomainAction);
export const generateDomainAction = guardAction(serverActions.generateDomainAction);
export const createComposeDomainAction = guardAction(serverActions.createComposeDomainAction);
export const generateComposeDomainAction = guardAction(serverActions.generateComposeDomainAction);
export const createRedirectAction = guardAction(serverActions.createRedirectAction);
export const deleteRedirectAction = guardAction(serverActions.deleteRedirectAction);
export const createPortAction = guardAction(serverActions.createPortAction);
export const deletePortAction = guardAction(serverActions.deletePortAction);
export const createSecurityAction = guardAction(serverActions.createSecurityAction);
export const deleteSecurityAction = guardAction(serverActions.deleteSecurityAction);
export const updateGitDeployAction = guardAction(serverActions.updateGitDeployAction);
export const rollbackDeploymentAction = guardAction(serverActions.rollbackDeploymentAction);
export const listSchedulesAction = guardAction(serverActions.listSchedulesAction);
export const createScheduleAction = guardAction(serverActions.createScheduleAction);
export const updateScheduleAction = guardAction(serverActions.updateScheduleAction);
export const deleteScheduleAction = guardAction(serverActions.deleteScheduleAction);
export const runScheduleAction = guardAction(serverActions.runScheduleAction);
export const createComposeAction = guardAction(serverActions.createComposeAction);
export const composeLifecycleAction = guardAction(serverActions.composeLifecycleAction);
export const saveComposeFileAction = guardAction(serverActions.saveComposeFileAction);
export const saveComposeEnvAction = guardAction(serverActions.saveComposeEnvAction);
export const listDestinationsAction = guardAction(serverActions.listDestinationsAction);
export const testDestinationAction = guardAction(serverActions.testDestinationAction);
export const createDestinationAction = guardAction(serverActions.createDestinationAction);
export const removeDestinationAction = guardAction(serverActions.removeDestinationAction);
export const listDatabaseBackupsAction = guardAction(serverActions.listDatabaseBackupsAction);
export const createDatabaseBackupAction = guardAction(serverActions.createDatabaseBackupAction);
export const updateDatabaseBackupAction = guardAction(serverActions.updateDatabaseBackupAction);
export const removeDatabaseBackupAction = guardAction(serverActions.removeDatabaseBackupAction);
export const runDatabaseBackupAction = guardAction(serverActions.runDatabaseBackupAction);
export const listBackupFilesAction = guardAction(serverActions.listBackupFilesAction);
export const restoreBackupAction = guardAction(serverActions.restoreBackupAction);
export const listTemplatesAction = guardAction(serverActions.listTemplatesAction);
export const quickDeployTemplateAction = guardAction(serverActions.quickDeployTemplateAction);
export const listMountsAction = guardAction(serverActions.listMountsAction);
export const createMountAction = guardAction(serverActions.createMountAction);
export const updateMountAction = guardAction(serverActions.updateMountAction);
export const removeMountAction = guardAction(serverActions.removeMountAction);

/** Sign-out always leaves the workspace, even if the session is already gone. */
export async function logoutAction(): Promise<void> {
  setSessionExpired(false);
  try {
    await serverLogoutAction();
  } catch {
    // A proxy rejection, network failure or Next redirect must still leave.
  }
  window.location.assign("/login");
}
