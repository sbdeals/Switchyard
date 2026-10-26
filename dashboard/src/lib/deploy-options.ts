export const DEPLOY_TITLE_MAX_LENGTH = 120;
export const DEPLOY_DESCRIPTION_MAX_LENGTH = 2000;

export type DeployOptionsRequest =
  | { kind: "deploy" }
  | { kind: "redeploy" }
  | { kind: "message"; title: string; description: string }
  | { kind: "clean-cache"; enabled: boolean };

type DeployOptionsPayload =
  | {
      procedure: "application.deploy" | "application.redeploy";
      body: { applicationId: string; title?: string; description?: string };
    }
  | {
      procedure: "application.update";
      body: { applicationId: string; cleanCache: boolean };
    };

export function buildDeployOptionsPayload(
  applicationId: string,
  input: DeployOptionsRequest,
): DeployOptionsPayload {
  if (typeof applicationId !== "string" || !applicationId.trim()) {
    throw new Error("Invalid deploy options");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid deploy options");
  }

  switch (input.kind) {
    case "deploy":
      return { procedure: "application.deploy", body: { applicationId } };
    case "redeploy":
      return { procedure: "application.redeploy", body: { applicationId } };
    case "message": {
      if (typeof input.title !== "string" || typeof input.description !== "string") {
        throw new Error("Invalid deploy options");
      }
      const title = input.title.trim();
      const description = input.description.trim();
      if (!title || title.length > DEPLOY_TITLE_MAX_LENGTH || description.length > DEPLOY_DESCRIPTION_MAX_LENGTH) {
        throw new Error("Invalid deploy options");
      }
      return {
        procedure: "application.redeploy",
        body: { applicationId, title, ...(description ? { description } : {}) },
      };
    }
    case "clean-cache":
      if (typeof input.enabled !== "boolean") {
        throw new Error("Invalid deploy options");
      }
      // Dokploy reads this persistent setting when its queued build starts.
      return {
        procedure: "application.update",
        body: { applicationId, cleanCache: input.enabled },
      };
    default:
      throw new Error("Invalid deploy options");
  }
}

export function getDeployOptionsState({ pending, status, sourceType }: {
  pending: boolean;
  status: "idle" | "running" | "done" | "error";
  sourceType: string | null;
}): { deployDisabled: boolean; redeployDisabled: boolean; cacheDisabled: boolean } {
  const deployDisabled = pending || status === "running";
  return {
    deployDisabled,
    redeployDisabled: deployDisabled || status === "idle",
    cacheDisabled: deployDisabled || sourceType === "docker" || sourceType === null,
  };
}
