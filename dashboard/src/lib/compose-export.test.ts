import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCompose, generateDockerRun, type ComposeExportInput } from "./compose-export";

function app(patch: Partial<ComposeExportInput> = {}): ComposeExportInput {
  return {
    name: "Compose Export",
    sourceType: "docker",
    dockerImage: "nginx:alpine",
    environment: [],
    ports: [],
    mounts: [],
    cpuLimit: null,
    memoryLimit: null,
    restartPolicySwarm: null,
    ...patch,
  };
}

function shellArguments(command: string, env: Record<string, string> = {}): string[] {
  // A shell function captures argv; this never starts a Docker container.
  const result = spawnSync("/bin/sh", ["-c", `docker() { printf '%s\\0' "$@"; }\n${command}`], {
    encoding: "utf8",
    env,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.split("\0").slice(0, -1);
}

describe("generateCompose", () => {
  it("masks omitted values, preserves empty values, and escapes literal Compose interpolation", () => {
    const output = generateCompose(app({ environment: [
      { key: "TOKEN" },
      { key: "EMPTY", value: "" },
      { key: "LITERAL", value: "${TOKEN} $HOME $$" },
      { key: "WITH.DOT" },
    ] }));
    expect(output).toContain('"TOKEN": "${TOKEN}"');
    expect(output).toContain('"EMPTY": ""');
    expect(output).toContain('"LITERAL": "$${TOKEN} $$HOME $$$$"');
    expect(output).toContain('"WITH.DOT": "REPLACE_ME"');
    expect(output).toContain("set those values manually");
  });

  it("quotes YAML metacharacters, line breaks, control characters and keys", () => {
    const output = generateCompose(app({ environment: [
      { key: "KEY: #", value: '*alias &anchor !tag #comment: "quote" \\\nnext\r\t\u0085\u2028\u2029' },
    ] }));
    expect(output).toContain('"KEY: #": "*alias &anchor !tag #comment: \\"quote\\" \\\\\\nnext\\r\\t\\u0085\\u2028\\u2029"');
    expect(output).not.toContain("\nnext");
  });

  it("exports ports, deduplicated named volumes, bind mounts and file notes without contents", () => {
    const output = generateCompose(app({
      ports: [{ publishedPort: 3068, targetPort: 80, protocol: "tcp", publishMode: "host" }, { publishedPort: 5353, targetPort: 53, protocol: "udp", publishMode: "ingress" }],
      mounts: [
        { type: "volume", volumeName: "compose-export-data", mountPath: "/data", hostPath: null, filePath: null },
        { type: "volume", volumeName: "compose-export-data", mountPath: "/backup", hostPath: null, filePath: null },
        { type: "bind", volumeName: null, mountPath: "/config", hostPath: "/tmp/path: #$HOME", filePath: null },
        { type: "file", volumeName: null, mountPath: "/etc/config\nmalicious: value", hostPath: null, filePath: "config\nfile" },
      ],
    }));
    expect(output).toContain('"target": "80"\n        "published": "3068"\n        "protocol": "tcp"\n        "mode": "host"');
    expect(output).toContain('"target": "53"\n        "published": "5353"\n        "protocol": "udp"\n        "mode": "ingress"');
    expect(output.match(/"name": "compose-export-data"/g)).toHaveLength(1);
    expect(output.match(/"source": "volume-1"/g)).toHaveLength(2);
    expect(output).toContain('"source": "/tmp/path: #$$HOME"');
    expect(output).toContain('# File mount "config\\nfile" at "/etc/config\\nmalicious: value"');
    expect(output).toContain("contents are not exported");
    expect(output).not.toContain('"type": "file"');
  });

  it("exports limits and the full Swarm restart policy, including zero values", () => {
    const output = generateCompose(app({
      cpuLimit: "0.5", memoryLimit: "256M",
      restartPolicySwarm: { Condition: "on-failure", Delay: 1_000_000_000, MaxAttempts: 3, Window: 0 },
    }));
    expect(output).toContain('"cpus": "0.5"');
    expect(output).toContain('"memory": "256M"');
    expect(output).toContain('"restart": "on-failure:3"');
    expect(output).toContain('"condition": "on-failure"');
    expect(output).toContain('"delay": "1000000000ns"');
    expect(output).toContain('"max_attempts": "3"');
    expect(output).toContain('"window": "0ns"');
  });

  it.each([
    [null, "always"],
    [{ Condition: "any" as const }, "always"],
    [{ Condition: "none" as const }, "no"],
    [{ Condition: "on-failure" as const, MaxAttempts: 0 }, "on-failure"],
  ])("maps the restart policy %j to %s", (restartPolicySwarm, expected) => {
    expect(generateCompose(app({ restartPolicySwarm }))).toContain(`"restart": "${expected}"`);
  });

  it("uses a valid service name and an image placeholder for Git apps", () => {
    const output = generateCompose(app({ name: "!*", sourceType: "github", dockerImage: null }));
    expect(output).toContain('  "app":');
    expect(output).toContain('"image": "your-built-image:latest"');
    expect(output).toContain("Build context is not included");
    expect(output).not.toContain('"build"');
  });

  it("escapes interpolation in image references and volume names", () => {
    const output = generateCompose(app({
      dockerImage: "registry/image:$TAG",
      mounts: [{ type: "volume", mountPath: "/$TARGET", volumeName: "data-$NAME", hostPath: null, filePath: null }],
    }));
    expect(output).toContain('"image": "registry/image:$$TAG"');
    expect(output).toContain('"name": "data-$$NAME"');
    expect(output).toContain('"target": "/$$TARGET"');
  });
});

describe("generateDockerRun", () => {
  it("quotes every literal argument and safely expands only masked shell variables", () => {
    const value = "it's #quoted: \"value\" \\ $(printf INJECTED) `printf INJECTED`\nsecond line";
    const result = shellArguments(generateDockerRun(app({ environment: [
      { key: "LITERAL", value }, { key: "TOKEN" }, { key: "EMPTY", value: "" }, { key: "WITH.DOT" },
    ] })), { TOKEN: "secret value ' $(printf INJECTED)" });
    expect(result).toEqual([
      "run", "--detach", "--name", "compose-export", "--restart", "always",
      "--env", `LITERAL=${value}`, "--env", "TOKEN=secret value ' $(printf INJECTED)",
      "--env", "EMPTY=", "--env", "WITH.DOT=REPLACE_ME", "--", "nginx:alpine",
    ]);
  });

  it("exports ports, mounts, limits and restart settings as distinct arguments", () => {
    const result = shellArguments(generateDockerRun(app({
      ports: [{ publishedPort: 3068, targetPort: 80, protocol: "tcp" }],
      mounts: [
        { type: "volume", volumeName: "compose-export-data", mountPath: "/data", hostPath: null, filePath: null },
        { type: "bind", volumeName: null, mountPath: '/a,"b', hostPath: "/tmp/it's,here", filePath: null },
        { type: "file", volumeName: null, mountPath: "/omitted", hostPath: null, filePath: "config" },
      ],
      cpuLimit: "0.5", memoryLimit: "256M", restartPolicySwarm: { Condition: "on-failure", MaxAttempts: 3 },
    })));
    expect(result).toEqual([
      "run", "--detach", "--name", "compose-export", "--restart", "on-failure:3",
      "--publish", "3068:80/tcp", "--mount", "type=volume,source=compose-export-data,target=/data",
      "--mount", 'type=bind,"source=/tmp/it\'s,here","target=/a,""b"',
      "--cpus", "0.5", "--memory", "256M", "--", "nginx:alpine",
    ]);
  });

  it("explains Git build and Swarm restart settings that docker run cannot preserve", () => {
    const output = generateDockerRun(app({ sourceType: "git", restartPolicySwarm: { Delay: 0, Window: 0 } }));
    expect(output).toContain("Build context is not included");
    expect(output).toContain("cannot preserve Swarm restart delays");
    expect(shellArguments(output).at(-1)).toBe("your-built-image:latest");
  });

  it("prevents image text from being interpreted as Docker options", () => {
    expect(shellArguments(generateDockerRun(app({ dockerImage: "--privileged" }))).slice(-2)).toEqual(["--", "--privileged"]);
  });

  it("explains that ingress ports become host ports with Docker run", () => {
    const output = generateDockerRun(app({ ports: [{ publishedPort: 3068, targetPort: 80, protocol: "tcp", publishMode: "ingress" }] }));
    expect(output).toContain("Swarm ingress routing is not included");
    expect(shellArguments(output)).toContain("3068:80/tcp");
  });
});

const dockerAvailable = (() => {
  const directory = mkdtempSync(join(tmpdir(), "compose-export-docker-"));
  try {
    return spawnSync("docker", ["compose", "version"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, DOCKER_CONFIG: directory },
    }).status === 0;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
})();

describe.skipIf(!dockerAvailable)("Docker Compose round trip (local parser only)", () => {
  it("parses quoted values, interpolation, ports, mounts, resource limits and restart settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "compose-export-test-"));
    const file = join(directory, "docker-compose.yml");
    const values = ["*alias", "&anchor", "!tag", "# comment: value", 'quote"slash\\', "line1\nline2\r\t", "true", "001", "${MASKED} $HOME $$", "\u0085\u2028\u2029"];
    const input = app({
      environment: [...values.map((value, i) => ({ key: `VALUE_${i}`, value })), { key: "MASKED" }],
      ports: [{ publishedPort: 3068, targetPort: 80, protocol: "tcp", publishMode: "host" }],
      mounts: [
        { type: "volume", volumeName: "compose-export-test-data", mountPath: "/data", hostPath: null, filePath: null },
        { type: "bind", volumeName: null, mountPath: "/config", hostPath: "/tmp/config: #file", filePath: null },
        { type: "file", volumeName: null, mountPath: "/note\nunsafe: !tag", hostPath: null, filePath: "config" },
      ],
      cpuLimit: "0.5", memoryLimit: "256M",
      restartPolicySwarm: { Condition: "on-failure", MaxAttempts: 3, Delay: 1_000_000_000, Window: 0 },
    });
    try {
      writeFileSync(file, generateCompose(input));
      const parsed = spawnSync("docker", ["compose", "--project-name", "compose-export-test", "--file", file, "config", "--format", "json"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, DOCKER_CONFIG: directory, MASKED: "provided locally" },
      });
      expect(parsed.status, parsed.stderr).toBe(0);
      const config = JSON.parse(parsed.stdout);
      const service = config.services["compose-export"];
      expect(service.image).toBe("nginx:alpine");
      // `config` serializes dollars escaped again so its output can itself be used as Compose input.
      values.forEach((value, i) => expect(service.environment[`VALUE_${i}`]).toBe(value.replaceAll("$", () => "$$")));
      expect(service.environment.MASKED).toBe("provided locally");
      expect(service.ports[0]).toMatchObject({ published: "3068", target: 80, protocol: "tcp", mode: "host" });
      expect(service.volumes).toHaveLength(2);
      expect(service.volumes[1]).toMatchObject({ type: "bind", source: "/tmp/config: #file", target: "/config" });
      expect(config.volumes["volume-1"].name).toBe("compose-export-test-data");
      expect(service.deploy.resources.limits).toMatchObject({ cpus: 0.5, memory: "268435456" });
      expect(service.deploy.restart_policy).toMatchObject({ condition: "on-failure", delay: "1s", max_attempts: 3, window: "0s" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
