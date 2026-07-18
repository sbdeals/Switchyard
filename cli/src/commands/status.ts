import { loadConfig } from "../core/config.js";
import { docker, probeDocker } from "../core/docker.js";
import { pc } from "../core/prompts.js";
import { CONTAINER_NAME } from "../core/switchyard-container.js";

export async function statusCommand(): Promise<void> {
  const { config: cfg, path, existed } = loadConfig();
  const println = console.log;

  println(pc.bold("switchyard status"));
  println(`  config: ${path}${existed ? "" : pc.dim(" (not created yet — run `switchyard up`)")}`);
  println("");

  const { availability: avail } = await probeDocker();
  if (avail !== "ok") {
    println(pc.red(avail === "no-cli" ? "Docker CLI not found." : "Docker daemon not reachable."));
    println("Run `switchyard up` to bring the stack up.");
    process.exitCode = 1;
    return;
  }

  const services = await docker([
    "service",
    "ls",
    "--filter",
    "name=dokploy",
    "--format",
    "table {{.Name}}\t{{.Replicas}}\t{{.Image}}\t{{.Ports}}",
  ]);
  println(pc.bold("Dokploy services"));
  println(services.code === 0 && services.stdout.trim() ? services.stdout.trimEnd() : pc.dim("  (none — not installed)"));
  println("");

  const container = await docker([
    "ps",
    "--all",
    "--filter",
    `name=^/${CONTAINER_NAME}$`,
    "--format",
    "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}",
  ]);
  println(pc.bold("Switchyard container"));
  println(container.code === 0 && container.stdout.split("\n").length > 1 ? container.stdout.trimEnd() : pc.dim("  (not created)"));
  println("");

  println(pc.bold("URLs"));
  println(`  Dokploy     http://localhost:${cfg.dokployPort}`);
  println(`  Switchyard  http://127.0.0.1:${cfg.dashboardPort}${cfg.expose ? pc.yellow("  (exposed on all interfaces!)") : ""}`);
}
