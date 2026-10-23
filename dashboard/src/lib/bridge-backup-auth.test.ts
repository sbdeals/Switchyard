import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ token: "sealed-A" as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "switchyard_session" && auth.token ? { value: auth.token } : undefined }),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard_session",
  openSession: (token: string | undefined) => {
    if (token === "sealed-A") return { dokployCookie: "dokploy-session=A" };
    if (token === "sealed-B") return { dokployCookie: "dokploy-session=B" };
    if (token === "sealed-expired") return { dokployCookie: "dokploy-session=expired" };
    return null;
  },
}));
// Authorization only needs Dokploy HTTP; fail if it tries local Docker first.
vi.mock("./docker", () => ({}));

import { getManagedBridgeDatabase } from "./dokploy";
import { databaseStack, imageStack } from "./managed-compose";

const appName = "database-a1b2";
const composeId = "compose-A";
const databaseFile = databaseStack({
  engine: "postgres", appName, version: "17", password: "test-password", databaseName: "app", databaseUser: "app",
}).composeFile;
let detail: { appName: string; composeFile: string; composeType: string | null };
let ownerAccess: boolean;
let requests: { procedure: string; cookie: string | null; cache: RequestCache | undefined }[];

beforeEach(() => {
  auth.token = "sealed-A";
  detail = { appName, composeFile: databaseFile, composeType: "docker-compose" };
  ownerAccess = true;
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const target = new URL(url);
    const procedure = target.pathname.replace("/api/", "");
    const cookie = new Headers(init.headers).get("Cookie");
    requests.push({ procedure, cookie, cache: init.cache });
    if (cookie === "dokploy-session=expired") return Response.json({}, { status: 401 });
    if (procedure === "project.all") {
      return Response.json([{
        projectId: "project-1", name: "Project",
        environments: [{
          environmentId: "environment-1", name: "Production",
          compose: cookie === "dokploy-session=A" && ownerAccess ? [{ composeId }] : [{ composeId: "compose-B" }],
        }],
      }]);
    }
    if (procedure === "compose.one" && target.searchParams.get("composeId") === composeId) {
      return cookie === "dokploy-session=A" && ownerAccess
        ? Response.json(detail)
        : Response.json({}, { status: 403 });
    }
    throw new Error(`Unexpected request: ${procedure}`);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("managed bridge database backup authorization", () => {
  it("authorizes A then immediately denies B without reusing A's service access", async () => {
    expect(await getManagedBridgeDatabase(composeId)).toEqual({ appName, engine: "postgres" });
    auth.token = "sealed-B";
    await expect(getManagedBridgeDatabase(composeId)).rejects.toThrow("Unknown compose service or access denied");
    expect(requests).toEqual([
      { procedure: "project.all", cookie: "dokploy-session=A", cache: "no-store" },
      { procedure: "compose.one", cookie: "dokploy-session=A", cache: "no-store" },
      { procedure: "project.all", cookie: "dokploy-session=B", cache: "no-store" },
    ]);
  });

  it("rechecks ownership when access is revoked during the same user session", async () => {
    await getManagedBridgeDatabase(composeId);
    ownerAccess = false;
    await expect(getManagedBridgeDatabase(composeId)).rejects.toThrow("access denied");
    expect(requests.map(({ procedure }) => procedure)).toEqual(["project.all", "compose.one", "project.all"]);
  });

  it.each([undefined, "invalid-token"])("rejects missing or invalid sessions before any backend request (%s)", async (token) => {
    auth.token = token;
    await expect(getManagedBridgeDatabase(composeId)).rejects.toThrow("REDIRECT:/login");
    expect(requests).toEqual([]);
  });

  it("rejects an expired Dokploy session without falling back to administrator credentials", async () => {
    auth.token = "sealed-expired";
    await expect(getManagedBridgeDatabase(composeId)).rejects.toThrow("REDIRECT:/login");
    expect(requests).toEqual([
      { procedure: "project.all", cookie: "dokploy-session=expired", cache: "no-store" },
    ]);
  });

  it.each([
    { label: "raw compose", composeFile: "services:\n  postgres:\n    image: postgres:17\n", composeType: "docker-compose" },
    { label: "managed image app", composeFile: imageStack({ appName, image: "nginx:alpine" }), composeType: "docker-compose" },
    { label: "Swarm stack", composeFile: databaseFile, composeType: "stack" },
    { label: "unknown deployment type", composeFile: databaseFile, composeType: null },
  ])("rejects owned $label services before local backup access", async ({ composeFile, composeType }) => {
    detail = { appName, composeFile, composeType };
    await expect(getManagedBridgeDatabase(composeId)).rejects.toThrow("Backups are only available for managed bridge databases");
    expect(requests.map(({ procedure }) => procedure)).toEqual(["project.all", "compose.one"]);
  });
});
