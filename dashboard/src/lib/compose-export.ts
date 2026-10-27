/** Only exportable configuration belongs here; never pass mount contents or registry credentials. */
export interface ComposeExportInput {
  name: string;
  sourceType: string | null;
  dockerImage: string | null;
  environment: { key: string; value?: string }[];
  ports: {
    publishedPort: number;
    targetPort: number;
    protocol: "tcp" | "udp";
    publishMode?: "host" | "ingress";
  }[];
  mounts: {
    type: "volume" | "bind" | "file";
    mountPath: string;
    volumeName: string | null;
    hostPath: string | null;
    filePath: string | null;
  }[];
  cpuLimit: string | null;
  memoryLimit: string | null;
  restartPolicySwarm: {
    Condition?: "none" | "on-failure" | "any";
    Delay?: number;
    MaxAttempts?: number;
    Window?: number;
  } | null;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** JSON string escapes are YAML-compatible; also escape YAML's extra line breaks/control characters. */
function quote(value: string | number): string {
  return JSON.stringify(String(value)).replace(/[\u007f-\u009f\u2028\u2029]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/** Compose interpolates double-quoted strings, so literal dollars must be doubled. */
function literal(value: string | number): string {
  return quote(String(value).replaceAll("$", () => "$$"));
}

function serviceName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "") || "app";
}

function image(input: ComposeExportInput): string {
  return input.sourceType === "docker" && input.dockerImage
    ? input.dockerImage
    : "your-built-image:latest";
}

function restart(input: ComposeExportInput): string {
  const policy = input.restartPolicySwarm;
  if (policy?.Condition === "none") return "no";
  if (policy?.Condition === "on-failure") {
    return policy.MaxAttempts ? `on-failure:${policy.MaxAttempts}` : "on-failure";
  }
  return "always";
}

function notes(input: ComposeExportInput): string[] {
  const result: string[] = [];
  if (input.sourceType !== "docker" || !input.dockerImage) {
    result.push("# Build context is not included. Replace your-built-image:latest with your built image.");
  }
  if (input.environment.some(({ key, value }) => value === undefined && !ENV_NAME.test(key))) {
    result.push("# Environment names that cannot be shell variables use REPLACE_ME; set those values manually.");
  }
  for (const mount of input.mounts) {
    if (mount.type === "file") {
      result.push(`# File mount ${quote(mount.filePath ?? "file")} at ${quote(mount.mountPath)}: recreate this file and mount it manually; contents are not exported.`);
    }
  }
  return result;
}

/** Omit environment values to emit placeholders. Supplied values are exported literally. */
export function generateCompose(input: ComposeExportInput): string {
  const lines = [...notes(input), '"services":', `  ${quote(serviceName(input.name))}:`];
  lines.push(`    "image": ${literal(image(input))}`, `    "restart": ${quote(restart(input))}`);

  if (input.environment.length) {
    lines.push('    "environment":');
    for (const { key, value } of input.environment) {
      const exported = value === undefined
        ? quote(ENV_NAME.test(key) ? `\${${key}}` : "REPLACE_ME")
        : literal(value);
      lines.push(`      ${quote(key)}: ${exported}`);
    }
  }

  if (input.ports.length) {
    lines.push('    "ports":');
    for (const port of input.ports) {
      lines.push(
        `      - "target": ${quote(port.targetPort)}`,
        `        "published": ${quote(port.publishedPort)}`,
        `        "protocol": ${quote(port.protocol)}`
      );
      if (port.publishMode) lines.push(`        "mode": ${quote(port.publishMode)}`);
    }
  }

  const mounts = input.mounts.filter((mount) =>
    mount.type === "volume" ? Boolean(mount.volumeName) : mount.type === "bind" && Boolean(mount.hostPath)
  );
  const volumes = new Map<string, string>();
  for (const mount of mounts) {
    if (mount.type === "volume" && mount.volumeName && !volumes.has(mount.volumeName)) {
      // Safe logical keys keep arbitrary volume names out of Compose's identifier syntax.
      volumes.set(mount.volumeName, `volume-${volumes.size + 1}`);
    }
  }
  if (mounts.length) {
    lines.push('    "volumes":');
    for (const mount of mounts) {
      const source = mount.type === "volume" ? volumes.get(mount.volumeName!)! : mount.hostPath!;
      lines.push(`      - "type": ${quote(mount.type)}`, `        "source": ${literal(source)}`, `        "target": ${literal(mount.mountPath)}`);
    }
  }

  const policy = input.restartPolicySwarm;
  if (input.cpuLimit || input.memoryLimit || policy) {
    lines.push('    "deploy":');
    if (input.cpuLimit || input.memoryLimit) {
      lines.push('      "resources":', '        "limits":');
      if (input.cpuLimit) lines.push(`          "cpus": ${literal(input.cpuLimit)}`);
      if (input.memoryLimit) lines.push(`          "memory": ${literal(input.memoryLimit)}`);
    }
    if (policy) {
      lines.push('      "restart_policy":', `        "condition": ${quote(policy.Condition ?? "any")}`);
      if (policy.Delay != null) lines.push(`        "delay": ${quote(`${policy.Delay}ns`)}`);
      if (policy.MaxAttempts != null) lines.push(`        "max_attempts": ${quote(policy.MaxAttempts)}`);
      if (policy.Window != null) lines.push(`        "window": ${quote(`${policy.Window}ns`)}`);
    }
  }

  if (volumes.size) {
    lines.push('"volumes":');
    for (const [name, key] of volumes) {
      lines.push(`  ${quote(key)}:`, `    "name": ${literal(name)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** POSIX shell quoting: adjacent quoted strings preserve apostrophes without evaluating input. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function mountArgument(fields: string[]): string {
  // Docker --mount accepts CSV, independently of the surrounding shell quoting.
  return fields.map((field) => /[,"\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field).join(",");
}

export function generateDockerRun(input: ComposeExportInput): string {
  const comments = notes(input);
  if (input.ports.some((port) => port.publishMode === "ingress")) {
    comments.push("# Docker run publishes ports on this host; Swarm ingress routing is not included.");
  }
  const policy = input.restartPolicySwarm;
  if (policy?.Delay != null || policy?.Window != null || (policy?.MaxAttempts && policy.Condition !== "on-failure")) {
    comments.push("# Docker run cannot preserve Swarm restart delays, windows, or retries for the always policy.");
  }
  const args = ["docker", "run", "--detach", "--name", serviceName(input.name), "--restart", restart(input)].map(shellQuote);
  for (const { key, value } of input.environment) {
    args.push(shellQuote("--env"));
    args.push(value === undefined && ENV_NAME.test(key)
      ? `${shellQuote(`${key}=`)}"\${${key}}"`
      : shellQuote(`${key}=${value ?? "REPLACE_ME"}`));
  }
  for (const port of input.ports) {
    args.push(shellQuote("--publish"), shellQuote(`${port.publishedPort}:${port.targetPort}/${port.protocol}`));
  }
  for (const mount of input.mounts) {
    const source = mount.type === "volume" ? mount.volumeName : mount.type === "bind" ? mount.hostPath : null;
    if (!source) continue;
    args.push(shellQuote("--mount"), shellQuote(mountArgument([
      `type=${mount.type}`, `source=${source}`, `target=${mount.mountPath}`,
    ])));
  }
  if (input.cpuLimit) args.push(shellQuote("--cpus"), shellQuote(input.cpuLimit));
  if (input.memoryLimit) args.push(shellQuote("--memory"), shellQuote(input.memoryLimit));
  args.push(shellQuote("--"), shellQuote(image(input)));
  return `${[...comments, args.join(" \\\n  ")].join("\n")}\n`;
}
