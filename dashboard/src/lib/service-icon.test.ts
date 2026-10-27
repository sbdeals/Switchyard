import { describe, expect, it } from "vitest";
import type { Application, Database, Service } from "./dokploy";
import { dockerImageBasename, resolveServiceIcon } from "./service-icon";

function application(overrides: Partial<Application> = {}): Application {
  return {
    kind: "application",
    sourceType: "docker",
    dockerImage: null,
    ...overrides,
  } as Application;
}

describe("dockerImageBasename", () => {
  it.each([
    ["nginx", "nginx"],
    ["nginx:alpine", "nginx"],
    ["library/nginx:alpine", "nginx"],
    ["docker.io/library/NGINX:ALPINE", "nginx"],
    ["registry.example.com:5000/team/NODE:22", "node"],
    ["localhost:5000/python:3.13", "python"],
    ["[::1]:5000/library/redis:7", "redis"],
    ["ghcr.io/namespace/nested/traefik/whoami:latest", "whoami"],
    ["redis@sha256:abcdef0123456789", "redis"],
    ["registry.example.com:5000/library/POSTGRES:17@sha256:abcdef0123456789", "postgres"],
    ["  python:3.13-slim  ", "python"],
    ["custom/my_app.v2-server:RC_1", "my_app.v2-server"],
  ])("extracts the basename from %s", (reference, expected) => {
    expect(dockerImageBasename(reference)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    " ",
    "https://docker.io/library/nginx:alpine",
    "nginx :alpine",
    "nginx:al pine",
    "/nginx",
    "library//nginx",
    "library/",
    ":alpine",
    "nginx:",
    "nginx:alpine:extra",
    "nginx@",
    "nginx@sha256:",
    "nginx@sha256:abc@sha256:def",
    "@sha256:abc",
  ])("ignores empty or malformed references: %s", (reference) => {
    expect(dockerImageBasename(reference)).toBeNull();
  });
});

describe("resolveServiceIcon", () => {
  it.each(["postgres", "mysql", "mariadb", "mongo", "redis"] as const)(
    "uses the native %s engine before the image",
    (engine) => {
      const service = { kind: "database", engine, dockerImage: "nginx:alpine" } as Database;
      expect(resolveServiceIcon(service)).toBe(engine);
    },
  );

  it("retains the database fallback for an unrecognized engine", () => {
    const service = { kind: "database", engine: "unknown" } as unknown as Database;
    expect(resolveServiceIcon(service)).toBe("database");
  });

  it("identifies a compose stack before its image", () => {
    const service = { kind: "compose", dockerImage: "nginx:alpine" } as Service;
    expect(resolveServiceIcon(service)).toBe("compose");
  });

  it.each([
    ["postgres:17", "postgres"],
    ["bitnami/postgresql:17", "postgres"],
    ["mysql:8", "mysql"],
    ["mariadb:11", "mariadb"],
    ["mongo:8", "mongo"],
    ["bitnami/mongodb:8", "mongo"],
    ["redis:7", "redis"],
    ["nginx:alpine", "nginx"],
    ["node:22", "node"],
    ["custom/nodejs:22", "node"],
    ["python:3.13", "python"],
    ["traefik:v3", "traefik"],
    ["traefik/whoami:latest", "whoami"],
    ["REGISTRY.EXAMPLE.COM:5000/LIBRARY/NGINX:ALPINE@sha256:abcdef", "nginx"],
  ])("recognizes %s", (dockerImage, expected) => {
    expect(resolveServiceIcon(application({ dockerImage }))).toBe(expected);
  });

  it.each([null, "", "nginx-proxy:latest", "my-nginx:latest", "node-exporter:latest", "redis/worker:latest", "custom/app:latest", "constructor", "toString"])(
    "keeps the application fallback for an unknown image: %s",
    (dockerImage) => {
      expect(resolveServiceIcon(application({ dockerImage }))).toBe("application");
    },
  );

  it("uses an image when the application source is unspecified", () => {
    expect(resolveServiceIcon(application({ sourceType: null, dockerImage: "nginx:alpine" }))).toBe("nginx");
  });

  it("identifies GitHub even when an old Docker image remains", () => {
    expect(resolveServiceIcon(application({ sourceType: "github", dockerImage: "nginx:alpine" }))).toBe("github");
  });

  it.each([
    "https://github.com/owner/repo.git",
    "https://GITHUB.COM/owner/repo",
    "http://github.com/owner/repo",
    "ssh://git@github.com/owner/repo.git",
    "git://github.com/owner/repo.git",
    "git@github.com:owner/repo.git",
    "git@GITHUB.COM:owner/repo",
    "  https://github.com/owner/repo.git  ",
  ])("recognizes an explicit custom GitHub clone URL: %s", (gitUrl) => {
    expect(resolveServiceIcon(application({ sourceType: "git", gitUrl, dockerImage: "nginx:alpine" }))).toBe("github");
  });

  it("uses a repository URL when a custom Git app has no clone URL", () => {
    expect(resolveServiceIcon(application({ sourceType: "git", gitUrl: null, repository: "https://github.com/owner/repo" }))).toBe("github");
  });

  it("uses the active custom clone URL before a stale repository field", () => {
    expect(resolveServiceIcon(application({
      sourceType: "git",
      gitUrl: "https://gitlab.com/owner/repo",
      repository: "https://github.com/owner/repo",
    }))).toBe("application");
  });

  it.each([
    "owner/repo",
    "https://github.com.evil.example/owner/repo",
    "https://evil.example/github.com/repo",
    "https://github.com@evil.example/owner/repo",
    "https://gitlab.com/github/repo",
    "git@github.com.evil.example:owner/repo",
    "https://github.com/",
    "ftp://github.com/owner/repo",
  ])("does not mistake a non-GitHub clone reference for GitHub: %s", (gitUrl) => {
    expect(resolveServiceIcon(application({ sourceType: "git", gitUrl }))).toBe("application");
  });

  it.each(["git", "gitlab", "bitbucket", "gitea"] as const)(
    "ignores a stale Docker image for the %s source",
    (sourceType) => {
      expect(resolveServiceIcon(application({ sourceType, dockerImage: "nginx:alpine" }))).toBe("application");
    },
  );

  it("does not infer icons from a user-assigned service name", () => {
    expect(resolveServiceIcon(application({ name: "postgres", dockerImage: "custom/app:latest" }))).toBe("application");
  });
});
