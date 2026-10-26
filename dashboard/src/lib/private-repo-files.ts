import "server-only";
import Docker from "dockerode";
import type { RepoBuildFiles } from "./build-plan";
import { inspectImageExposedPorts } from "./docker";
import { privateRepoSourceCommand } from "./private-repo";

const IMAGE = "alpine/git:2.49.1";
const MAX_FILE_BYTES = 128 * 1024;
const CONTENT_FILES = ["Dockerfile", "package.json", "requirements.txt", "pyproject.toml", "Pipfile", "Procfile", "manage.py"];
const PRESENCE_FILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Pipfile.lock", "go.mod", "index.html", "app.py", "main.py", "server.js", "index.js"];

/** Only fixed manifests, never .git, env files, or repo-provided shell commands. */
export function privateRepoFilesCommand(subdirectory?: string, dockerfile = "Dockerfile"): string {
  const stage = privateRepoSourceCommand(subdirectory);
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(dockerfile) || dockerfile.split("/").some((p) => p === "." || p === "..")) {
    throw new Error("Invalid Dockerfile path.");
  }
  const contents = [dockerfile, ...CONTENT_FILES.filter((file) => file !== "Dockerfile")];
  return `{ ${stage}; cd /source${subdirectory ? `/${subdirectory}` : ""}; ` +
    // Refuse symlinks in either a manifest or any parent directory before reading.
    'regular() { test -f "$1" && test "$(readlink -f "$1")" = "$PWD/$1"; }; ' +
    `for file in ${contents.join(" ")}; do ` +
    'if test -e "$file" || test -L "$file"; then regular "$file" || exit 1; ' +
    `test "$(wc -c < "$file")" -le ${MAX_FILE_BYTES} || exit 1; ` +
    'printf "SYFILE\\t%s\\t" "$file"; base64 < "$file" | tr -d "\\n"; printf "\\n"; ' +
    `if test "$file" = ${dockerfile}; then exit 0; fi; fi; done; ` +
    `for file in ${PRESENCE_FILES.join(" ")}; do ` +
    'if regular "$file"; then printf "SYFILE\\t%s\\t\\n" "$file"; fi; done; ' +
    // find does not follow symlinks; only bounded, conventional Django paths survive parsing.
    'find . -maxdepth 5 -type f -name wsgi.py | head -n 32 | while read -r file; do printf "SYFILE\\t%s\\t\\n" "${file#./}"; done; } 2>/dev/null';
}

export function parsePrivateRepoFiles(output: string, dockerfile = "Dockerfile"): RepoBuildFiles {
  if (Buffer.byteLength(output) > 2 * 1024 * 1024) throw new Error("Build manifests exceed the size limit.");
  const allowed = new Set([...CONTENT_FILES, ...PRESENCE_FILES, dockerfile]);
  const contents: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const match = line.match(/^SYFILE\t([^\t]+)\t([A-Za-z0-9+/=]*)$/);
    if (!match || (!allowed.has(match[1]) && !/^(?:[A-Za-z_]\w*\/)*wsgi\.py$/.test(match[1]))) {
      throw new Error("Could not read build manifests safely.");
    }
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > MAX_FILE_BYTES) throw new Error("Build manifest exceeds the size limit.");
    contents[match[1]] = bytes.toString("utf8");
  }
  if (dockerfile !== "Dockerfile") {
    if (!Object.hasOwn(contents, dockerfile)) throw new Error("The selected Dockerfile was not found.");
    contents.Dockerfile = contents[dockerfile];
  }
  return { files: Object.keys(contents), contents };
}

/** Called only for a newly created, user-authorized local Compose service. */
export async function readPrivateRepoFiles(repoPath: string, appName: string, subdirectory?: string, dockerfile?: string): Promise<RepoBuildFiles> {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(appName) || repoPath !== `/etc/dokploy/patch-repos/compose/${appName}`) {
    throw new Error("Private build detection requires Dokploy's local clone directory.");
  }
  const command = privateRepoFilesCommand(subdirectory, dockerfile);
  // Reuse the existing bounded public pull; creation fails safely if it cannot pull.
  await inspectImageExposedPorts(IMAGE, { pullIfMissing: true });
  const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock", timeout: 12_000 });
  const container = await docker.createContainer({
    Image: IMAGE, Entrypoint: ["/bin/sh", "-ec"], Cmd: [command], Tty: true,
    HostConfig: {
      NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"],
      Memory: 256 * 1024 * 1024, PidsLimit: 64,
      Tmpfs: { "/source": "rw,noexec,nosuid,size=128m" },
      Mounts: [{ Type: "bind", Source: repoPath, Target: "/repo", ReadOnly: true }],
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await container.start();
        const status = await container.wait();
        if (status.StatusCode !== 0) throw new Error("Could not stage build manifests. Check file sizes and symlinks.");
        const output = await container.logs({ stdout: true, stderr: false });
        return parsePrivateRepoFiles(output.toString(), dockerfile);
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Build detection timed out.")), 30_000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await container.remove({ force: true, v: true });
  }
}
