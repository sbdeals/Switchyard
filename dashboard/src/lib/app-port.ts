/** Parse an optional container port, rejecting invalid explicit overrides. */
export function parseAppPort(value?: string | number | null): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const port = validPort(text);
  if (port === undefined) throw new Error("Port must be a whole number between 1 and 65535.");
  return port;
}

function validPort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

/** Resolve the container port for an application's generated public URL. */
export function resolveAppPort(input: {
  port?: string | number | null;
  image?: string | null;
  exposedPorts?: string[];
  env?: string | null;
}): number {
  // Precedence: explicit port > env PORT > lowest exposed TCP port > known
  // image default > 3000. EXPOSE is only a fallback for apps configured by env.
  const explicit = parseAppPort(input.port);
  if (explicit !== undefined) return explicit;

  let envPort: number | undefined;
  for (const line of (input.env ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?PORT\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#]*?))\s*(?:#.*)?$/);
    if (match) envPort = validPort((match[1] ?? match[2] ?? match[3]).trim());
  }
  if (envPort !== undefined) return envPort;

  const exposed = (input.exposedPorts ?? [])
    .filter((key) => /^\d+\/tcp$/.test(key))
    .map((key) => validPort(key.split("/")[0]))
    .filter((port): port is number => port !== undefined)
    .sort((a, b) => a - b);
  if (exposed.length > 0) return exposed[0];

  const image = (input.image ?? "").trim().split("@")[0].replace(/:[^/]*$/, "");
  if (/^(?:(?:docker\.io|index\.docker\.io)\/)?(?:library\/)?(?:nginx|httpd)$/.test(image)) {
    return 80;
  }

  return 3000;
}
