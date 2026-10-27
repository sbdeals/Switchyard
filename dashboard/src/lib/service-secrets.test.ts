import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadComposeFileAction,
  loadServiceCommandsAction,
  loadServiceWebhookAction,
  saveComposeFileAction,
  setAppDockerSourceAction,
  updateApplicationAction,
  updateDatabaseAction,
  updateGitDeployAction,
  updateAppGitBranchAction,
} from "../app/actions";
import { ENGINES, type DockerRegistryPatch, type MountServiceType } from "./dokploy";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  openSession: vi.fn(),
  redirect: new Error("NEXT_REDIRECT"),
}));

vi.mock("server-only", () => ({}));
vi.mock("./docker", () => ({}));
vi.mock("./session", () => ({ SESSION_COOKIE: "test-session", openSession: mocks.openSession }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "sealed-test-session" }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: () => { throw mocks.redirect; },
  unstable_rethrow: (error: unknown) => {
    if (error === mocks.redirect) throw error;
  },
}));

function projectsWith(type: MountServiceType, id = "owned-id") {
  return [{
    projectId: "owned-project",
    name: "Owned project",
    environments: [{
      environmentId: "owned-environment",
      name: "test",
      applications: [],
      compose: [],
      postgres: [],
      mysql: [],
      mariadb: [],
      mongo: [],
      redis: [],
      [type === "application" ? "applications" : type]: [{ [`${type}Id`]: id }],
    }],
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openSession.mockReturnValue({ dokployCookie: "test-user-session" });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("Docker registry credential preservation", () => {
  const stored = {
    dockerImage: "private/image:old",
    username: "SENTINEL_saved_user",
    password: 'SENTINEL_saved_"password\\secret',
    registryUrl: "https://SENTINEL_url_user:SENTINEL_registry@registry.example",
  };
  const credentials = {
    username: stored.username,
    password: stored.password,
    registryUrl: stored.registryUrl,
  };
  const cases: { name: string; patch?: DockerRegistryPatch; expected: typeof credentials | {
    username: null; password: null; registryUrl: null;
  } }[] = [
    { name: "image-only edit", expected: credentials },
    { name: "untouched fields", patch: {}, expected: credentials },
    { name: "null fields", patch: { username: null, password: null, registryUrl: null }, expected: credentials },
    { name: "blank username and password", patch: { username: "", password: "" }, expected: credentials },
    { name: "changed username", patch: { username: "new-user" }, expected: { ...credentials, username: "new-user" } },
    { name: "changed password", patch: { password: "new-password" }, expected: { ...credentials, password: "new-password" } },
    { name: "redacted registry URL", patch: { registryUrl: "https://registry.example" }, expected: credentials },
    { name: "changed registry URL", patch: { registryUrl: "https://other.example" }, expected: { ...credentials, registryUrl: "https://other.example" } },
    { name: "empty registry URL", patch: { registryUrl: "" }, expected: { ...credentials, registryUrl: "" } },
    { name: "explicit clear", patch: { clearCredentials: true }, expected: { username: null, password: null, registryUrl: null } },
    { name: "clear overrides drafts", patch: { ...credentials, clearCredentials: true }, expected: { username: null, password: null, registryUrl: null } },
  ];

  it.each(cases)("handles $name without returning secrets", async ({ patch, expected }) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json(stored))
      .mockResolvedValueOnce(Response.json({}));

    expect(await setAppDockerSourceAction("owned-id", " private/image:new ", patch)).toEqual({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch.mock.calls[2][0]).toMatch(/\/api\/application\.saveDockerProvider$/);
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toEqual({
      applicationId: "owned-id",
      dockerImage: "private/image:new",
      ...expected,
    });
  });

  it.each([false, true])("scrubs stored credentials from backend errors (clear: %s)", async (clearCredentials) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json(stored))
      .mockResolvedValueOnce(new Response(
        `Invalid registry ${stored.registryUrl}; user ${stored.username}; password ${stored.password}; ${JSON.stringify({ password: stored.password })}`,
        { status: 400 },
      ));

    expect(await setAppDockerSourceAction("owned-id", "private/image:new", { clearCredentials })).toEqual({
      ok: false,
      error: 'Dokploy application.saveDockerProvider failed (400): Invalid registry ***; user ***; password ***; {"password":"***"}',
    });
  });
});

const readers = [
  { name: "webhook", type: "application" as const, run: loadServiceWebhookAction, error: "Could not load webhook URL." },
  { name: "compose file", type: "compose" as const, run: loadComposeFileAction, error: "Could not load compose file." },
  ...(["application", ...ENGINES] as const).map((type) => ({
    name: `${type} commands`, type,
    run: (id: string) => loadServiceCommandsAction(type, id),
    error: "Could not load service commands.",
  })),
];

describe("branch-only server action", () => {
  it("saves only the branch without resubmitting stored credentials or triggers", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({
        sourceType: "git", customGitUrl: "https://user:SENTINEL_git@host/repo.git",
        autoDeploy: true, watchPaths: ["src/**"],
      }))
      .mockResolvedValueOnce(Response.json({}));
    expect(await updateAppGitBranchAction("owned-id", " feature/next ")).toEqual({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toEqual({
      applicationId: "owned-id", customGitBranch: "feature/next",
    });
  });

  it.each(["read", "write"])("hides backend secrets on a failed %s", async (stage) => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("application")));
    if (stage === "write") mocks.fetch.mockResolvedValueOnce(Response.json({ sourceType: "git" }));
    mocks.fetch.mockResolvedValueOnce(new Response("SENTINEL_private_backend_detail", { status: 500 }));
    expect(await updateAppGitBranchAction("owned-id", "main")).toEqual({
      ok: false, error: "Could not save Git branch.",
    });
  });

  it("preserves expired-session redirects", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(updateAppGitBranchAction("owned-id", "main")).rejects.toBe(mocks.redirect);
  });
});

describe.each(readers)("$name lazy loading", ({ type, run, error }) => {
  it("rejects another account's service before reading detail", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith(type)));
    expect(await run("other-id")).toEqual({ ok: false, error });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/api\/project\.all$/);
    expect(mocks.fetch.mock.calls[0][1].headers.Cookie).toBe("test-user-session");
  });

  it.each([null, undefined, "", " ", 123, {}])("rejects an invalid runtime ID (%s)", async (id) => {
    expect(await run(id as string)).toEqual({ ok: false, error });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not expose backend errors", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(type)))
      .mockResolvedValueOnce(new Response("SENTINEL_private_backend_detail", { status: 500 }));
    expect(await run("owned-id")).toEqual({ ok: false, error });
  });

  it("preserves the login redirect when the session is missing", async () => {
    mocks.openSession.mockReturnValue(null);
    await expect(run("owned-id")).rejects.toBe(mocks.redirect);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves the login redirect when Dokploy rejects the session", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(run("owned-id")).rejects.toBe(mocks.redirect);
  });
});

describe("owned secret loading", () => {
  it("loads only the webhook URL and encodes the owned ID", async () => {
    const id = "owned/id?x=1";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application", id)))
      .mockResolvedValueOnce(Response.json({ refreshToken: "SENTINEL_webhook", env: "SENTINEL_unrelated" }));
    const result = await loadServiceWebhookAction(id);
    expect(result).toEqual({ ok: true, webhookUrl: expect.stringMatching(/\/api\/deploy\/SENTINEL_webhook$/) });
    expect(mocks.fetch.mock.calls[1][0]).toContain(`applicationId=${encodeURIComponent(id)}`);
    expect(mocks.fetch.mock.calls[1][1].headers.Cookie).toBe("test-user-session");
  });

  it("returns null when the owned app has no webhook", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({ refreshToken: null }));
    expect(await loadServiceWebhookAction("owned-id")).toEqual({ ok: true, webhookUrl: null });
  });

  it.each([null, "services:\n  web:\n    environment: [TOKEN=SENTINEL_compose]\n"])("loads compose text (%s)", async (composeFile) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("compose")))
      .mockResolvedValueOnce(Response.json({ composeFile, env: "SENTINEL_unrelated" }));
    expect(await loadComposeFileAction("owned-id")).toEqual({ ok: true, composeFile: composeFile ?? "" });
  });

  it.each(["application", ...ENGINES] as const)("loads %s commands and only application health checks", async (type) => {
    const command = "echo SENTINEL_command";
    const healthCheckSwarm = { Test: ["CMD-SHELL", "curl -H SENTINEL_health localhost"] };
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(type)))
      .mockResolvedValueOnce(Response.json({ command, healthCheckSwarm, env: "SENTINEL_unrelated" }));
    expect(await loadServiceCommandsAction(type, "owned-id")).toEqual({
      ok: true, command, healthCheckSwarm: type === "application" ? healthCheckSwarm : null,
    });
  });

  it("rejects service kinds outside the runtime allowlist", async () => {
    expect(await loadServiceCommandsAction("destination" as MountServiceType, "owned-id"))
      .toEqual({ ok: false, error: "Could not load service commands." });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not treat another service kind's ID as ownership", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith("compose")));
    expect(await loadServiceWebhookAction("owned-id"))
      .toEqual({ ok: false, error: "Could not load webhook URL." });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("secret-bearing settings saves", () => {
  it("round-trips compose YAML without modifying inline secrets", async () => {
    const composeFile = "services:\n  web:\n    environment: [TOKEN=SENTINEL_compose]\n";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("compose")))
      .mockResolvedValueOnce(Response.json({}));
    expect(await saveComposeFileAction("owned-id", composeFile)).toEqual({ ok: true });
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ composeId: "owned-id", composeFile });
  });

  it("does not echo compose content when the save itself fails", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("compose")))
      .mockResolvedValueOnce(new Response("SENTINEL_compose: invalid YAML", { status: 400 }));
    expect(await saveComposeFileAction("owned-id", "SENTINEL_compose"))
      .toEqual({ ok: false, error: "Could not save compose file." });
  });

  it("saves commands and health checks after checking application ownership", async () => {
    const patch = { command: "echo SENTINEL_command", healthCheckSwarm: { Test: ["CMD-SHELL", "echo SENTINEL_health"] } };
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({}));
    expect(await updateApplicationAction("owned-id", patch)).toEqual({ ok: true });
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ applicationId: "owned-id", ...patch });
  });

  it.each([
    { type: "application" as const, run: () => updateApplicationAction("owned-id", { replicas: -1 }), endpoint: "application.update" },
    { type: "postgres" as const, run: () => updateDatabaseAction("postgres", "owned-id", "db-app", { cpuLimit: "invalid" }), endpoint: "postgres.update" },
  ])("preserves $type scalar validation errors", async ({ type, run, endpoint }) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith(type)))
      .mockResolvedValueOnce(new Response("Value must be positive", { status: 400 }));
    expect(await run()).toEqual({ ok: false, error: `Dokploy ${endpoint} failed (400): Value must be positive` });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves local Docker image validation", async () => {
    expect(await setAppDockerSourceAction("owned-id", " "))
      .toEqual({ ok: false, error: "Image is required." });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { command: "echo SENTINEL_fragment" },
    { healthCheckSwarm: { Test: ["CMD-SHELL", "echo SENTINEL_fragment"] } },
    { description: "inline secret: SENTINEL_fragment" },
  ])("keeps a generic error for free-text secret excerpts (%j)", async (patch) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(new Response("Invalid value: SENTINEL_fragment", { status: 400 }));
    expect(await updateApplicationAction("owned-id", patch))
      .toEqual({ ok: false, error: "Could not save application settings." });
  });

  it("preserves stored Git URL credentials when a form resubmits the redacted URL", async () => {
    const customGitUrl = "https://user:SENTINEL_git@host/repo.git";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({ customGitUrl }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({}));
    expect(await updateGitDeployAction("owned-id", { gitUrl: "https://host/repo.git", branch: "other", autoDeploy: false }))
      .toEqual({ ok: true });
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toMatchObject({ customGitUrl, customGitBranch: "other" });
  });

  it("accepts a deliberately changed Git URL", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({ customGitUrl: "https://user:SENTINEL_git@host/repo.git" }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({}));
    await updateGitDeployAction("owned-id", { gitUrl: "https://other/repo.git", autoDeploy: false });
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body).customGitUrl).toBe("https://other/repo.git");
  });

  it("preserves stored Docker image and registry URL userinfo", async () => {
    const dockerImage = "https://user:SENTINEL_image@host/image:tag";
    const registryUrl = "https://user:SENTINEL_registry@host";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({ dockerImage, registryUrl }))
      .mockResolvedValueOnce(Response.json({}));
    expect(await setAppDockerSourceAction("owned-id", "https://host/image:tag", {
      username: "", password: "", registryUrl: "https://host",
    })).toEqual({ ok: true });
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toMatchObject({ dockerImage, registryUrl });
  });

  it("preserves stored database image URL userinfo", async () => {
    const dockerImage = "https://user:SENTINEL_image@host/postgres:16";
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("postgres")))
      .mockResolvedValueOnce(Response.json({ dockerImage }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({}));
    expect(await updateDatabaseAction("postgres", "owned-id", "db-app", { dockerImage: "https://host/postgres:16" }))
      .toEqual({ ok: true });
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toMatchObject({ dockerImage });
  });

  const sourceMutations = [
    { type: "application" as const, field: "customGitUrl", run: (url: string) => updateGitDeployAction("owned-id", { gitUrl: url, autoDeploy: false }), endpoint: "application.saveGitProvider" },
    { type: "application" as const, field: "dockerImage", run: (url: string) => setAppDockerSourceAction("owned-id", url), endpoint: "application.saveDockerProvider" },
    { type: "postgres" as const, field: "dockerImage", run: (url: string) => updateDatabaseAction("postgres", "owned-id", "db-app", { dockerImage: url }), endpoint: "postgres.update" },
  ];

  describe.each(sourceMutations)("$endpoint error redaction", ({ type, field, run, endpoint }) => {
    it.each([false, true])("scrubs complete URLs and credential fragments (preserved: %s)", async (preserved) => {
      const url = "https://SENTINEL_user:SENTINEL_password@host/repo";
      const submitted = preserved ? "https://host/repo" : url;
      mocks.fetch
        .mockResolvedValueOnce(Response.json(projectsWith(type)))
        .mockResolvedValueOnce(Response.json({ [field]: preserved ? url : null }))
        .mockResolvedValueOnce(new Response(`Invalid source ${submitted}; stored ${url}; user SENTINEL_user; password SENTINEL_password`, { status: 400 }));
      expect(await run(submitted)).toEqual({
        ok: false,
        error: `Dokploy ${endpoint} failed (400): Invalid source ***; stored ***; user ***; password ***`,
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
    });
  });

  it("scrubs registry credentials and JSON-escaped password echoes", async () => {
    const registry = { username: "SENTINEL_user", password: 'SENTINEL_"password\\secret', registryUrl: "https://registry.example" };
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(new Response(`Invalid registry ${registry.registryUrl}; user ${registry.username}; password ${registry.password}; ${JSON.stringify({ password: registry.password })}`, { status: 400 }));
    expect(await setAppDockerSourceAction("owned-id", "image:tag", registry)).toEqual({
      ok: false,
      error: 'Dokploy application.saveDockerProvider failed (400): Invalid registry ***; user ***; password ***; {"password":"***"}',
    });
  });

  it("uses a generic fallback when a backend body may truncate a secret", async () => {
    const password = `SENTINEL_${"x".repeat(350)}`;
    mocks.fetch
      .mockResolvedValueOnce(Response.json(projectsWith("application")))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(new Response(`Invalid registry password: ${password}`, { status: 400 }));
    expect(await setAppDockerSourceAction("owned-id", "image:tag", { username: "", password, registryUrl: "" }))
      .toEqual({ ok: false, error: "Could not save Docker source." });
  });

  const mutations = [
    { type: "compose" as const, run: () => saveComposeFileAction("other-id", "SENTINEL"), error: "Could not save compose file.", generic: true },
    { type: "application" as const, run: () => updateGitDeployAction("other-id", { gitUrl: "https://host/repo.git", autoDeploy: false }), error: "Could not save Git deploy settings.", generic: false },
    { type: "application" as const, run: () => setAppDockerSourceAction("other-id", "image:tag"), error: "Could not save Docker source.", generic: false },
    { type: "application" as const, run: () => updateApplicationAction("other-id", { command: "SENTINEL" }), error: "Could not save application settings.", generic: true },
    { type: "postgres" as const, run: () => updateDatabaseAction("postgres", "other-id", "db-app", { dockerImage: "image:tag" }), error: "Could not save database settings.", generic: false },
    { type: "postgres" as const, run: () => updateDatabaseAction("postgres", "other-id", "db-app", { name: "renamed-db" }), error: "Could not save database settings.", generic: false },
  ];

  it.each(mutations)("rejects unowned $type settings before detail reads or mutation ($error)", async ({ type, run, error, generic }) => {
    mocks.fetch.mockResolvedValueOnce(Response.json(projectsWith(type)));
    expect(await run()).toEqual({ ok: false, error: generic ? error : "Service unavailable." });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(mutations)("scrubs backend errors or keeps the safe fallback ($error)", async ({ run, error, generic }) => {
    mocks.fetch.mockResolvedValueOnce(new Response("Connection refused: https://SENTINEL_user:SENTINEL_password@host/api/deploy/SENTINEL_webhook", { status: 500 }));
    expect(await run()).toEqual({
      ok: false,
      error: generic ? error : "Dokploy project.all failed (500): Connection refused: https://host/api/deploy/***",
    });
  });

  it.each(mutations)("preserves login redirects ($error)", async ({ run }) => {
    mocks.openSession.mockReturnValue(null);
    await expect(run()).rejects.toBe(mocks.redirect);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
