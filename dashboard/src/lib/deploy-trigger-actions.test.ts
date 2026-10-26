import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  redirectError: new Error("NEXT_REDIRECT"),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => { throw mocks.redirectError; },
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.redirectError) throw error;
  },
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "test-session",
  openSession: () => ({ dokployCookie: "test-cookie" }),
}));
vi.mock("./docker", () => ({
  listRuntimeStates: async () => { throw new Error("No Docker in unit tests"); },
}));

import { loadWorkspace, updateAppGitBranch, updateDeployTriggers } from "./dokploy";
import {
  previewDeployTriggersAction,
  updateDeployTriggersAction,
} from "../app/deploy-trigger-actions";
import type { DeployTriggerKind } from "./deploy-triggers";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const tree = [{
  projectId: "project-1",
  name: "Test project",
  environments: [{
    environmentId: "environment-1",
    name: "Test environment",
    postgres: [], mysql: [], mariadb: [], mongo: [], redis: [],
    applications: [{ applicationId: "app-1" }],
    compose: [{ composeId: "compose-1" }],
  }],
}];
const input = { autoDeploy: true, watchPaths: "src/**\n\n package.json \n" };

function respond(...bodies: unknown[]) {
  for (const body of bodies) fetchMock.mockResolvedValueOnce(Response.json(body));
}

function requests() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    path: new URL(url).pathname + new URL(url).search,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => { throw new Error("Unexpected Dokploy request"); });
  vi.stubGlobal("fetch", fetchMock);
  mocks.revalidatePath.mockReset();
});

describe.each(["application", "compose"] as const)("%s deploy triggers", (kind) => {
  const id = kind === "application" ? "app-1" : "compose-1";
  const key = kind === "application" ? "applicationId" : "composeId";

  it("checks ownership before reading the source and writes only trigger fields", async () => {
    respond(tree, { sourceType: "git", triggerType: "tag" }, {});
    await updateDeployTriggers(kind, id, input);
    expect(requests()).toEqual([
      { path: "/api/project.all", body: undefined },
      { path: `/api/${kind}.one?${key}=${id}`, body: undefined },
      {
        path: `/api/${kind}.update`,
        body: { [key]: id, autoDeploy: true, watchPaths: ["src/**", "package.json"] },
      },
    ]);
  });

  it.each(["push", "tag"])("preserves the stored %s trigger when enabling auto-deploy", async (triggerType) => {
    respond(tree, { sourceType: "git", triggerType }, {});
    await updateDeployTriggers(kind, id, input);
    expect(requests()[2].body).toEqual({ [key]: id, autoDeploy: true, watchPaths: ["src/**", "package.json"] });
  });

  it.each([null, undefined])("defaults an unset trigger type (%s) to push when enabling auto-deploy", async (triggerType) => {
    respond(tree, { sourceType: "git", triggerType }, {});
    await updateDeployTriggers(kind, id, input);
    expect(requests()[2].body).toEqual({
      [key]: id, autoDeploy: true, watchPaths: ["src/**", "package.json"], triggerType: "push",
    });
  });

  it.each(["push", "tag", null, undefined])("preserves the stored trigger type (%s) when disabling auto-deploy", async (triggerType) => {
    respond(tree, { sourceType: "github", triggerType }, {});
    await updateDeployTriggers(kind, id, { autoDeploy: false, watchPaths: "" });
    expect(requests()[2].body).toEqual({ [key]: id, autoDeploy: false, watchPaths: [] });
  });

  it("rejects an unowned id before reading or updating its details", async () => {
    respond(tree);
    await expect(updateDeployTriggers(kind, "someone-elses-id", input))
      .rejects.toThrow("Service not found in your projects.");
    expect(requests()).toEqual([{ path: "/api/project.all", body: undefined }]);
  });

  it("does not treat a different service kind's id as owned", async () => {
    respond(tree);
    await expect(updateDeployTriggers(kind, kind === "application" ? "compose-1" : "app-1", input))
      .rejects.toThrow("Service not found in your projects.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["raw", "docker", null])("rejects the current non-git source %s", async (sourceType) => {
    respond(tree, { sourceType });
    await expect(updateDeployTriggers(kind, id, input))
      .rejects.toThrow("Deploy triggers require a Git source.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

it("rejects forged service kinds and ids before calling Dokploy", async () => {
  await expect(updateDeployTriggers("postgres" as DeployTriggerKind, "app-1", input))
    .rejects.toThrow("Invalid service.");
  for (const id of ["", "a".repeat(129), "app-1&otherId=foreign", null]) {
    await expect(updateDeployTriggers("application", id as string, input))
      .rejects.toThrow("Invalid service.");
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it("validates trigger input at the mutation boundary", async () => {
  await expect(updateDeployTriggers("application", "app-1", { autoDeploy: "true", watchPaths: "" }))
    .rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reads stored trigger settings for applications and compose", async () => {
  respond(
    tree,
    { sourceType: "gitlab", autoDeploy: true, watchPaths: ["src/**"], triggerType: "tag" },
    { sourceType: "git", autoDeploy: false, watchPaths: ["compose/**"], triggerType: "push" }
  );
  const { services } = await loadWorkspace();
  expect(services.find((service) => service.id === "app-1")).toMatchObject({
    sourceType: "gitlab", autoDeploy: true, watchPaths: ["src/**"], triggerType: "tag",
  });
  expect(services.find((service) => service.id === "compose-1")).toMatchObject({
    sourceType: "git", autoDeploy: false, watchPaths: ["compose/**"], triggerType: "push",
  });
});

it("normalizes absent trigger fields without inventing enabled auto-deploy", async () => {
  respond(tree, {}, {});
  const { services } = await loadWorkspace();
  for (const service of services) {
    expect(service).toMatchObject({
      sourceType: null, autoDeploy: false, watchPaths: [], triggerType: null,
    });
  }
});

describe("branch settings", () => {
  it("updates only the branch without resetting status or other Git settings", async () => {
    respond(tree, {
      sourceType: "git", customGitUrl: "https://example.com/public.git",
      customGitBuildPath: "/web", watchPaths: ["web/**", "package.json"],
    }, {});
    await updateAppGitBranch("app-1", " feature/next ");
    expect(requests()[2]).toEqual({
      path: "/api/application.update",
      body: { applicationId: "app-1", customGitBranch: "feature/next" },
    });
  });

  it.each(["", " ", "x".repeat(256), "bad\nbranch"])("rejects invalid branch input", async (branch) => {
    await expect(updateAppGitBranch("app-1", branch)).rejects.toThrow("Branch must be");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-checks ownership before reading the branch's service", async () => {
    respond([]);
    await expect(updateAppGitBranch("app-1", "main")).rejects.toThrow("Service not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects sources managed by a provider", async () => {
    respond(tree, { sourceType: "github", customGitUrl: "https://example.com/public.git" });
    await expect(updateAppGitBranch("app-1", "main")).rejects.toThrow("custom Git source");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("server actions", () => {
  it("revalidates the workspace after a successful save", async () => {
    respond(tree, { sourceType: "git" }, {});
    await expect(updateDeployTriggersAction("compose", "compose-1", input)).resolves.toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("returns ownership errors without revalidating", async () => {
    respond([]);
    await expect(updateDeployTriggersAction("compose", "compose-1", input)).resolves.toEqual({
      ok: false, error: "Service not found in your projects.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("lets expired-session redirects propagate", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(updateDeployTriggersAction("compose", "compose-1", input)).rejects.toBe(mocks.redirectError);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("previews parsed settings without making a network request", async () => {
    await expect(previewDeployTriggersAction(input, ["src/index.ts", "docs/readme.md"])).resolves.toEqual({
      ok: true,
      preview: [
        { path: "src/index.ts", matches: true, triggers: true },
        { path: "docs/readme.md", matches: false, triggers: false },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns preview validation errors without network requests", async () => {
    expect(await previewDeployTriggersAction(input, [""])).toMatchObject({ ok: false });
    expect(await previewDeployTriggersAction({ autoDeploy: true }, [])).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
