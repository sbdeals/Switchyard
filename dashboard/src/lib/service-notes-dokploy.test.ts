import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINES, loadWorkspace, updateServiceNotes } from "./dokploy";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "fixture-session" }) }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "fixture-session",
  openSession: () => ({ dokployCookie: "fixture-cookie" }),
}));
vi.mock("./docker", () => ({
  listRuntimeStates: async () => { throw new Error("No Docker in unit tests"); },
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("updateServiceNotes", () => {
  const targets = [
    { kind: "application" as const, id: "app", type: "application" },
    { kind: "compose" as const, id: "stack", type: "compose" },
    ...ENGINES.map((engine) => ({ kind: "database" as const, id: engine, engine, type: engine })),
  ];

  it.each(targets)("saves $type notes with the matching id key and no redeploy", async (target) => {
    fetchMock.mockResolvedValue(new Response("{}"));
    await updateServiceNotes(target, "First\n<script>plain text</script>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(`/api/${target.type}.update`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      [`${target.type}Id`]: target.id,
      description: "First\n<script>plain text</script>",
    });
    expect(init?.headers).toMatchObject({ Cookie: "fixture-cookie" });
  });

  it("sends an empty description to clear existing notes", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    await updateServiceNotes({ kind: "compose", id: "stack" }, "");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      composeId: "stack", description: "",
    });
  });
});

describe("workspace descriptions", () => {
  it.each(["First\n<script>plain text</script>", null, undefined])(
    "maps description %s for applications, compose, and every database engine",
    async (description) => {
      const tree = [{
        projectId: "project", name: "Project", environments: [{
          environmentId: "env", name: "Production",
          applications: [{ applicationId: "app" }], compose: [{ composeId: "stack" }],
          ...Object.fromEntries(ENGINES.map((engine) => [engine, [{ [`${engine}Id`]: engine }]])),
        }],
      }];
      fetchMock.mockImplementation(async (url) => new Response(JSON.stringify(
        new URL(String(url)).pathname === "/api/project.all"
          ? tree
          : { name: "Service", description }
      )));
      const { services } = await loadWorkspace();
      expect(services).toHaveLength(7);
      expect(services.map((service) => service.description)).toEqual(
        Array(7).fill(description ?? null)
      );
    }
  );
});
