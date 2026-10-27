import { describe, expect, it, vi } from "vitest";
import type { Application, Database } from "./dokploy";
import { resolveServiceLogo } from "./service-logo";

vi.mock("@/app/actions", () => ({ listTemplatesAction: vi.fn() }));

function application(overrides: Partial<Application> = {}): Application {
  return {
    kind: "application",
    name: "custom-service",
    dockerImage: null,
    ...overrides,
  } as Application;
}

describe("resolveServiceLogo", () => {
  it("prefers an exact normalized service name over the suffix and image candidates", () => {
    const service = application({ name: "  Supabase-AbC123  ", dockerImage: "library/postgres:17" });
    const logos = new Map([
      ["supabase-abc123", "/catalog/exact.svg"],
      ["supabase", "/catalog/supabase.svg"],
      ["postgres", "/catalog/postgres.svg"],
    ]);
    expect(resolveServiceLogo(service, logos)).toBe("/catalog/exact.svg");
  });

  it("prefers the name without its random suffix over the image candidate", () => {
    const service = application({ name: "Supabase-abc123", dockerImage: "library/postgres:17" });
    const logos = new Map([
      ["supabase", "/catalog/supabase.svg"],
      ["postgres", "/catalog/postgres.svg"],
    ]);
    expect(resolveServiceLogo(service, logos)).toBe("/catalog/supabase.svg");
  });

  it.each(["abc", "123", "AB123C"])("strips a three-to-six-character suffix: %s", (suffix) => {
    const service = application({ name: `n8n-${suffix}` });
    expect(resolveServiceLogo(service, new Map([["n8n", "/catalog/n8n.svg"]]))).toBe("/catalog/n8n.svg");
  });

  it.each(["ab", "abc1234", "ab_cd"])("does not strip a suffix outside the existing matching rule: %s", (suffix) => {
    const service = application({ name: `n8n-${suffix}` });
    expect(resolveServiceLogo(service, new Map([["n8n", "/catalog/n8n.svg"]]))).toBeNull();
  });

  it("uses the lowercased image basename when neither name candidate matches", () => {
    const service = application({ dockerImage: "traefik/WHOAMI:latest" });
    expect(resolveServiceLogo(service, new Map([["whoami", "/catalog/whoami.svg"]]))).toBe("/catalog/whoami.svg");
  });

  it("preserves the existing catalog image parsing rule for registry ports", () => {
    const service = application({ dockerImage: "registry.example.com:5000/library/nginx:alpine" });
    expect(resolveServiceLogo(service, new Map([["nginx", "/catalog/nginx.svg"]]))).toBeNull();
  });

  it.each(["my-supabase", "supabase-derived", "supabase2", "super-supabase-project"])(
    "does not choose a logo from a partial service-name match: %s",
    (name) => {
      expect(resolveServiceLogo(application({ name }), new Map([["supabase", "/catalog/supabase.svg"]]))).toBeNull();
    },
  );

  it("does not choose a logo from a partial image-name match", () => {
    const service = application({ dockerImage: "custom/nginx-proxy:latest" });
    expect(resolveServiceLogo(service, new Map([["nginx", "/catalog/nginx.svg"]]))).toBeNull();
  });

  it("skips an empty logo value and continues to the next exact candidate", () => {
    const service = application({ name: "n8n-abc" });
    const logos = new Map([["n8n-abc", ""], ["n8n", "/catalog/n8n.svg"]]);
    expect(resolveServiceLogo(service, logos)).toBe("/catalog/n8n.svg");
  });

  it.each([null, new Map<string, string>()])("returns null until a catalog is available", (logos) => {
    expect(resolveServiceLogo(application({ name: "supabase" }), logos)).toBeNull();
  });

  it("prefers an exact catalog match for a native database", () => {
    const service = { kind: "database", name: "Supabase-abc", engine: "postgres", dockerImage: "postgres:17" } as Database;
    const logos = new Map([
      ["supabase", "/catalog/supabase.svg"],
      ["postgres", "/catalog/postgres.svg"],
    ]);
    expect(resolveServiceLogo(service, logos)).toBe("/catalog/supabase.svg");
  });

  it.each(["postgres", "mysql", "mariadb", "mongo", "redis"] as const)(
    "returns null for an unmatched native %s database instead of a CDN logo",
    (engine) => {
      const service = { kind: "database", name: "custom-database", engine, dockerImage: `${engine}:latest` } as Database;
      expect(resolveServiceLogo(service, null)).toBeNull();
      expect(resolveServiceLogo(service, new Map())).toBeNull();
      expect(resolveServiceLogo(service, new Map([["n8n", "/catalog/n8n.svg"]]))).toBeNull();
    },
  );

  it("does not add database-engine candidates beyond the existing matching rules", () => {
    const service = { kind: "database", name: "custom-database", engine: "postgres", dockerImage: null } as Database;
    expect(resolveServiceLogo(service, new Map([["postgres", "/catalog/postgres.svg"]]))).toBeNull();
  });
});
