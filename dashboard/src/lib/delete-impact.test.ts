import { describe, expect, it } from "vitest";

import {
  deleteImpact,
  nameMatches,
  pluralize,
  serviceDeleteImpact,
  type ImpactService,
} from "./delete-impact";

const emptyApp: ImpactService = {
  kind: "application",
  env: null,
  domains: [],
  mounts: [],
  deployments: [],
};

describe("nameMatches", () => {
  it("requires an exact case-sensitive name after trimming", () => {
    expect(nameMatches("My app", "My app")).toBe(true);
    expect(nameMatches("  My app\n", " My app ")).toBe(true);
    expect(nameMatches("my app", "My app")).toBe(false);
    expect(nameMatches("My  app", "My app")).toBe(false);
    expect(nameMatches("My", "My app")).toBe(false);
    expect(nameMatches("My app extra", "My app")).toBe(false);
  });

  it("never accepts empty names", () => {
    expect(nameMatches("", "")).toBe(false);
    expect(nameMatches("  ", " \n")).toBe(false);
    expect(nameMatches("", "app")).toBe(false);
  });
});

describe("pluralize", () => {
  it("handles zero, singular, plural, and irregular plurals", () => {
    expect(pluralize(0, "service")).toBe("0 services");
    expect(pluralize(1, "service")).toBe("1 service");
    expect(pluralize(3, "service")).toBe("3 services");
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });
});

describe("deleteImpact", () => {
  const app: ImpactService = {
    ...emptyApp,
    env: "APP_PORT=8080\nMODE=test",
    domains: [{}, {}],
    mounts: [{ type: "volume" }],
    deployments: [{}, {}],
  };
  const compose: ImpactService = {
    ...emptyApp,
    kind: "compose",
    env: "WORKERS=1",
    mounts: [{ type: "bind" }, { type: "file" }],
    deployments: [{}],
  };
  const database: ImpactService = {
    kind: "database",
    env: null,
    mounts: [{ type: "volume" }],
    deployments: [],
  };

  it("aggregates all service kinds in a project without counting database domains", () => {
    expect(deleteImpact([app, compose, database], 2)).toEqual([
      "2 environments",
      "3 services",
      "2 domains",
      "2 attached volumes",
      "2 other mounts",
      "3 environment variables",
      "3 deployments",
      "Compose-defined containers and volumes (additional to attached mounts)",
    ]);
  });

  it("summarizes only the supplied environment services", () => {
    expect(deleteImpact([compose, database])).toEqual([
      "2 services",
      "1 attached volume",
      "2 other mounts",
      "1 environment variable",
      "1 deployment",
      "Compose-defined containers and volumes (additional to attached mounts)",
    ]);
  });

  it("describes empty scopes without inventing lost resources", () => {
    expect(deleteImpact([], 0)).toEqual(["0 environments", "0 services"]);
    expect(deleteImpact([])).toEqual(["0 services"]);
  });

  it("keeps known counts and marks unloaded data instead of calling it zero", () => {
    const unloadedDatabase: ImpactService = { kind: "database", env: null };
    expect(deleteImpact([app, unloadedDatabase])).toEqual([
      "2 services",
      "2 domains",
      "1 volume",
      "2 environment variables",
      "2 deployments",
      "Volumes and mounts (count unavailable for some services)",
      "Deployments (count unavailable for some services)",
    ]);
  });
});

describe("serviceDeleteImpact", () => {
  it("does not imply empty attached mounts mean a compose stack has no volumes", () => {
    expect(serviceDeleteImpact({ ...emptyApp, kind: "compose" })).toEqual([
      "Service configuration and containers",
      "0 domains",
      "0 attached volumes",
      "0 other mounts",
      "0 environment variables",
      "0 deployments",
      "Compose-defined containers and volumes (additional to attached mounts)",
    ]);
  });

  it("keeps compose-defined resources distinct when attached mount counts are unavailable", () => {
    expect(serviceDeleteImpact({ ...emptyApp, kind: "compose", mounts: undefined })).toEqual([
      "Service configuration and containers",
      "0 domains",
      "0 environment variables",
      "0 deployments",
      "Compose-defined containers and volumes (additional to attached mounts)",
      "Attached volumes and mounts (count unavailable for some services)",
    ]);
  });

  it("includes service configuration even when all loaded collections are empty", () => {
    expect(serviceDeleteImpact(emptyApp)).toEqual([
      "Service configuration and containers",
      "0 domains",
      "0 volumes",
      "0 other mounts",
      "0 environment variables",
      "0 deployments",
    ]);
  });

  it("distinguishes volume attachments from bind and file mounts", () => {
    expect(serviceDeleteImpact({
      ...emptyApp,
      domains: [{}],
      mounts: [{ type: "volume" }, { type: "bind" }, { type: "file" }],
      deployments: [{}],
    })).toEqual([
      "Service configuration and containers",
      "1 domain",
      "1 volume",
      "2 other mounts",
      "0 environment variables",
      "1 deployment",
    ]);
  });

  it("counts distinct variables without exposing values or counting comments", () => {
    expect(serviceDeleteImpact({
      ...emptyApp,
      env: "# COMMENT=ignored\r\n\r\nTOKEN=private-value\r\nTOKEN=replaced\r\n export EMPTY=\r\ninvalid line\r\n  # SKIP=value",
    })).toEqual([
      "Service configuration and containers",
      "0 domains",
      "0 volumes",
      "0 other mounts",
      "2 environment variables",
      "0 deployments",
    ]);
  });

  it("ignores assignment-like lines inside multiline quoted values", () => {
    expect(serviceDeleteImpact({
      ...emptyApp,
      env: [
        'CERT="first line',
        "NOT_A_VARIABLE=value",
        '# a comment inside a value"',
        "SINGLE='first",
        "ALSO_NOT_A_VARIABLE=value'",
        'ESCAPED="a \\" quote',
        'STILL_NOT_A_VARIABLE=value"',
        "FINAL=ok # comment",
      ].join("\n"),
    })).toEqual([
      "Service configuration and containers",
      "0 domains",
      "0 volumes",
      "0 other mounts",
      "4 environment variables",
      "0 deployments",
    ]);
  });

  it("reports each missing collection rather than silently hiding unknown impact", () => {
    expect(serviceDeleteImpact({ kind: "application" })).toEqual([
      "Service configuration and containers",
      "Domains (count unavailable for some services)",
      "Volumes and mounts (count unavailable for some services)",
      "Environment variables (count unavailable for some services)",
      "Deployments (count unavailable for some services)",
    ]);
  });
});
