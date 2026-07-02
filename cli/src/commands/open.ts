import { loadConfig } from "../core/config.js";
import { run } from "../core/docker.js";

export async function openCommand(): Promise<void> {
  const { config: cfg } = loadConfig();
  const url = `http://127.0.0.1:${cfg.dashboardPort}`;
  console.log(`Opening ${url} ...`);
  const result =
    process.platform === "win32"
      ? await run("cmd", ["/c", "start", "", url])
      : process.platform === "darwin"
        ? await run("open", [url])
        : await run("xdg-open", [url]);
  if (result.code !== 0) {
    console.log(`Couldn't launch a browser — open it yourself: ${url}`);
  }
}
