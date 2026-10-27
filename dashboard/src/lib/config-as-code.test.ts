import { describe, expect, it } from "vitest";
import {
  CONFIG_FILES,
  dashboardConfig,
  parseConfigFile,
  resolveConfig,
  selectConfigFile,
  type RepoConfig,
} from "./config-as-code";

const completeConfig: RepoConfig = {
  build: {
    builder: "NIXPACKS",
    buildCommand: "npm run build",
    dockerfilePath: "docker/Dockerfile",
  },
  deploy: {
    startCommand: "npm start",
    preDeployCommand: ["npm run migrate", "npm run seed"],
    healthcheckPath: "/health",
    healthcheckTimeout: 120,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 3,
    cronSchedule: "0 0 * * *",
  },
};

describe("parseConfigFile JSON", () => {
  it.each(["switchyard.json", "railway.json"] as const)("reads every supported field from %s", (file) => {
    expect(parseConfigFile(file, JSON.stringify(completeConfig))).toEqual({
      file, config: completeConfig, warnings: [], errors: [],
    });
  });

  it("accepts empty configs and sections", () => {
    expect(parseConfigFile("switchyard.json", "{}").config).toEqual({});
    expect(parseConfigFile("switchyard.json", '{"build":{},"deploy":{}}').errors).toEqual([]);
  });

  it.each(["NIXPACKS", "DOCKERFILE", "RAILPACK"])("accepts builder %s", (builder) => {
    const parsed = parseConfigFile("switchyard.json", JSON.stringify({ build: { builder } }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.build?.builder).toBe(builder);
  });

  it.each(["ALWAYS", "ON_FAILURE", "NEVER"])("accepts restart policy %s", (restartPolicyType) => {
    const parsed = parseConfigFile("switchyard.json", JSON.stringify({ deploy: { restartPolicyType } }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.deploy?.restartPolicyType).toBe(restartPolicyType);
  });

  it.each(["npm run migrate", [], ["npm run migrate"]])("accepts preDeployCommand %j", (preDeployCommand) => {
    const parsed = parseConfigFile("switchyard.json", JSON.stringify({ deploy: { preDeployCommand } }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.deploy?.preDeployCommand).toEqual(preDeployCommand);
  });

  it("preserves command whitespace, Unicode, and newlines", () => {
    const startCommand = "  echo café\necho 🌱  ";
    const parsed = parseConfigFile("switchyard.json", JSON.stringify({ deploy: { startCommand } }));
    expect(parsed.config.deploy?.startCommand).toBe(startCommand);
  });

  it("warns for unknown root and nested keys without rejecting known values", () => {
    const parsed = parseConfigFile("switchyard.json", JSON.stringify({
      $schema: "schema-reference",
      other: { arbitrary: [1, null] },
      build: { builder: "DOCKERFILE", unknown: true },
      deploy: { startCommand: "node app.js", replicas: 3 },
    }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([
      "Unknown key: $schema", "Unknown key: other", "Unknown key: build.unknown", "Unknown key: deploy.replicas",
    ]);
    expect(parsed.config).toEqual({ build: { builder: "DOCKERFILE" }, deploy: { startCommand: "node app.js" } });
  });

  it.each(["", "{", '{"build":}', '{"build":{}} trailing', '{"build":{},}', "// comment\n{}"])("rejects invalid JSON %j", (text) => {
    const parsed = parseConfigFile("switchyard.json", text);
    expect(parsed.config).toEqual({});
    expect(parsed.errors).toHaveLength(1);
  });

  it.each(["null", "[]", "false", "12", '"text"'])("rejects non-object root %s", (text) => {
    expect(parseConfigFile("switchyard.json", text).errors).toEqual(["Config must be an object"]);
  });

  it.each([null, [], true, 12, "invalid"])("rejects invalid section %j", (build) => {
    expect(parseConfigFile("switchyard.json", JSON.stringify({ build })).errors).toEqual(["build must be an object"]);
  });

  const invalidFields = [
    ["build", "builder", "nixpacks"], ["build", "builder", "PACKS"], ["build", "builder", ["NIXPACKS"]],
    ["build", "builder", { toString: null }], ["build", "buildCommand", 42], ["build", "buildCommand", null],
    ["build", "dockerfilePath", "/Dockerfile"], ["build", "dockerfilePath", "../Dockerfile"],
    ["build", "dockerfilePath", "dir/../Dockerfile"], ["build", "dockerfilePath", "C:\\Dockerfile"],
    ["build", "dockerfilePath", "..\\Dockerfile"], ["build", "dockerfilePath", "Dockerfile\n"],
    ["deploy", "startCommand", 42], ["deploy", "startCommand", null], ["deploy", "startCommand", "echo\0x"],
    ["deploy", "preDeployCommand", ["migrate", 1]], ["deploy", "preDeployCommand", [""]],
    ["deploy", "preDeployCommand", {}], ["deploy", "healthcheckPath", "https://example.test"],
    ["deploy", "healthcheckPath", "health"], ["deploy", "healthcheckPath", "/health\nheader"],
    ["deploy", "healthcheckTimeout", 0], ["deploy", "healthcheckTimeout", -1],
    ["deploy", "healthcheckTimeout", 1.5], ["deploy", "healthcheckTimeout", "30"],
    ["deploy", "healthcheckTimeout", Number.MAX_SAFE_INTEGER + 1],
    ["deploy", "restartPolicyType", "sometimes"], ["deploy", "restartPolicyType", ["ALWAYS"]],
    ["deploy", "restartPolicyMaxRetries", -1], ["deploy", "restartPolicyMaxRetries", 0.5],
    ["deploy", "restartPolicyMaxRetries", "0"], ["deploy", "restartPolicyMaxRetries", null],
    ["deploy", "cronSchedule", "@daily"], ["deploy", "cronSchedule", "* * * *"],
    ["deploy", "cronSchedule", "* * * * * *"], ["deploy", "cronSchedule", ""],
  ] as const;
  it.each(invalidFields)("rejects invalid %s.%s = %j atomically", (section, key, value) => {
    const parsed = parseConfigFile("switchyard.json", JSON.stringify({
      build: { builder: "NIXPACKS" }, deploy: { startCommand: "node app.js" },
      [section]: { [key]: value },
    }));
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain(`${section}.${key}`);
    expect(parsed.config).toEqual({});
  });

  it("collects independent validation errors and warnings", () => {
    const parsed = parseConfigFile("switchyard.json", '{"build":{"builder":false,"unknown":0},"deploy":{"healthcheckTimeout":0,"startCommand":null}}');
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.warnings).toEqual(["Unknown key: build.unknown"]);
    expect(parsed.config).toEqual({});
  });

  it.each(CONFIG_FILES)("bounds file size in bytes for %s", (file) => {
    const text = file.endsWith("json") ? JSON.stringify({ unknown: "é".repeat(33_000) }) : `unknown = '${"é".repeat(33_000)}'`;
    expect(parseConfigFile(file, text).errors[0]).toContain("64 KiB");
  });

  it("keeps prototype-like JSON keys inert", () => {
    const parsed = parseConfigFile("switchyard.json", '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"build":{"__proto__":{"polluted":true},"builder":"NIXPACKS"}}');
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toHaveLength(3);
    expect(parsed.config).toEqual({ build: { builder: "NIXPACKS" } });
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});

describe("parseConfigFile TOML", () => {
  it("reads every supported field with comments, multiline arrays, and trailing commas", () => {
    const text = `# repository deployment\n[build]\nbuilder = "NIXPACKS"\nbuildCommand = 'npm run build'\ndockerfilePath = "docker/Dockerfile"\n\n[deploy] # deployment\nstartCommand = "npm start"\npreDeployCommand = [\n  'npm run migrate', # first\n  "npm run seed",\n]\nhealthcheckPath = '/health'\nhealthcheckTimeout = 120\nrestartPolicyType = 'ON_FAILURE'\nrestartPolicyMaxRetries = 3\ncronSchedule = '0 0 * * *'`;
    expect(parseConfigFile("railway.toml", text)).toEqual({
      file: "railway.toml", config: completeConfig, warnings: [], errors: [],
    });
  });

  it("supports dotted and quoted keys, whitespace, and CRLF", () => {
    const text = `build . "builder" = 'DOCKERFILE'\r\n'deploy'.startCommand = "node app.js"\r\n`;
    expect(parseConfigFile("railway.toml", text).config).toEqual({
      build: { builder: "DOCKERFILE" }, deploy: { startCommand: "node app.js" },
    });
  });

  it("allows different dotted keys in the same implicit table", () => {
    const parsed = parseConfigFile("railway.toml", 'build.builder="DOCKERFILE"\nbuild.dockerfilePath="Dockerfile"');
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.build).toEqual({ builder: "DOCKERFILE", dockerfilePath: "Dockerfile" });
  });

  it("does not interpret dots inside quoted keys as paths", () => {
    const parsed = parseConfigFile("railway.toml", '"build.builder" = "NIXPACKS"');
    expect(parsed.config).toEqual({});
    expect(parsed.warnings).toEqual(["Unknown key: build.builder"]);
  });

  it("preserves #, =, commas, brackets, and backslashes inside strings", () => {
    const parsed = parseConfigFile("railway.toml", String.raw`deploy.startCommand = 'echo # a=b,[c] \path' # comment`);
    expect(parsed.config.deploy?.startCommand).toBe(String.raw`echo # a=b,[c] \path`);
  });

  it("supports basic-string escapes and Unicode scalar escapes", () => {
    const parsed = parseConfigFile("railway.toml", String.raw`deploy.startCommand = "echo \"hello\" \\ \t\n\r\b\f \u00E9 \U0001F331"`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.deploy?.startCommand).toBe('echo "hello" \\ \t\n\r\b\f é 🌱');
  });

  it("supports multiline basic strings and escaped line continuations", () => {
    const parsed = parseConfigFile("railway.toml", 'deploy.startCommand = """\necho one\necho \\\n    two"""');
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.deploy?.startCommand).toBe("echo one\necho two");
  });

  it("supports multiline literal strings and embedded quotes", () => {
    const parsed = parseConfigFile("railway.toml", "deploy.startCommand = '''\necho 'one'\necho \\two'''\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.deploy?.startCommand).toBe("echo 'one'\necho \\two");
  });

  it("supports up to two quotes immediately before multiline closing quotes", () => {
    expect(parseConfigFile("railway.toml", 'deploy.startCommand = """echo ""hello"""""').config.deploy?.startCommand).toBe('echo ""hello""');
  });

  it("supports decimal separators, signed numbers, and exponent notation", () => {
    const parsed = parseConfigFile("railway.toml", '[deploy]\nhealthcheckTimeout = +1_200\nrestartPolicyMaxRetries = 0e0\nunknown = -1.2e+3');
    expect(parsed.errors).toEqual([]);
    expect(parsed.config.deploy).toEqual({ healthcheckTimeout: 1200, restartPolicyMaxRetries: 0 });
    expect(parsed.warnings).toEqual(["Unknown key: deploy.unknown"]);
  });

  it("warns for unknown tables, booleans, nested arrays, and keys", () => {
    const parsed = parseConfigFile("railway.toml", '[build]\nbuilder="NIXPACKS"\nwatch=true\n[extra.nested]\nlist=[[1, 2], [false]]\n[extra]\nflag=false');
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual(["Unknown key: build.watch", "Unknown key: extra"]);
    expect(parsed.config).toEqual({ build: { builder: "NIXPACKS" } });
  });

  it("accepts an empty file and comment-only file", () => {
    expect(parseConfigFile("railway.toml", "").errors).toEqual([]);
    expect(parseConfigFile("railway.toml", "# comment\n \t# another").errors).toEqual([]);
  });

  it("applies the same schema validation as JSON", () => {
    const parsed = parseConfigFile("railway.toml", '[deploy]\nhealthcheckTimeout = 0\nstartCommand = "npm start"');
    expect(parsed.errors).toEqual(["deploy.healthcheckTimeout must be a positive integer (seconds)"]);
    expect(parsed.config).toEqual({});
  });

  const malformed = [
    'build.builder = "NIXPACKS', 'build.builder = "NIX\nPACKS"',
    'build.builder = "NIXPACKS"\nbuild.builder="DOCKERFILE"',
    '[build]\nbuilder="NIXPACKS"\n[build]\nbuilder="DOCKERFILE"',
    'build.builder="NIXPACKS"\n[build]', 'build="NIXPACKS"\n[build]',
    '[build]\nbuilder="NIXPACKS"\n[build.builder]',
    '[build]\nbuilder="NIXPACKS"\nbuilder.extra=true',
    '[extra.child]\nvalue=true\n[extra]\nchild.other=true',
    '[extra.child.deep]\nvalue=true\n[extra]\nchild.other=true\n[extra.child]\nthird=true',
    'build.builder="NIXPACKS" trailing', '[build] trailing', '[build', 'build..builder="NIXPACKS"',
    'build.builder: "NIXPACKS"', 'build.builder=',
    'deploy.preDeployCommand=["one" "two"]', 'deploy.preDeployCommand=["one",',
    String.raw`deploy.startCommand="echo \x20"`, String.raw`deploy.startCommand="echo \uXYZ1"`,
    String.raw`deploy.startCommand="echo \uD800"`, String.raw`deploy.startCommand="echo \U00110000"`,
    'deploy.startCommand="""unterminated', 'deploy.startCommand="""echo""""""',
    '"""deploy""".startCommand="echo"', 'deploy.startCommand="echo\0"',
    'deploy.startCommand="echo"\r', 'deploy.healthcheckTimeout=01',
    'deploy.healthcheckTimeout=1__0', 'deploy.healthcheckTimeout=1_',
    'deploy.healthcheckTimeout=1e999', 'deploy.healthcheckTimeout=+ 1',
  ];
  it.each(malformed)("rejects malformed TOML %j", (text) => {
    const parsed = parseConfigFile("railway.toml", text);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatch(/^TOML line \d+:/);
    expect(parsed.config).toEqual({});
  });

  it.each([
    '[[services]]\nname="web"', 'deploy={startCommand="npm start"}',
    'created=2026-10-26T00:00:00Z', 'unknown=0x10', 'unknown=0o10', 'unknown=0b10', 'unknown=inf', 'unknown=nan',
  ])("explicitly rejects unsupported TOML %j", (text) => {
    expect(parseConfigFile("railway.toml", text).errors[0]).toMatch(/unsupported/i);
  });

  it("bounds array recursion", () => {
    const parsed = parseConfigFile("railway.toml", `unknown=${"[".repeat(22)}1${"]".repeat(22)}`);
    expect(parsed.errors[0]).toContain("nested too deeply");
  });

  it("bounds dotted-key nesting", () => {
    const parsed = parseConfigFile("railway.toml", `${"nested.".repeat(21)}value=true`);
    expect(parsed.errors[0]).toContain("nested too deeply");
  });

  it("keeps prototype-like TOML keys inert", () => {
    const parsed = parseConfigFile("railway.toml", '__proto__.polluted=true\nconstructor.prototype.polluted=true\n[build]\nbuilder="NIXPACKS"\n__proto__.polluted=true');
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toHaveLength(3);
    expect(parsed.config).toEqual({ build: { builder: "NIXPACKS" } });
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});

describe("config precedence", () => {
  it("selects switchyard.json before railway.json before railway.toml without merging", () => {
    const files = {
      "switchyard.json": '{"build":{"builder":"DOCKERFILE"}}',
      "railway.json": '{"deploy":{"startCommand":"node app.js"}}',
      "railway.toml": 'deploy.startCommand="npm start"',
    };
    expect(selectConfigFile(files)?.config).toEqual({ build: { builder: "DOCKERFILE" } });
    expect(selectConfigFile({ ...files, "switchyard.json": undefined })?.file).toBe("railway.json");
    expect(selectConfigFile({ "railway.toml": files["railway.toml"] })?.file).toBe("railway.toml");
    expect(selectConfigFile({})).toBeNull();
  });

  it("does not fall back from an invalid or empty preferred JSON file", () => {
    for (const contents of ["", "{", '{"build":{"builder":"invalid"}}']) {
      const parsed = selectConfigFile({ "switchyard.json": contents, "railway.json": "{}" });
      expect(parsed?.file).toBe("switchyard.json");
      expect(parsed?.errors.length).toBeGreaterThan(0);
    }
  });

  it("does not read file contents from the object's prototype", () => {
    expect(selectConfigFile(Object.create({ "switchyard.json": "{}" }))).toBeNull();
  });

  it("overrides each supplied value while preserving unspecified dashboard values", () => {
    const dashboard: RepoConfig = {
      build: { builder: "NIXPACKS", buildCommand: "dashboard build" },
      deploy: { startCommand: "dashboard start", healthcheckPath: "/ready", restartPolicyMaxRetries: 4 },
    };
    const parsed = parseConfigFile("switchyard.json", JSON.stringify({
      build: { builder: "DOCKERFILE" }, deploy: { startCommand: "file start", restartPolicyMaxRetries: 0 },
    }));
    expect(resolveConfig(dashboard, parsed)).toEqual({
      config: {
        build: { builder: "DOCKERFILE", buildCommand: "dashboard build" },
        deploy: { startCommand: "file start", healthcheckPath: "/ready", restartPolicyMaxRetries: 0 },
      },
      sources: {
        "build.builder": "switchyard.json", "build.buildCommand": "dashboard",
        "deploy.startCommand": "switchyard.json", "deploy.healthcheckPath": "dashboard",
        "deploy.restartPolicyMaxRetries": "switchyard.json",
      },
    });
  });

  it("tracks the selected filename for every supported field", () => {
    const parsed = parseConfigFile("railway.json", JSON.stringify(completeConfig));
    const resolved = resolveConfig({}, parsed);
    expect(resolved.config).toEqual(completeConfig);
    expect(Object.keys(resolved.sources)).toHaveLength(10);
    expect(new Set(Object.values(resolved.sources))).toEqual(new Set(["railway.json"]));
  });

  it("never applies any part of an invalid file", () => {
    const parsed = parseConfigFile("railway.json", '{"build":{"builder":"DOCKERFILE"},"deploy":{"healthcheckTimeout":0}}');
    expect(resolveConfig({ build: { builder: "NIXPACKS" } }, parsed)).toEqual({
      config: { build: { builder: "NIXPACKS" } }, sources: { "build.builder": "dashboard" },
    });
    parsed.config = { build: { builder: "DOCKERFILE" } };
    expect(resolveConfig({}, parsed).config).toEqual({});
  });

  it("allows an empty pre-deploy array to override the dashboard", () => {
    const parsed = parseConfigFile("railway.json", '{"deploy":{"preDeployCommand":[]}}');
    expect(resolveConfig({ deploy: { preDeployCommand: ["migrate"] } }, parsed).config.deploy?.preDeployCommand).toEqual([]);
  });

  it("allows empty commands to clear dashboard overrides", () => {
    const parsed = parseConfigFile("switchyard.json", '{"build":{"buildCommand":""},"deploy":{"startCommand":""}}');
    expect(parsed.errors).toEqual([]);
    expect(resolveConfig({ build: { buildCommand: "old build" }, deploy: { startCommand: "old start" } }, parsed)).toEqual({
      config: { build: { buildCommand: "" }, deploy: { startCommand: "" } },
      sources: { "build.buildCommand": "switchyard.json", "deploy.startCommand": "switchyard.json" },
    });
  });

  it("does not mutate or alias either input", () => {
    const dashboard: RepoConfig = { deploy: { preDeployCommand: ["dashboard migrate"] } };
    const parsed = parseConfigFile("railway.json", JSON.stringify(completeConfig));
    const resolved = resolveConfig(dashboard, parsed);
    resolved.config.build!.builder = "DOCKERFILE";
    (resolved.config.deploy!.preDeployCommand as string[]).push("changed");
    expect(parsed.config).toEqual(completeConfig);
    const fallback = resolveConfig(dashboard, parseConfigFile("switchyard.json", "{}"));
    (fallback.config.deploy!.preDeployCommand as string[]).push("changed");
    expect(dashboard.deploy?.preDeployCommand).toEqual(["dashboard migrate"]);
  });

  it("preserves explicit empty dashboard strings and skips undefined values", () => {
    const parsed = parseConfigFile("switchyard.json", "{}");
    expect(resolveConfig({ deploy: { startCommand: "", healthcheckPath: undefined } }, parsed)).toEqual({
      config: { deploy: { startCommand: "" } }, sources: { "deploy.startCommand": "dashboard" },
    });
  });

  it("ignores inherited dashboard and config fields", () => {
    const dashboard = { build: Object.create({ builder: "NIXPACKS" }) };
    const parsed = parseConfigFile("switchyard.json", "{}");
    parsed.config.build = Object.create({ builder: "DOCKERFILE" });
    expect(resolveConfig(dashboard, parsed)).toEqual({ config: {}, sources: {} });
    expect(resolveConfig(Object.create({ build: { builder: "NIXPACKS" } }), parsed).config).toEqual({});
  });
});

describe("dashboardConfig", () => {
  it.each([
    ["nixpacks", "NIXPACKS"], ["dockerfile", "DOCKERFILE"], ["railpack", "RAILPACK"],
  ])("maps dashboard builder %s", (buildType, builder) => {
    expect(dashboardConfig({ buildType, dockerfile: null, command: null }).build?.builder).toBe(builder);
  });

  it.each([null, "", "pack", "static", "constructor", "__proto__"])("omits unmapped builder %j", (buildType) => {
    expect(dashboardConfig({ buildType, dockerfile: "Dockerfile", command: null })).toEqual({});
  });

  it("includes Dockerfile defaults and custom paths only for the Dockerfile builder", () => {
    expect(dashboardConfig({ buildType: "dockerfile", dockerfile: null, command: null }).build?.dockerfilePath).toBe("Dockerfile");
    expect(dashboardConfig({ buildType: "dockerfile", dockerfile: "", command: null }).build?.dockerfilePath).toBe("Dockerfile");
    expect(dashboardConfig({ buildType: "dockerfile", dockerfile: "docker/web", command: null }).build?.dockerfilePath).toBe("docker/web");
    expect(dashboardConfig({ buildType: "nixpacks", dockerfile: "docker/web", command: null }).build?.dockerfilePath).toBeUndefined();
  });

  it.each(["", "node app.js"])("preserves the saved start command %j", (command) => {
    expect(dashboardConfig({ buildType: null, dockerfile: null, command })).toEqual({ deploy: { startCommand: command } });
  });

  it("omits a null saved command", () => {
    expect(dashboardConfig({ buildType: null, dockerfile: null, command: null })).toEqual({});
  });
});
