import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./session", () => ({
  SESSION_COOKIE: "switchyard-session",
  openSession: () => ({ dokployCookie: "dokploy-session=test" }),
}));
vi.mock("./docker", () => ({ inspectImageExposedPorts: vi.fn() }));

import { inspectImageExposedPorts } from "./docker";
import { composeAction, deployBridgeImage, deployBridgeRepo, ensureAutoDomain, ensureBridgeAutoDomain, redeployManagedImage } from "./dokploy";
import { imageStack, parseManaged } from "./managed-compose";
import { composeLifecycleAction, createComposeDomainAction, deleteDomainAction, generateComposeDomainAction, updateDomainAction } from "@/app/actions";

const appName = "web-a1b2";
const host = `${appName}-c3d4.203.0.113.10.traefik.me`;
let detail: {
  appName: string;
  composeFile: string;
  env: string;
  composeStatus?: "idle" | "running" | "done" | "error";
  domains: { domainId: string; host: string; serviceName: string | null; port?: number; https?: boolean; certificateType?: "none" | "letsencrypt"; path?: string }[];
};
let generatedHost: string;
let domainFailure: boolean;
let requests: { procedure: string; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWITCHYARD_HOST_IP", "203.0.113.10");
  vi.mocked(inspectImageExposedPorts).mockResolvedValue([]);
  detail = { appName, composeFile: imageStack({ appName, image: "nginx:alpine" }), env: "", domains: [] };
  generatedHost = host;
  domainFailure = false;
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const procedure = new URL(url).pathname.replace("/api/", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ procedure, body });
    switch (procedure) {
      case "compose.create": return Response.json({ composeId: "compose-1", appName });
      case "compose.one": return Response.json(detail);
      case "application.one": return Response.json({ appName, domains: [] });
      case "domain.generateDomain": return Response.json(generatedHost);
      case "domain.create":
        if (domainFailure) return new Response("Domain unavailable", { status: 500 });
        detail.domains.push({ domainId: "domain-1", ...body });
        return Response.json({});
      case "domain.update":
        if (domainFailure) return new Response("Domain unavailable", { status: 500 });
        detail.domains = detail.domains.map((d) => d.domainId === body.domainId ? { ...d, ...body } : d);
        return Response.json({});
      case "domain.delete":
        detail.domains = detail.domains.filter((d) => d.domainId !== body.domainId);
        return Response.json({});
      case "compose.update":
        if (typeof body.composeFile === "string") detail.composeFile = body.composeFile;
        return Response.json({});
      case "compose.deploy": return Response.json({});
      default: throw new Error(`Unexpected request: ${procedure}`);
    }
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const domainRequests = () => requests.filter(({ procedure }) => procedure === "domain.create");

describe("bridge public domains", () => {
  it("attaches a native HTTP compose domain before the first deployment", async () => {
    expect(await deployBridgeImage("web", "nginx:alpine", "environment-1")).toBe("compose-1");
    expect(domainRequests()).toEqual([{
      procedure: "domain.create",
      body: expect.objectContaining({
        composeId: "compose-1", serviceName: "app", domainType: "compose", host,
        port: 80, https: false, certificateType: "none",
      }),
    }]);
    expect(domainRequests()[0].body).not.toHaveProperty("applicationId");
    expect(requests.findIndex(({ procedure }) => procedure === "domain.create"))
      .toBeLessThan(requests.findIndex(({ procedure }) => procedure === "compose.deploy"));
  });

  it("still deploys without creating a domain when HOST_IP is unset", async () => {
    vi.stubEnv("SWITCHYARD_HOST_IP", "");
    await deployBridgeImage("web", "nginx:alpine", "environment-1");
    expect(domainRequests()).toEqual([]);
    expect(requests.some(({ procedure }) => procedure === "domain.generateDomain")).toBe(false);
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(true);
  });

  it("uses app variables ahead of local exposed ports", async () => {
    detail.env = "PORT=8080";
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
    await ensureBridgeAutoDomain("compose-1");
    expect(domainRequests()[0].body.port).toBe(8080);
  });

  it("uses the lowest exposed TCP port ahead of the image default", async () => {
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["9000/tcp", "443/tcp", "53/udp"]);
    await ensureBridgeAutoDomain("compose-1");
    expect(inspectImageExposedPorts).toHaveBeenCalledWith("nginx:alpine", { pullIfMissing: true });
    expect(domainRequests()[0].body.port).toBe(443);
  });

  it("uses the app fallback when local image metadata is unavailable", async () => {
    detail.composeFile = imageStack({ appName, image: "example/web:latest" });
    await ensureBridgeAutoDomain("compose-1");
    expect(domainRequests()[0].body.port).toBe(3000);
  });

  it("uses a freshly pulled image's exposed port before deploying", async () => {
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
    await deployBridgeImage("web", "traefik/whoami", "environment-1");
    expect(inspectImageExposedPorts).toHaveBeenCalledWith("traefik/whoami", { pullIfMissing: true });
    expect(domainRequests()[0].body.port).toBe(80);
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("still deploys with the fallback when the image pull yields no metadata", async () => {
    await expect(deployBridgeImage("web", "traefik/whoami", "environment-1")).resolves.toBe("compose-1");
    expect(inspectImageExposedPorts).toHaveBeenCalledWith("traefik/whoami", { pullIfMissing: true });
    expect(domainRequests()[0].body.port).toBe(3000);
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("falls back to sslip.io when Dokploy cannot generate a usable host", async () => {
    generatedHost = "";
    expect(await ensureBridgeAutoDomain("compose-1")).toBe(`${appName}.203.0.113.10.sslip.io`);
    expect(domainRequests()[0].body).toMatchObject({
      host: `${appName}.203.0.113.10.sslip.io`, https: true, certificateType: "letsencrypt",
    });
  });

  it("returns an existing app auto-domain without duplicating it", async () => {
    detail.domains = [{ domainId: "domain-1", host, serviceName: "app" }];
    expect(await ensureBridgeAutoDomain("compose-1")).toBe(host);
    expect(domainRequests()).toEqual([]);
    expect(requests.some(({ procedure }) => procedure === "domain.generateDomain")).toBe(false);
  });

  it("leaves an existing custom app domain alone", async () => {
    detail.domains = [{ domainId: "domain-1", host: "web.example.com", serviceName: "app", port: 4000 }];
    expect(await ensureBridgeAutoDomain("compose-1")).toBe("web.example.com");
    expect(domainRequests()).toEqual([]);
    expect(inspectImageExposedPorts).not.toHaveBeenCalled();
  });

  it("does not mistake another compose service's auto-domain for the app URL", async () => {
    detail.domains = [{ domainId: "domain-1", host: "other.203.0.113.10.sslip.io", serviceName: "other" }];
    await ensureBridgeAutoDomain("compose-1");
    expect(domainRequests()[0].body.serviceName).toBe("app");
  });

  it("continues deployment when automatic domain provisioning fails", async () => {
    domainFailure = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(deployBridgeImage("web", "nginx:alpine", "environment-1")).resolves.toBe("compose-1");
    expect(domainRequests()).toHaveLength(1);
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(true);
  });

  it("redeploys managed image apps to apply domain changes", async () => {
    await redeployManagedImage("compose-1");
    expect(requests.filter(({ procedure }) => procedure === "compose.deploy"))
      .toEqual([{ procedure: "compose.deploy", body: { composeId: "compose-1" } }]);
  });

  it.each([
    ["ordinary stacks", "services:\n  app:\n    image: nginx:alpine\n"],
    ["managed databases", "x-switchyard:\n  kind: database\n  engine: redis\n  image: redis:7\n"],
  ])("does not generate domains or trigger automatic redeploys for %s", async (_name, composeFile) => {
    detail.composeFile = composeFile;
    expect(await ensureBridgeAutoDomain("compose-1")).toBeNull();
    await redeployManagedImage("compose-1");
    expect(domainRequests()).toEqual([]);
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(false);
  });
});

describe("bridge auto-domain reconciliation", () => {
  async function deployRepo() {
    await deployBridgeRepo("web", { repoUrl: "https://github.com/example/web", branch: "main" }, "environment-1");
    detail.composeStatus = "done";
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["8080/tcp"]);
    requests = [];
  }

  it("corrects a repo's fallback 3000 to the built image's 8080 on the next redeploy only once", async () => {
    await deployRepo();
    expect(detail.domains[0].port).toBe(3000);
    expect(await composeLifecycleAction("compose-1", "deploy")).toEqual({ ok: true });
    expect(detail.domains[0].port).toBe(8080);
    expect(requests.filter(({ procedure }) => procedure === "domain.update")).toEqual([{
      procedure: "domain.update",
      body: { domainId: "domain-1", host, port: 8080, https: false, certificateType: "none", path: "/" },
    }]);
    expect(requests.filter(({ procedure }) => procedure === "compose.deploy")).toHaveLength(1);
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
    expect(parseManaged(detail.composeFile)).toMatchObject({ autoDomain: { host, port: 8080 } });
    await composeAction("compose-1", "deploy");
    expect(requests.filter(({ procedure }) => procedure === "domain.update")).toHaveLength(1);
    expect(requests.filter(({ procedure }) => procedure === "compose.deploy")).toHaveLength(2);
  });

  it("rechecks an image whose initial pull failed after a successful deployment", async () => {
    await deployBridgeImage("web", "traefik/whoami", "environment-1");
    expect(detail.domains[0].port).toBe(3000);
    detail.composeStatus = "done";
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
    requests = [];
    await composeAction("compose-1", "deploy");
    expect(detail.domains[0].port).toBe(80);
    expect(requests.filter(({ procedure }) => procedure === "compose.deploy")).toHaveLength(1);
  });

  it("also refreshes an untouched URL on the next ensure without duplicating it", async () => {
    await deployRepo();
    expect(await ensureBridgeAutoDomain("compose-1")).toBe(host);
    expect(detail.domains[0].port).toBe(8080);
    expect(domainRequests()).toHaveLength(0);
  });

  it.each(["idle", "running", "error"] as const)("does not reconcile before a successful build (%s)", async (status) => {
    await deployRepo();
    detail.composeStatus = status;
    await composeAction("compose-1", "deploy");
    expect(detail.domains[0].port).toBe(3000);
    expect(requests.some(({ procedure }) => procedure === "domain.update")).toBe(false);
  });

  it.each([[], ["53/udp"], ["0/tcp", "65536/tcp"]])("keeps the recorded port when there is no usable local TCP metadata (%j)", async (...ports) => {
    await deployRepo();
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(ports as string[]);
    await composeAction("compose-1", "deploy");
    expect(detail.domains[0].port).toBe(3000);
    expect(requests.some(({ procedure }) => procedure === "domain.update")).toBe(false);
  });

  it.each(["port", "host", "custom domain", "PORT", "untracked"])("preserves explicit or untracked configuration (%s)", async (edit) => {
    await deployRepo();
    if (edit === "port") detail.domains[0].port = 9090;
    if (edit === "host") detail.domains[0].host = "edited.203.0.113.10.traefik.me";
    if (edit === "custom domain") detail.domains.push({ domainId: "custom-1", host: "web.example.com", serviceName: "app", port: 3000 });
    if (edit === "PORT") detail.env = "PORT=3000";
    if (edit === "untracked") detail.composeFile = detail.composeFile.replace(/^  autoDomain.*\n/gm, "");
    const domains = structuredClone(detail.domains);
    await composeAction("compose-1", "deploy");
    expect(detail.domains).toEqual(domains);
    expect(requests.some(({ procedure }) => procedure === "domain.update")).toBe(false);
  });

  it("clears tracking for a Networking edit even when the user explicitly keeps port 3000", async () => {
    await deployRepo();
    expect(await updateDomainAction("domain-1", {
      host, port: 3000, https: false, certificateType: "none",
    }, "compose-1")).toEqual({ ok: true });
    expect(parseManaged(detail.composeFile)).not.toHaveProperty("autoDomain");
    await composeAction("compose-1", "deploy");
    expect(detail.domains[0].port).toBe(3000);
    expect(requests.filter(({ procedure }) => procedure === "domain.update")).toHaveLength(1);
  });

  it("continues deployment if correcting the URL fails", async () => {
    await deployRepo();
    domainFailure = true;
    await expect(composeAction("compose-1", "deploy")).resolves.toBeUndefined();
    expect(detail.domains[0].port).toBe(3000);
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("does not inspect or mutate a compose stack the current user cannot access", async () => {
    await deployRepo();
    vi.mocked(inspectImageExposedPorts).mockClear();
    vi.mocked(fetch).mockResolvedValue(new Response("Forbidden", { status: 403 }));
    expect(await composeLifecycleAction("compose-1", "deploy")).toMatchObject({ ok: false });
    expect(inspectImageExposedPorts).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});

describe("bridge Networking actions", () => {
  it("generates an HTTP URL and deploys its labels", async () => {
    detail.env = "PORT=5000";
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
    expect(await generateComposeDomainAction("compose-1", "app", "web", 8080)).toEqual({ ok: true, host });
    expect(domainRequests()[0].body).toMatchObject({
      composeId: "compose-1", serviceName: "app", host, port: 8080, https: false, certificateType: "none",
    });
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("uses app PORT for Generate URL when no port override is supplied", async () => {
    detail.env = "PORT=8080";
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["80/tcp"]);
    expect(await generateComposeDomainAction("compose-1", "app", "web")).toEqual({ ok: true, host });
    expect(domainRequests()[0].body.port).toBe(8080);
  });

  it("uses local exposed ports for a custom domain without a port override", async () => {
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["9000/tcp", "8080/tcp", "53/udp"]);
    expect(await createComposeDomainAction("compose-1", "app", "app.example.com")).toEqual({ ok: true });
    expect(domainRequests()[0].body.port).toBe(8080);
  });

  it("keeps port 80 as the omitted-port default for ordinary compose domains", async () => {
    detail.composeFile = "services:\n  app:\n    image: nginx:alpine\n";
    detail.env = "PORT=8080";
    vi.mocked(inspectImageExposedPorts).mockResolvedValue(["9000/tcp"]);
    expect(await createComposeDomainAction("compose-1", "app", "app.example.com")).toEqual({ ok: true });
    expect(domainRequests()[0].body.port).toBe(80);
    expect(requests.some(({ procedure }) => procedure === "compose.deploy")).toBe(false);
  });

  it("deploys a custom domain after saving it", async () => {
    expect(await createComposeDomainAction("compose-1", "app", " app.example.com ", 8080)).toEqual({ ok: true });
    expect(domainRequests()[0].body).toMatchObject({
      host: "app.example.com", port: 8080, https: true, certificateType: "letsencrypt",
    });
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("keeps manually added or edited traefik.me domains on HTTP without Let's Encrypt", async () => {
    expect(await createComposeDomainAction("compose-1", "app", host, 80)).toEqual({ ok: true });
    expect(domainRequests()[0].body).toMatchObject({ https: false, certificateType: "none" });
    expect(await updateDomainAction("domain-1", {
      host, port: 80, https: true, certificateType: "letsencrypt",
    }, "compose-1")).toEqual({ ok: true });
    expect(requests.find(({ procedure }) => procedure === "domain.update")?.body)
      .toMatchObject({ https: false, certificateType: "none" });
  });

  it("redeploys after editing a managed app's domain", async () => {
    expect(await updateDomainAction("domain-1", {
      host: " app.example.com ", port: 8080, https: false, certificateType: "none",
    }, "compose-1")).toEqual({ ok: true });
    expect(requests[0]).toEqual({
      procedure: "domain.update",
      body: { domainId: "domain-1", host: "app.example.com", port: 8080, https: false, certificateType: "none", path: "/" },
    });
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("redeploys after deleting a managed app's domain", async () => {
    expect(await deleteDomainAction("domain-1", "compose-1")).toEqual({ ok: true });
    expect(requests[0]).toEqual({ procedure: "domain.delete", body: { domainId: "domain-1" } });
    expect(requests.at(-1)?.procedure).toBe("compose.deploy");
  });

  it("keeps application domain deletion immediate without a compose deployment", async () => {
    expect(await deleteDomainAction("domain-1")).toEqual({ ok: true });
    expect(requests).toEqual([{ procedure: "domain.delete", body: { domainId: "domain-1" } }]);
  });
});

it("preserves the Swarm application's domain payload", async () => {
  expect(await ensureAutoDomain("application-1")).toBe(host);
  expect(domainRequests()).toEqual([{
    procedure: "domain.create",
    body: { applicationId: "application-1", host, port: 3000, https: true, certificateType: "none" },
  }]);
});
