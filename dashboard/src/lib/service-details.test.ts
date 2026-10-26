import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkspace, updateServiceDetails } from "./dokploy";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-session" }) }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("Redirect to login"); }),
}));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard_session",
  openSession: () => ({ dokployCookie: "test-user-cookie" }),
}));
vi.mock("./docker", () => ({}));

const fetchMock = vi.fn();
const tree = [{
  projectId: "project",
  name: "Project",
  environments: [{
    environmentId: "environment",
    name: "Production",
    applications: [{ applicationId: "application-id" }],
    compose: [{ composeId: "compose-id" }],
    postgres: [{ postgresId: "postgres-id" }],
    mysql: [{ mysqlId: "mysql-id" }],
    mariadb: [{ mariadbId: "mariadb-id" }],
    mongo: [{ mongoId: "mongo-id" }],
    redis: [{ redisId: "redis-id" }],
  }],
}];

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    new Response(JSON.stringify(url.endsWith("/project.all") ? tree : {}))
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("updateServiceDetails", () => {
  it.each(["application", "compose", "postgres", "mysql", "mariadb", "mongo", "redis"])(
    "resolves %s from project.all and updates only display metadata",
    async (type) => {
      await updateServiceDetails(`${type}-id`, { name: " Renamed service ", description: "Details" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/project\.all$/);
      const [url, options] = fetchMock.mock.calls[1];
      expect(url).toMatch(new RegExp(`/${type}\\.update$`));
      expect(options.method).toBe("POST");
      expect(options.headers.Cookie).toBe("test-user-cookie");
      expect(JSON.parse(options.body)).toEqual({
        [`${type}Id`]: `${type}-id`,
        name: "Renamed service",
        description: "Details",
      });
    }
  );

  it("rejects a service outside the user's project tree without any mutation", async () => {
    await expect(updateServiceDetails("inaccessible-id", { name: "Renamed" }))
      .rejects.toThrow("Service not found or access denied.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it.each([" ", "a".repeat(64)])("rejects invalid names before any request", async (name) => {
    await expect(updateServiceDetails("compose-id", { name })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores client-supplied identities, type, and other settings", async () => {
    const patch = {
      name: "Renamed",
      appName: "replace-docker-identity",
      composeId: "inaccessible-id",
      applicationId: "application-id",
      kind: "application",
      dockerImage: "different-image",
    };
    await updateServiceDetails("compose-id", patch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/compose\.update$/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ composeId: "compose-id", name: "Renamed" });
  });

  it("allows clearing a description while leaving omitted descriptions untouched", async () => {
    await updateServiceDetails("compose-id", { name: "Renamed", description: "" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).description).toBe("");
    await updateServiceDetails("compose-id", { name: "Renamed" });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).not.toHaveProperty("description");
  });

  it("validates description types at runtime", async () => {
    await expect(updateServiceDetails("compose-id", {
      name: "Renamed",
      description: 123 as unknown as string,
    })).rejects.toThrow("Description must be text.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not attempt an update when the project lookup is denied", async () => {
    fetchMock.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(updateServiceDetails("compose-id", { name: "Renamed" })).rejects.toThrow("403");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirects an expired user session without an update or admin fallback", async () => {
    fetchMock.mockResolvedValue(new Response("Expired", { status: 401 }));
    await expect(updateServiceDetails("compose-id", { name: "Renamed" })).rejects.toThrow("Redirect to login");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces update failures without attempting a deploy or reload", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(tree)));
    fetchMock.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(updateServiceDetails("compose-id", { name: "Renamed" })).rejects.toThrow("403");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("service descriptions", () => {
  it("loads descriptions for applications, compose stacks, and every database engine", async () => {
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/project.all") ? tree : { description: "Stored description" }
    )));
    const { services } = await loadWorkspace();
    expect(services).toHaveLength(7);
    expect(services.every((service) => service.description === "Stored description")).toBe(true);
  });

  it("normalizes missing descriptions to null", async () => {
    const { services } = await loadWorkspace();
    expect(services.every((service) => service.description === null)).toBe(true);
  });
});
