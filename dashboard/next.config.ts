import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) — what the Docker image runs.
  output: "standalone",
  // dockerode pulls in docker-modem -> ssh2, which ships a native asset that
  // Turbopack can't bundle. We only use the local Docker socket, so keep these
  // as runtime-external Node modules instead of bundling them.
  serverExternalPackages: ["dockerode", "ssh2", "docker-modem", "cpu-features"],
};

export default nextConfig;
