import { describe, expect, it } from "vitest";
import {
  buildDeployOptionsPayload,
  DEPLOY_DESCRIPTION_MAX_LENGTH,
  DEPLOY_TITLE_MAX_LENGTH,
  getDeployOptionsState,
  type DeployOptionsRequest,
} from "./deploy-options";

describe("buildDeployOptionsPayload", () => {
  it("deploys a new application without changing build settings", () => {
    expect(buildDeployOptionsPayload("app-1", { kind: "deploy" })).toEqual({
      procedure: "application.deploy",
      body: { applicationId: "app-1" },
    });
  });

  it("redeploys without changing build settings", () => {
    expect(buildDeployOptionsPayload("app-1", { kind: "redeploy" })).toEqual({
      procedure: "application.redeploy",
      body: { applicationId: "app-1" },
    });
  });

  it("trims the custom title and description", () => {
    expect(buildDeployOptionsPayload("app-1", {
      kind: "message",
      title: "  Release update  ",
      description: "\nRefresh the welcome page.\n",
    })).toEqual({
      procedure: "application.redeploy",
      body: {
        applicationId: "app-1",
        title: "Release update",
        description: "Refresh the welcome page.",
      },
    });
  });

  it("omits an empty description", () => {
    expect(buildDeployOptionsPayload("app-1", {
      kind: "message", title: "Release", description: " \n ",
    })).toEqual({
      procedure: "application.redeploy",
      body: { applicationId: "app-1", title: "Release" },
    });
  });

  it.each([true, false])("only updates the persistent cache setting to %s", (enabled) => {
    expect(buildDeployOptionsPayload("app-1", { kind: "clean-cache", enabled })).toEqual({
      procedure: "application.update",
      body: { applicationId: "app-1", cleanCache: enabled },
    });
  });

  it("accepts the message length limits after trimming", () => {
    const title = "t".repeat(DEPLOY_TITLE_MAX_LENGTH);
    const description = "d".repeat(DEPLOY_DESCRIPTION_MAX_LENGTH);
    expect(buildDeployOptionsPayload("app-1", {
      kind: "message", title: ` ${title} `, description: ` ${description} `,
    })).toEqual({
      procedure: "application.redeploy",
      body: { applicationId: "app-1", title, description },
    });
  });

  it.each([
    null,
    undefined,
    false,
    "redeploy",
    [],
    {},
    { kind: "unknown" },
    { kind: "message", title: "", description: "" },
    { kind: "message", title: " \n ", description: "" },
    { kind: "message", title: 123, description: "" },
    { kind: "message", title: "Release", description: null },
    { kind: "message", title: "Release" },
    { kind: "message", title: "t".repeat(DEPLOY_TITLE_MAX_LENGTH + 1), description: "" },
    { kind: "message", title: "Release", description: "d".repeat(DEPLOY_DESCRIPTION_MAX_LENGTH + 1) },
    { kind: "clean-cache", enabled: "true" },
    { kind: "clean-cache", enabled: null },
    { kind: "clean-cache" },
  ])("rejects invalid runtime input %#", (input) => {
    expect(() => buildDeployOptionsPayload("app-1", input as DeployOptionsRequest)).toThrow("Invalid deploy options");
  });

  it.each(["", " \n ", null, undefined, 123])("rejects an invalid application ID %#", (applicationId) => {
    expect(() => buildDeployOptionsPayload(applicationId as string, { kind: "redeploy" })).toThrow("Invalid deploy options");
  });

  it.each([
    { kind: "deploy", title: "unexpected", cleanCache: true },
    { kind: "redeploy", title: "unexpected", cleanCache: true },
    { kind: "message", title: "Release", description: "", cleanCache: true },
    { kind: "clean-cache", enabled: true, title: "unexpected" },
  ])("does not forward extra fields %#", (input) => {
    const result = buildDeployOptionsPayload("app-1", { ...input, applicationId: "other-app", unexpected: true } as unknown as DeployOptionsRequest);
    expect(result.body.applicationId).toBe("app-1");
    expect(result.body).not.toHaveProperty("unexpected");
    if (result.procedure !== "application.update") {
      expect(result.body).not.toHaveProperty("cleanCache");
      if (input.kind !== "message") expect(result.body).not.toHaveProperty("title");
    } else {
      expect(result.body).not.toHaveProperty("title");
    }
  });
});

describe("getDeployOptionsState", () => {
  it.each(["done", "error"] as const)("allows deployment and cache settings when %s", (status) => {
    expect(getDeployOptionsState({ pending: false, status, sourceType: "git" })).toEqual({
      deployDisabled: false,
      redeployDisabled: false,
      cacheDisabled: false,
    });
  });

  it("allows the first deploy and cache settings but disables rebuilding a missing checkout", () => {
    expect(getDeployOptionsState({ pending: false, status: "idle", sourceType: "git" })).toEqual({
      deployDisabled: false,
      redeployDisabled: true,
      cacheDisabled: false,
    });
  });

  it.each([
    { pending: true, status: "idle" },
    { pending: false, status: "running" },
    { pending: true, status: "running" },
  ] as const)("disables actions while pending or building %#", ({ pending, status }) => {
    expect(getDeployOptionsState({ pending, status, sourceType: "github" })).toEqual({
      deployDisabled: true,
      redeployDisabled: true,
      cacheDisabled: true,
    });
  });

  it.each(["docker", null])("disables cache changes for source %s", (sourceType) => {
    expect(getDeployOptionsState({ pending: false, status: "done", sourceType })).toEqual({
      deployDisabled: false,
      redeployDisabled: false,
      cacheDisabled: true,
    });
  });
});
