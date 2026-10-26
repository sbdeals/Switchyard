import type { Engine } from "./dokploy";

/** Only settings mutations are allowed in a staged deployment. */
export const STAGED_ACTION_ORDER = {
  setAppDockerSourceAction: 10,
  updateGitDeployAction: 10,
  saveComposeFileAction: 10,
  saveAppBuildTypeAction: 20,
  updateApplicationAction: 30,
  updateDatabaseAction: 30,
  saveApplicationEnvAction: 40,
  saveComposeEnvAction: 40,
  saveEnvironmentAction: 40,
  deleteDomainAction: 50,
  deleteRedirectAction: 50,
  deletePortAction: 50,
  deleteSecurityAction: 50,
  updateDomainAction: 51,
  createDomainAction: 52,
  createComposeDomainAction: 52,
  createRedirectAction: 52,
  createPortAction: 52,
  createSecurityAction: 52,
  removeMountAction: 60,
  updateMountAction: 61,
  createMountAction: 62,
} as const;

export type StagedAction = keyof typeof STAGED_ACTION_ORDER;
export type StagedTarget = {
  kind: "application" | "compose" | "database";
  id: string;
  engine?: Engine;
  appName?: string;
  networkingChanged?: boolean;
};

export type StagedStepResult =
  | { ok: true }
  | { ok: false; error: string; appliedSteps?: string[]; failedStep?: string };

export type StagedApplyReport = {
  ok: boolean;
  applied: string[];
  failed?: { id: string; error: string; appliedSteps?: string[]; failedStep?: string };
  skipped: string[];
  deploy: "skipped" | "succeeded" | "failed";
  error?: string;
};

export type ApplyOperation = { id: string; action: StagedAction };

/** Stop on the first failed mutation; never deploy a partly applied batch. */
export async function applyStagedOperations<T extends ApplyOperation>(
  operations: T[],
  apply: (operation: T) => Promise<StagedStepResult>,
  deploy: () => Promise<StagedStepResult>,
  rethrow: (error: unknown) => void = () => {}
): Promise<StagedApplyReport> {
  const ordered = [...operations].sort(
    (a, b) => STAGED_ACTION_ORDER[a.action] - STAGED_ACTION_ORDER[b.action]
  );
  const applied: string[] = [];
  const attempt = async (run: () => Promise<StagedStepResult>): Promise<StagedStepResult> => {
    try {
      return await run();
    } catch (error) {
      rethrow(error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  for (const [index, operation] of ordered.entries()) {
    const result = await attempt(() => apply(operation));
    if (!result.ok) {
      return {
        ok: false,
        applied,
        failed: {
          id: operation.id, error: result.error,
          ...(result.appliedSteps ? { appliedSteps: result.appliedSteps } : {}),
          ...(result.failedStep ? { failedStep: result.failedStep } : {}),
        },
        skipped: ordered.slice(index + 1).map((op) => op.id),
        deploy: "skipped",
      };
    }
    applied.push(operation.id);
  }
  const result = await attempt(deploy);
  return result.ok
    ? { ok: true, applied, skipped: [], deploy: "succeeded" }
    : { ok: false, applied, skipped: [], deploy: "failed", error: result.error };
}
