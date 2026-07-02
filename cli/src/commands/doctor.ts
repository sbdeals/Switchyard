import { existsSync } from "node:fs";

import { configPath, loadConfig } from "../core/config.js";
import { docker, dockerAvailability, dockerOk, run } from "../core/docker.js";
import { httpReady } from "../core/dokploy-api.js";
import { pc } from "../core/prompts.js";
import { serviceExists, servicePublishedPort } from "../core/swarm.js";
import { CONTAINER_NAME } from "../core/switchyard-container.js";
import { CLI_VERSION } from "../version.js";

type Level = "ok" | "warn" | "fail";

function print(level: Level, label: string, detail: string): void {
  const tag =
    level === "ok" ? pc.green("[ ok ]") : level === "warn" ? pc.yellow("[warn]") : pc.red("[FAIL]");
  console.log(`${tag} ${label.padEnd(22)} ${detail}`);
}

/** Read-only, cross-platform prerequisite and stack health check. */
export async function doctorCommand(): Promise<void> {
  console.log(pc.bold(`switchyard doctor (v${CLI_VERSION}, ${process.platform})`));
  let failures = 0;
  const fail = (label: string, detail: string): void => {
    failures++;
    print("fail", label, detail);
  };

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 20) print("ok", "node", `v${process.versions.node}`);
  else fail("node", `v${process.versions.node} — need 20+`);

  const avail = await dockerAvailability();
  if (avail === "no-cli") {
    fail("docker CLI", "not found on PATH");
  } else {
    const client = await docker(["version", "--format", "{{.Client.Version}}"]);
    print("ok", "docker CLI", client.stdout.trim() || "present");
    if (avail === "no-daemon") {
      fail("docker daemon", "not reachable (start Docker / run `switchyard up`)");
    } else {
      const server = await docker(["version", "--format", "{{.Server.Version}}"]);
      print("ok", "docker daemon", server.stdout.trim());

      const swarm = await docker(["info", "--format", "{{ .Swarm.LocalNodeState }}"]);
      const state = swarm.stdout.trim();
      if (state === "active") print("ok", "swarm", "active");
      else print("warn", "swarm", `${state || "unknown"} — \`switchyard up\` initializes it`);

      if (await serviceExists("dokploy")) {
        const pub = await servicePublishedPort("dokploy");
        const port = pub?.PublishedPort;
        print("ok", "dokploy service", port ? `published on :${port} (${pub!.PublishMode})` : "deployed");
        if (port) {
          const answers = await httpReady(`http://localhost:${port}`);
          if (answers) print("ok", "dokploy http", `http://localhost:${port} answers`);
          else fail("dokploy http", `no answer on http://localhost:${port}`);
        }
      } else {
        print("warn", "dokploy service", "not deployed — run `switchyard up`");
      }

      if (await dockerOk(["container", "inspect", CONTAINER_NAME])) {
        const state = await docker(["inspect", CONTAINER_NAME, "--format", "{{ .State.Status }}"]);
        const running = state.stdout.trim() === "running";
        const { config: cfg } = loadConfig();
        if (running) {
          try {
            const res = await fetch(`http://127.0.0.1:${cfg.dashboardPort}/api/health`, {
              signal: AbortSignal.timeout(4000),
            });
            if (res.ok) print("ok", "switchyard", `running, healthy on :${cfg.dashboardPort}`);
            else fail("switchyard", `running but /api/health returned ${res.status}`);
          } catch {
            fail("switchyard", `running but no answer on :${cfg.dashboardPort}`);
          }
        } else {
          fail("switchyard", `container is ${state.stdout.trim() || "unknown"} — docker logs ${CONTAINER_NAME}`);
        }
      } else {
        print("warn", "switchyard", "container not created — run `switchyard up`");
      }
    }
  }

  const cfgPath = configPath();
  if (existsSync(cfgPath)) print("ok", "config", cfgPath);
  else print("warn", "config", `${cfgPath} (created on first \`switchyard up\`)`);

  const claude = await run("claude", ["--version"], { shell: process.platform === "win32" });
  if (claude.code === 0) print("ok", "claude code", claude.stdout.trim());
  else print("warn", "claude code", "not installed (npm install -g @anthropic-ai/claude-code)");

  console.log("");
  if (failures > 0) {
    console.log(pc.red(`${failures} check(s) failed.`));
    process.exitCode = 1;
  } else {
    console.log(pc.green("No failures."));
  }
}
