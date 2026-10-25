import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard-session",
  openSession: () => ({ dokployCookie: "dokploy-session=test" }),
}));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn() }));

import { quickDeployImageAction } from "@/app/actions";
import { inspectImageExposedPorts } from "./docker";
import { ensureAutoDomain } from "./dokploy";

const host = "web-a1b2.203.0.113.10.traefik.me";
let generatedHost: string;
let detail: {
  appName: string;
  sourceType: string;
  dockerImage: string;
  env: string;
  domains: { host: string; port: number }[];
};
let requests: { procedure: string; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWITCHYARD_HOST_IP", "203.0.113.10");
  vi.stubEnv("SWITCHYARD_DEPLOY_TARGET", "swarm");
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([]);
  generatedHost = host;
  detail = { appName: "web-a1b2", sourceType: "docker", dockerImage: "nginx:alpine", env: "", domains: [] };
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const procedure = new URL(url).pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body });
    switch (procedure) {
      case "application.create": return Response.json({ applicationId: "application-1" });
      case "application.one": return Response.json(detail);
      case "application.saveDockerProvider":
        detail.dockerImage = body.dockerImage;
        return Response.json({});
      case "application.deploy": return Response.json({});
      case "domain.generateDomain": return Response.json(generatedHost);
      case "domain.create": return Response.json({});
      default: throw new Error(`Unexpected request: ${procedure}`);
    }
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const domains = () => requests.filter(({ procedure }) => procedure === "domain.create");

describe("Swarm image auto-domains", () => {
  it("routes a quick-deployed image to its exposed port", async () => {
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
    expect(await quickDeployImageAction("traefik/whoami:latest", "web", "environment-1"))
      .toEqual({ ok: true, id: "application-1" });
    expect(inspectImageExposedPorts).toHaveBeenCalledWith("traefik/whoami:latest", { pullIfMissing: true });
    expect(domains()).toEqual([{
      procedure: "domain.create",
      body: { applicationId: "application-1", host, port: 80, https: true, certificateType: "none" },
    }]);
    expect(requests.some(({ procedure }) => procedure === "application.deploy")).toBe(true);
    expect(requests.some(({ procedure }) => procedure.startsWith("compose."))).toBe(false);
  });

  it.each([
    ["nginx:alpine", "", [], 80],
    ["example/web:latest", "PORT=8080", ["80/tcp"], 8080],
    ["example/web:latest", "", ["9000/tcp", "8080/tcp", "53/udp"], 8080],
    ["example/web:latest", "", [], 3000],
  ])("resolves %s with env %s and metadata %j to %i", async (image, env, exposedPorts, port) => {
    detail.dockerImage = image;
    detail.env = env;
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(exposedPorts);
    expect(await ensureAutoDomain("application-1")).toBe(host);
    expect(domains()[0].body.port).toBe(port);
  });

  it("uses the detected port for the sslip.io fallback too", async () => {
    generatedHost = "";
    expect(await ensureAutoDomain("application-1")).toBe("web-a1b2.203.0.113.10.sslip.io");
    expect(domains()[0].body).toMatchObject({ port: 80, https: true, certificateType: "letsencrypt" });
  });

  it("preserves the repo fallback without pulling a stale Docker provider image", async () => {
    detail.sourceType = "git";
    expect(await ensureAutoDomain("application-1")).toBe(host);
    expect(domains()[0].body.port).toBe(3000);
    expect(inspectImageExposedPorts).not.toHaveBeenCalled();
  });

  it("keeps an existing auto-domain and its chosen port", async () => {
    detail.domains = [{ host, port: 4000 }];
    expect(await ensureAutoDomain("application-1")).toBe(host);
    expect(domains()).toEqual([]);
    expect(inspectImageExposedPorts).not.toHaveBeenCalled();
  });

  it("does not inspect or create a domain when auto-URLs are disabled", async () => {
    vi.stubEnv("SWITCHYARD_HOST_IP", "");
    expect(await ensureAutoDomain("application-1")).toBeNull();
    expect(requests).toEqual([]);
    expect(inspectImageExposedPorts).not.toHaveBeenCalled();
  });
});
