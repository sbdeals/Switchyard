import { describe, expect, it } from "vitest";
import { bridgeImageDomain, imageStack, parseManaged } from "./managed-compose";

describe("bridgeImageDomain", () => {
  it("uses the generated traefik.me hostname over HTTP without requesting a certificate", () => {
    expect(bridgeImageDomain({
      appName: "web-x1",
      hostIp: "203.0.113.10",
      generatedHost: "web-x1-random.203.0.113.10.traefik.me",
      port: 8080,
    })).toEqual({
      host: "web-x1-random.203.0.113.10.traefik.me",
      port: 8080,
      https: false,
      certificateType: "none",
      path: "/",
    });
  });

  it("falls back to sslip.io with a certificate when no generated hostname is available", () => {
    expect(bridgeImageDomain({
      appName: "web-x1",
      hostIp: "203.0.113.10",
      generatedHost: null,
      port: 80,
    })).toEqual({
      host: "web-x1.203.0.113.10.sslip.io",
      port: 80,
      https: true,
      certificateType: "letsencrypt",
      path: "/",
    });
  });
});

describe("imageStack", () => {
  it("keeps the routable app service on the shared bridge with its variables and network alias", () => {
    const compose = imageStack({ appName: "web-x1", image: "nginx:alpine" });
    expect(parseManaged(compose)).toEqual({ kind: "image", image: "nginx:alpine" });
    expect(compose).toContain("services:\n  app:\n    image: nginx:alpine\n");
    expect(compose).toContain("    env_file:\n      - .env\n");
    expect(compose).toContain("    networks:\n      dokploy-network:\n        aliases:\n          - web-x1\n");
    expect(compose).toContain("\nnetworks:\n  dokploy-network:\n    external: true\n");
  });
});
