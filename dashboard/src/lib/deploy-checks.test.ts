import { spawnSync } from "node:child_process";
import { load, dump } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  composeDeployChecksSupport,
  DEFAULT_DEPLOY_CHECKS,
  mapApplicationChecks,
  mapComposeChecks,
  PREDEPLOY_SERVICE,
  readApplicationChecks,
  readComposeChecks,
  validateDeployChecks,
} from "./deploy-checks";

const settings = { ...DEFAULT_DEPLOY_CHECKS, healthcheckPath: "/ready", healthcheckPort: 8080 };
const source = `services:
  web:
    image: example:latest
    command: [node, server.js]
    entrypoint: [custom-entrypoint]
    ports: ["8080:8080"]
    labels: {traefik.enable: "true"}
    container_name: original-web
    environment: {DATABASE_URL: postgres://db/example}
    working_dir: /app
    user: "1000"
    volumes: [data:/data]
    networks: [internal]
volumes:
  data: {}
networks:
  internal: {}
`;

function parsed(file: string) {
  return load(file) as {
    services: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
}

describe("deploy check validation", () => {
  it.each([null, undefined, "settings", []])("rejects invalid settings shape %j", (input) => {
    expect(() => validateDeployChecks(input as unknown as typeof settings)).toThrow("must be an object");
  });

  it("normalizes whitespace and permits query strings", () => {
    expect(validateDeployChecks({ ...settings, healthcheckPath: " /ready?deep=true ", preDeployCommand: " npm run migrate\n" }))
      .toEqual({ ...settings, healthcheckPath: "/ready?deep=true", preDeployCommand: "npm run migrate" });
  });

  it.each(["ready", "https://example.test/ready", "//example.test/ready", "/bad path", "/bad\npath", "/bad\tpath", "/bad#fragment", "/bad\\path", "/é", `/${"a".repeat(2048)}`])("rejects invalid path %j", (healthcheckPath) => {
    expect(() => validateDeployChecks({ ...settings, healthcheckPath })).toThrow("Healthcheck path");
  });

  it.each([4, 601, 5.5, NaN, Infinity])("rejects timeout %s", (healthcheckTimeout) => {
    expect(() => validateDeployChecks({ ...settings, healthcheckTimeout })).toThrow("timeout");
  });

  it.each([0, 65536, 1.5, NaN, Infinity])("rejects port %s", (healthcheckPort) => {
    expect(() => validateDeployChecks({ ...settings, healthcheckPort })).toThrow("port");
  });

  it("accepts boundary values and empty checks", () => {
    expect(validateDeployChecks({ ...DEFAULT_DEPLOY_CHECKS, healthcheckTimeout: 5, healthcheckPort: 1 })).toMatchObject({ healthcheckPath: "", preDeployCommand: "" });
    expect(validateDeployChecks({ ...settings, healthcheckTimeout: 600, healthcheckPort: 65535 })).toMatchObject({ healthcheckTimeout: 600, healthcheckPort: 65535 });
  });

  it.each(["echo\0bad", "a".repeat(4097)])("rejects invalid pre-deploy command", (preDeployCommand) => {
    expect(() => validateDeployChecks({ ...settings, preDeployCommand })).toThrow("Pre-deploy command");
  });

  it("rejects invalid service names", () => {
    expect(() => validateDeployChecks({ ...settings, serviceName: "web;echo" })).toThrow("service name");
    expect(() => validateDeployChecks({ ...settings, serviceName: 123 as unknown as string })).toThrow("service name");
  });
});

describe("application healthcheck mapping", () => {
  it("maps to native Docker nanoseconds and round trips only its own probe", () => {
    const mapped = mapApplicationChecks(settings);
    expect(mapped.healthCheckSwarm).toMatchObject({ Interval: 1_000_000_000, Timeout: 1_000_000_000, StartPeriod: 0, Retries: 60 });
    expect(mapped.healthCheckSwarm?.Test?.[0]).toBe("CMD-SHELL");
    expect(mapped.healthCheckSwarm?.Test?.[1]).toContain("http://127.0.0.1:8080/ready");
    expect(readApplicationChecks(mapped.healthCheckSwarm)).toEqual(settings);
    expect(readApplicationChecks({ Test: ["CMD-SHELL", "custom-check"] })).toBeNull();
    expect(readApplicationChecks({ ...mapped.healthCheckSwarm, Timeout: 5_000_000_000 })).toBeNull();
  });

  it.each([200, 204, 299, 301, 404, 500, 0])("requires a 2xx HTTP response (%s)", (status) => {
    const command = mapApplicationChecks(settings).healthCheckSwarm!.Test![1];
    const run = spawnSync("/bin/sh", ["-c", `curl() { printf '%s' '${status}'; }; ${command}`]);
    expect(run.status).toBe(status >= 200 && status < 300 ? 0 : 1);
    expect(command).not.toContain("--location");
  });

  it("fails when curl fails even if its output looks successful", () => {
    const command = mapApplicationChecks(settings).healthCheckSwarm!.Test![1];
    expect(spawnSync("/bin/sh", ["-c", `curl() { printf 200; return 7; }; ${command}`]).status).toBe(7);
  });

  it("ignores curl configuration, proxies, and URL glob expansion", () => {
    const command = mapApplicationChecks({ ...settings, healthcheckPath: "/ready?range=[1-3]&choice={a,b}" }).healthCheckSwarm!.Test![1];
    const run = spawnSync("/bin/sh", ["-c", `curl() { printf '%s\\n' "$@" >&2; printf 200; }; ${command}`], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stderr.split("\n").slice(0, 4)).toEqual(["--disable", "--noproxy", "*", "--globoff"]);
    expect(run.stderr).toContain("--url\nhttp://127.0.0.1:8080/ready?range=[1-3]&choice={a,b}\n");
  });

  it("quotes path text instead of executing it", () => {
    const input = { ...settings, healthcheckPath: "/quote'$(exit)/ready?x=$HOME" };
    const healthcheck = mapApplicationChecks(input).healthCheckSwarm!;
    expect(readApplicationChecks(healthcheck)).toEqual(input);
    const run = spawnSync("/bin/sh", ["-c", `curl() { for arg do last="$arg"; done; printf '%s' "$last" >&2; printf 200; }; ${healthcheck.Test![1]}`], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe(`http://127.0.0.1:8080${input.healthcheckPath}`);
  });

  it("clears native healthchecks and refuses an unsupported application hook", () => {
    expect(mapApplicationChecks(DEFAULT_DEPLOY_CHECKS)).toEqual({ healthCheckSwarm: null });
    expect(readApplicationChecks(null)).toEqual(DEFAULT_DEPLOY_CHECKS);
    expect(() => mapApplicationChecks({ ...settings, preDeployCommand: "npm run migrate" })).toThrow("not supported");
  });
});

describe("Compose deploy check mapping", () => {
  it("adds a gated migration job and healthcheck with literal Compose dollars", () => {
    const input = { ...settings, healthcheckPath: "/ready?token=$value", preDeployCommand: "test \"$MODE\" = ready && npm run migrate", serviceName: "web" };
    const mapped = mapComposeChecks(source, "hc-proof", null, input);
    const document = parsed(mapped.composeFile);
    const web = document.services.web;
    const job = document.services[PREDEPLOY_SERVICE];
    expect(web.command).toEqual(["node", "server.js"]);
    expect(web.entrypoint).toEqual(["custom-entrypoint"]);
    expect(web.depends_on).toEqual({ [PREDEPLOY_SERVICE]: { condition: "service_completed_successfully" } });
    expect(web.healthcheck).toMatchObject({ interval: "1s", timeout: "1s", start_period: "0s", retries: 60 });
    expect((web.healthcheck as { test: string[] }).test[1]).toContain("status=$$(");
    expect((web.healthcheck as { test: string[] }).test[1]).toContain("token=$$value");
    expect(job).toEqual({
      image: "example:latest", environment: { DATABASE_URL: "postgres://db/example" },
      working_dir: "/app", user: "1000", volumes: ["data:/data"], networks: ["internal"],
      entrypoint: ["/bin/sh", "-c"], command: ["test \"$$MODE\" = ready && npm run migrate"],
      restart: "no", healthcheck: { disable: true },
    });
    expect(mapped.command).toBe("compose -p 'hc-proof' -f docker-compose.yml up -d --build --remove-orphans --force-recreate --wait --wait-timeout 60");
    expect(readComposeChecks(mapped.composeFile)).toEqual(input);
    expect(composeDeployChecksSupport(mapped.composeFile, "raw")).toEqual({ supported: true, serviceName: "web" });
  });

  it("maps build and runtime inputs without copying routing or the long-running command", () => {
    const mapped = mapComposeChecks("services:\n  web:\n    build: .\n    env_file: .env\n    secrets: [db_password]\n    configs: [config]\n", "hc-proof", "", { ...DEFAULT_DEPLOY_CHECKS, preDeployCommand: "exit 1" });
    expect(parsed(mapped.composeFile).services[PREDEPLOY_SERVICE]).toMatchObject({ build: ".", env_file: ".env", secrets: ["db_password"], configs: ["config"], command: ["exit 1"] });
    expect(parsed(mapped.composeFile).services.web.healthcheck).toBeUndefined();
  });

  it("updates settings without accumulating helper services or metadata", () => {
    const first = mapComposeChecks(source, "hc-proof", null, { ...settings, preDeployCommand: "exit 0" });
    const second = mapComposeChecks(first.composeFile, "hc-proof", first.command, { ...settings, healthcheckPath: "/other", healthcheckTimeout: 15 });
    expect(Object.keys(parsed(second.composeFile).services)).toEqual(["web"]);
    expect(parsed(second.composeFile).services.web.depends_on).toBeUndefined();
    expect(readComposeChecks(second.composeFile)).toEqual({ ...settings, healthcheckPath: "/other", healthcheckTimeout: 15, serviceName: "web" });
    expect(second.command).toContain("--wait-timeout 15");
  });

  it.each([null, ""]) ("restores original configuration when cleared (command %j)", (originalCommand) => {
    const first = mapComposeChecks(source, "hc-proof", originalCommand, { ...settings, preDeployCommand: "exit 0" });
    const cleared = mapComposeChecks(first.composeFile, "hc-proof", first.command, DEFAULT_DEPLOY_CHECKS);
    expect(parsed(cleared.composeFile)).toEqual(parsed(source));
    expect(cleared.command).toBe(originalCommand);
    expect(readComposeChecks(cleared.composeFile)).toBeNull();
  });

  it("leaves an unconfigured file byte-for-byte unchanged", () => {
    expect(mapComposeChecks(source, "hc-proof", null, DEFAULT_DEPLOY_CHECKS)).toEqual({ composeFile: source, command: null });
  });

  it("refuses custom deploy commands, unsafe project names and mismatched service selection", () => {
    expect(() => mapComposeChecks(source, "hc-proof", "compose up -d", settings)).toThrow("custom Compose deploy command");
    expect(() => mapComposeChecks(source, "hc-proof;echo", null, settings)).toThrow("project name");
    expect(() => mapComposeChecks(source, "hc-proof", null, { ...settings, serviceName: "other" })).toThrow("does not match");
  });

  it.each([
    "include: [other.yaml]\nservices: {web: {image: example}}",
    "services: {web: {image: example}, db: {image: postgres}}",
    "services: {sy-predeploy: {image: example}}",
    "services: {web: {image: example, profiles: [optional]}}",
    "services: {web: {extends: other}}",
    "services: {web: {image: example, network_mode: host}}",
    "services: {web: {image: example, healthcheck: {disable: true}}}",
    "services: {web: {image: example, depends_on: [db]}}",
    "services: {web: {}}",
    "services: []",
    "[invalid YAML",
  ])("refuses unsupported Compose layouts", (file) => {
    expect(composeDeployChecksSupport(file, "raw").supported).toBe(false);
    expect(() => mapComposeChecks(file, "hc-proof", null, settings)).toThrow();
  });

  it("refuses non-raw source and reports invalid files without claiming checks exist", () => {
    expect(composeDeployChecksSupport(source, "git").supported).toBe(false);
    expect(readComposeChecks("[invalid YAML")).toBeNull();
    expect(readComposeChecks(source)).toBeNull();
  });

  it.each(["probe", "job", "dependency", "metadata", "include"]) ("rejects externally changed %s rather than claiming checks are configured", (changed) => {
    const first = mapComposeChecks(source, "hc-proof", null, { ...settings, preDeployCommand: "exit 0" });
    const document = parsed(first.composeFile);
    if (changed === "probe") document.services.web.healthcheck = { test: ["CMD", "true"] };
    if (changed === "job") document.services[PREDEPLOY_SERVICE].command = ["exit 9"];
    if (changed === "dependency") delete document.services.web.depends_on;
    if (changed === "metadata") document["x-switchyard-deploy-checks"] = { version: 2 };
    if (changed === "include") document.include = ["other.yaml"];
    const file = dump(document);
    expect(readComposeChecks(file)).toBeNull();
    expect(composeDeployChecksSupport(file, "raw").supported).toBe(false);
    expect(() => mapComposeChecks(file, "hc-proof", first.command, settings)).toThrow();
  });

  it("refuses a deploy command changed after configuring checks", () => {
    const first = mapComposeChecks(source, "hc-proof", null, settings);
    expect(() => mapComposeChecks(first.composeFile, "hc-proof", "compose up -d", settings)).toThrow("changed outside Settings");
  });
});
