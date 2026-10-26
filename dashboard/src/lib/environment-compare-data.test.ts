import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, unstable_rethrow } = vi.hoisted(() => ({
  request: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./dokploy", () => ({ request }));
vi.mock("next/navigation", () => ({ unstable_rethrow }));

import { loadComparisonPair } from "./environment-compare-data";
import {
  compareEnvironmentsAction,
  revealEnvironmentVariableAction,
} from "../app/environment-compare-actions";

type FixtureEnvironment = {
  environmentId: string;
  applications?: { applicationId: string }[];
  compose?: { composeId: string }[];
};

let tree: { projectId: string; environments: FixtureEnvironment[] }[];
let details: Record<string, Record<string, unknown>>;

beforeEach(() => {
  request.mockReset();
  unstable_rethrow.mockReset();
  tree = [
    {
      projectId: "project-owned",
      environments: [
        { environmentId: "env-a", applications: [{ applicationId: "app-a" }], compose: [{ composeId: "compose-a" }] },
        { environmentId: "env-b", applications: [{ applicationId: "app-b" }], compose: [{ composeId: "compose-b" }] },
      ],
    },
    {
      projectId: "project-other",
      environments: [{ environmentId: "env-other", applications: [{ applicationId: "app-other" }] }],
    },
  ];
  details = {
    "application.one?applicationId=app-a": {
      environmentId: "env-a",
      name: "web",
      sourceType: "github",
      owner: "example",
      repository: "web",
      branch: "main",
      dockerImage: "nginx:alpine",
      buildType: "dockerfile",
      replicas: 2,
      domains: [{ host: "a.example.test" }],
      env: "SHARED=private-before\nSAME=private-same\nEMPTY=\nREMOVED=private-removed",
      password: "private-extra-password",
    },
    "application.one?applicationId=app-b": {
      environmentId: "env-b",
      name: "web",
      sourceType: "git",
      customGitUrl: "https://private-user:private-token@example.test/team/web.git?token=private-query#private-fragment",
      customGitBranch: "staging",
      dockerImage: "nginx:stable",
      buildType: "nixpacks",
      replicas: 3,
      domains: [],
      env: "SHARED=private-after\nSAME=private-same\nADDED=private-added",
    },
    "compose.one?composeId=compose-a": {
      environmentId: "env-a",
      name: "workers",
      sourceType: "raw",
      env: "WORKER_TOKEN=private-worker-a",
      composeFile: [
        "services:",
        "  worker:",
        "    image: busybox:1.36",
        "    environment:",
        "      TOKEN: private-inline-env",
        "    deploy:",
        "      replicas: 2",
        "  builder:",
        "    build:",
        "      context: .",
        "      args:",
        "        TOKEN: private-build-arg",
      ].join("\n"),
      domains: [{ host: "worker.example.test" }, { host: "worker2.example.test" }],
    },
    "compose.one?composeId=compose-b": {
      environmentId: "env-b",
      name: "workers",
      sourceType: "git",
      customGitUrl: "https://example.test/team/workers.git",
      customGitBranch: "preview",
      env: "WORKER_TOKEN=private-worker-b",
      composeFile: "services:\n  worker:\n    image: busybox:1.37\n    scale: 3\n",
      domains: [],
    },
  };
  request.mockImplementation(async (path: string) => {
    if (path === "project.all") return tree;
    if (Object.hasOwn(details, path)) return details[path];
    throw new Error("Unexpected backend request.");
  });
});

describe("environment comparison scope", () => {
  it.each([
    ["project-unavailable", "env-a", "env-b"],
    ["project-owned", "env-a", "env-other"],
    ["project-other", "env-a", "env-other"],
    ["project-owned", "env-missing", "env-b"],
  ])("rejects a project or environment outside the selected project before loading details", async (projectId, aId, bId) => {
    await expect(loadComparisonPair(projectId, aId, bId)).rejects.toThrow("Environment unavailable.");
    expect(request.mock.calls).toEqual([["project.all"]]);
  });

  it("rejects identical environment IDs before accessing the backend", async () => {
    await expect(loadComparisonPair("project-owned", "env-a", "env-a"))
      .rejects.toThrow("Choose two different environments.");
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(257), null, 42, {}, []])("rejects malformed IDs before accessing the backend", async (value) => {
    await expect(loadComparisonPair(value as string, "env-a", "env-b"))
      .rejects.toThrow("Invalid environment selection.");
    await expect(loadComparisonPair("project-owned", value as string, "env-b"))
      .rejects.toThrow("Invalid environment selection.");
    expect(request).not.toHaveBeenCalled();
  });

  it("checks current scope again for every comparison and reveal after access is revoked", async () => {
    expect((await compareEnvironmentsAction("project-owned", "env-a", "env-b")).ok).toBe(true);
    request.mockClear();
    tree = [];
    expect((await compareEnvironmentsAction("project-owned", "env-a", "env-b")).ok).toBe(false);
    expect((await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED")).ok).toBe(false);
    expect(request.mock.calls).toEqual([["project.all"], ["project.all"]]);
  });

  it("rejects a service that moved between project.all and its detail request", async () => {
    details["application.one?applicationId=app-a"].environmentId = "env-other";
    await expect(loadComparisonPair("project-owned", "env-a", "env-b"))
      .rejects.toThrow("Service moved; compare again.");
    expect((await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED")).ok).toBe(false);
  });

  it("uses only default GET requests, authorizing before reading service details", async () => {
    await compareEnvironmentsAction("project-owned", "env-a", "env-b");
    await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED");
    expect(request.mock.calls[0]).toEqual(["project.all"]);
    for (const call of request.mock.calls) {
      expect(call).toHaveLength(1);
      expect(call[0]).toMatch(/^(project\.all|(?:application|compose)\.one\?)/);
    }
    expect(request.mock.calls.filter(([path]) => path === "project.all")).toHaveLength(2);
  });
});

describe("comparison metadata", () => {
  it("extracts application, custom git, and compose metadata without exposing configuration", async () => {
    const result = await compareEnvironmentsAction("project-owned", "env-a", "env-b");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected comparison.");
    expect(result.rows[0].a).toEqual({
      id: "app-a", name: "web", kind: "application", image: "nginx:alpine",
      source: "github: example/web", branch: "main", buildType: "dockerfile", replicas: 2, domainsCount: 1,
    });
    expect(result.rows[0].b).toEqual({
      id: "app-b", name: "web", kind: "application", image: "nginx:stable",
      source: "git: https://example.test/team/web.git", branch: "staging", buildType: "nixpacks", replicas: 3, domainsCount: 0,
    });
    expect(result.rows[1].a).toEqual({
      id: "compose-a", name: "workers", kind: "compose", image: "worker: busybox:1.36",
      source: "raw", branch: null, buildType: "builder: build\nworker: image",
      replicas: "builder: 1\nworker: 2", domainsCount: 2,
    });
    expect(result.rows[1].b).toEqual({
      id: "compose-b", name: "workers", kind: "compose", image: "worker: busybox:1.37",
      source: "git: https://example.test/team/workers.git", branch: "preview",
      buildType: "worker: image", replicas: "worker: 3", domainsCount: 0,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-");
    expect(serialized).not.toContain("composeFile");
    expect(serialized).not.toContain('"env":');
    expect(serialized).not.toContain('"password":');
    expect(serialized).not.toContain("services:");
  });

  it.each(["gitlab", "bitbucket", "gitea"])("extracts %s source and branch", async (provider) => {
    Object.assign(details["application.one?applicationId=app-a"], {
      sourceType: provider,
      [`${provider}Repository`]: "backend",
      [`${provider}Owner`]: "team",
      [`${provider}Branch`]: "develop",
    });
    const result = await loadComparisonPair("project-owned", "env-a", "env-b");
    expect(result.a[0]).toMatchObject({ source: `${provider}: team/backend`, branch: "develop" });
  });

  it("uses the active GitHub repository even when a stale custom Git URL remains", async () => {
    Object.assign(details["application.one?applicationId=app-a"], {
      sourceType: "github",
      owner: "active-owner",
      repository: "active-repo",
      branch: "active-branch",
      customGitUrl: "https://example.test/stale/repo.git",
      customGitBranch: "stale-branch",
    });
    const result = await loadComparisonPair("project-owned", "env-a", "env-b");
    expect(result.a[0]).toMatchObject({ source: "github: active-owner/active-repo", branch: "active-branch" });
  });

  it("uses the active custom Git URL and branch despite stale generic source fields", async () => {
    Object.assign(details["application.one?applicationId=app-a"], {
      sourceType: "git",
      customGitUrl: "https://example.test/active/repo.git",
      customGitBranch: "active-custom-branch",
      owner: "stale-owner",
      repository: "stale-repo",
      branch: "stale-branch",
    });
    const result = await loadComparisonPair("project-owned", "env-a", "env-b");
    expect(result.a[0]).toMatchObject({
      source: "git: https://example.test/active/repo.git", branch: "active-custom-branch",
    });
  });

  it.each(["docker", "raw"])("omits stale repository fields for an active %s source", async (sourceType) => {
    Object.assign(details["application.one?applicationId=app-a"], {
      sourceType,
      customGitUrl: "https://example.test/stale/repo.git",
      customGitBranch: "stale-custom-branch",
      owner: "stale-owner",
      repository: "stale-repo",
      branch: "stale-branch",
    });
    const result = await loadComparisonPair("project-owned", "env-a", "env-b");
    expect(result.a[0]).toMatchObject({ source: sourceType, branch: null });
  });

  it.each(["github", "git", "gitlab", ""])("treats empty source fields as absent for %s", async (sourceType) => {
    Object.assign(details["application.one?applicationId=app-a"], {
      sourceType,
      customGitUrl: "",
      customGitBranch: "",
      owner: "",
      repository: "",
      branch: "",
      gitlabOwner: "",
      gitlabRepository: "",
      gitlabBranch: "",
    });
    const result = await loadComparisonPair("project-owned", "env-a", "env-b");
    expect(result.a[0]).toMatchObject({ source: sourceType || null, branch: null });
  });

  it("does not fall back to stale generic fields when custom Git fields are empty", async () => {
    Object.assign(details["application.one?applicationId=app-a"], {
      sourceType: "git",
      customGitUrl: "",
      customGitBranch: "",
      owner: "stale-owner",
      repository: "stale-repo",
      branch: "stale-branch",
    });
    const result = await loadComparisonPair("project-owned", "env-a", "env-b");
    expect(result.a[0]).toMatchObject({ source: "git", branch: null });
  });

  it("handles missing optional detail fields with stable defaults", async () => {
    details["application.one?applicationId=app-a"] = { environmentId: "env-a" };
    const result = await loadComparisonPair("project-owned", "env-a", "env-b");
    expect(result.a[0]).toEqual({
      id: "app-a", name: "app-a", kind: "application", image: null, source: null,
      branch: null, buildType: null, replicas: 1, domainsCount: 0, env: null,
    });
  });
});

describe("explicit variable reveals", () => {
  it("reveals only the requested variable values and rechecks authorization each time", async () => {
    const result = await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED");
    expect(result).toEqual({ ok: true, a: "private-before", b: "private-after" });
    expect(JSON.stringify(result)).not.toContain("private-same");
    expect(JSON.stringify(result)).not.toContain("private-worker");
    await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED");
    expect(request.mock.calls.filter(([path]) => path === "project.all")).toHaveLength(2);
  });

  it("distinguishes empty values from absent variables", async () => {
    expect(await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "EMPTY"))
      .toEqual({ ok: true, a: "", b: null });
    expect(await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "ADDED"))
      .toEqual({ ok: true, a: null, b: "private-added" });
  });

  it("returns null for the missing side of an unmatched service", async () => {
    details["application.one?applicationId=app-b"].name = "renamed";
    expect(await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED"))
      .toEqual({ ok: true, a: "private-before", b: null });
    expect(await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "renamed", "SHARED"))
      .toEqual({ ok: true, a: null, b: "private-after" });
  });

  it("rejects missing services, missing keys, and ambiguous duplicate service names", async () => {
    expect((await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "unknown", "SHARED")).ok).toBe(false);
    expect((await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "UNKNOWN")).ok).toBe(false);
    details["compose.one?composeId=compose-a"].name = "web";
    expect((await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED")).ok).toBe(false);
  });

  it("rejects malformed variable selections before reading configuration", async () => {
    expect((await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", null as unknown as string, "SHARED")).ok).toBe(false);
    expect((await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", {} as string)).ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

});

describe("action error redaction", () => {
  it("does not include backend credentials in any action error", async () => {
    request.mockRejectedValue(new Error("private-upstream-password"));
    const results = [
      await compareEnvironmentsAction("project-owned", "env-a", "env-b"),
      await revealEnvironmentVariableAction("project-owned", "env-a", "env-b", "web", "SHARED"),
    ];
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(JSON.stringify(results)).not.toContain("private-upstream-password");
    expect(unstable_rethrow).toHaveBeenCalledTimes(2);
  });

  it("does not expose malformed dotenv or YAML contents", async () => {
    details["application.one?applicationId=app-a"].env = 'TOKEN="private-unclosed-value';
    const invalidEnv = await compareEnvironmentsAction("project-owned", "env-a", "env-b");
    expect(invalidEnv.ok).toBe(false);
    expect(JSON.stringify(invalidEnv)).not.toContain("private-");
    details["application.one?applicationId=app-a"].env = "";
    details["compose.one?composeId=compose-a"].composeFile = "services: [private-malformed-yaml";
    const invalidCompose = await compareEnvironmentsAction("project-owned", "env-a", "env-b");
    expect(invalidCompose.ok).toBe(false);
    expect(JSON.stringify(invalidCompose)).not.toContain("private-");
  });
});
