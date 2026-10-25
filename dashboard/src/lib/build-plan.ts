/** Small, deterministic build recipes for public repos without a Dockerfile. */
export type BuildKind = "dockerfile" | "node" | "python" | "go" | "static";

export interface BuildPlan {
  kind: BuildKind;
  port: number;
  /** Null means use the repository's Dockerfile, including its existing port detection. */
  dockerfileInline: string | null;
  reason: string;
}

export interface RepoBuildFiles {
  /** Paths relative to the selected build directory; contents are only needed for manifests. */
  files: string[];
  contents: Record<string, string>;
}

export const BUILD_LABELS: Record<BuildKind, string> = {
  dockerfile: "Dockerfile", node: "Node", python: "Python", go: "Go", static: "Static (nginx)",
};

/** Conventional Django layout, without executing manage.py or parsing Python. */
export function djangoWsgiPath(manage: string): string | null {
  const settings = manage.match(/["']DJANGO_SETTINGS_MODULE["']\s*,\s*["']([\w.]+)["']/)?.[1];
  const project = settings?.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.settings(?:\..+)?$/)?.[1];
  return project ? `${project.replaceAll(".", "/")}/wsgi.py` : null;
}

function nginxStage(copy: string, spa = false): string[] {
  const fallback = spa ? "/index.html" : "=404";
  return [
    "FROM nginx:alpine",
    copy,
    "ENV PORT=80",
    // The nginx entrypoint expands PORT at runtime and leaves nginx's $uri alone.
    `RUN mkdir -p /etc/nginx/templates && printf '%s\\n' 'server { listen \${PORT}; server_name _; root /usr/share/nginx/html; index index.html; location / { try_files $uri $uri/ ${fallback}; } }' > /etc/nginx/templates/default.conf.template`,
    "EXPOSE 80",
  ];
}

export function detectBuildPlan(input: RepoBuildFiles, location = "this repository"): BuildPlan {
  const files = new Set(input.files);
  const content = (path: string) => input.contents[path] ?? "";
  const plan = (kind: BuildKind, port: number, lines: string[], reason: string): BuildPlan =>
    ({ kind, port, dockerfileInline: lines.join("\n") + "\n", reason });
  const unsupported = (detail: string): never => {
    throw new Error(`${detail} in ${location}. Add a Dockerfile, or use a Node app with a start script, Python app with a web: Procfile, Go main package, or root index.html.`);
  };

  if (files.has("Dockerfile")) {
    return { kind: "dockerfile", port: 3000, dockerfileInline: null, reason: "Repository Dockerfile" };
  }
  if (files.has("package.json")) {
    let pkg: {
      scripts?: Record<string, string>; main?: string; engines?: { node?: string };
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
      packageManager?: string;
    };
    try {
      pkg = JSON.parse(content("package.json"));
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error();
    } catch {
      return unsupported("Invalid package.json");
    }
    const start = typeof pkg.scripts?.start === "string" && pkg.scripts.start.trim();
    const build = typeof pkg.scripts?.build === "string" && pkg.scripts.build.trim();
    const engine = typeof pkg.engines?.node === "string" ? pkg.engines.node.trim() : "";
    const major = Number(engine.match(/^(?:\^|~|>=?)?(\d{1,2})(?:[.\s]|$)/)?.[1]);
    const version = major >= 18 && major <= 26 ? major : 22;
    const manager = files.has("package-lock.json") ? "npm"
      : files.has("pnpm-lock.yaml") ? "corepack pnpm"
        : files.has("yarn.lock") ? "corepack yarn" : "npm";
    const install = manager === "npm" ? (files.has("package-lock.json") ? "npm ci" : "npm install")
      : manager === "corepack pnpm" ? "corepack pnpm install --frozen-lockfile"
        : `corepack yarn install ${/^yarn@[2-9]/.test(pkg.packageManager ?? "") ? "--immutable" : "--frozen-lockfile"}`;
    const lines = [
      `FROM node:${version}-bookworm-slim AS build`, "WORKDIR /app", "COPY . .",
      ...(manager === "npm" ? [] : ["RUN npm install --global corepack && corepack enable"]),
      `RUN ${install}`,
      ...(build ? [`RUN ${manager} run build`] : []),
    ];
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const vite = Boolean(deps.vite) || /\bvite\s+build\b/.test(build || "");
    const cra = Boolean(deps["react-scripts"]) || /\breact-scripts\s+build\b/.test(build || "");
    if (!start && build && (vite || cra)) {
      return plan("node", 80, [...lines, ...nginxStage(`COPY --from=build /app/${vite ? "dist" : "build"} /usr/share/nginx/html`, true)],
        `${vite ? "Vite" : "Create React App"} build served by nginx`);
    }
    const main = typeof pkg.main === "string" && pkg.main.trim() ? pkg.main.trim()
      : files.has("server.js") ? "server.js" : files.has("index.js") ? "index.js" : null;
    if (!start && (!main || main.startsWith("/") || main.split("/").includes("..") || /[\r\n\x00]/.test(main))) {
      return unsupported("No Node start script or entry point detected");
    }
    const command = start ? [...manager.split(" "), "run", "start"] : ["node", `./${main}`];
    return plan("node", 3000, [...lines, "ENV NODE_ENV=production", "ENV HOST=0.0.0.0", "ENV PORT=3000", "EXPOSE 3000",
      `CMD ${JSON.stringify(command)}`], `package.json (${manager})`);
  }
  if (["requirements.txt", "pyproject.toml", "Pipfile"].some((file) => files.has(file))) {
    const proc = content("Procfile").match(/^web:[ \t]*([^\r\n]+)/m)?.[1].trim();
    const wsgi = files.has("manage.py")
      ? input.files.find((file) => /^(?:[A-Za-z_]\w*\/)*wsgi\.py$/.test(file)) : undefined;
    const dependencies = ["requirements.txt", "pyproject.toml", "Pipfile"].map(content).join("\n").replace(/#.*$/gm, "");
    const fastapi = /\bfastapi\b/i.test(dependencies);
    const entry = files.has("main.py") ? "main" : files.has("app.py") ? "app" : null;
    const command = proc || (wsgi ? `gunicorn ${wsgi.replace(/\.py$/, "").replaceAll("/", ".")}:application --bind 0.0.0.0:$PORT`
      : fastapi && entry ? `uvicorn ${entry}:app --host 0.0.0.0 --port $PORT`
        : files.has("app.py") ? "gunicorn app:app --bind 0.0.0.0:$PORT" : null);
    if (!command) return unsupported("No Python web entry point detected (add a web: command to Procfile)");
    const install = files.has("requirements.txt") ? "pip install --no-cache-dir -r requirements.txt"
      : files.has("pyproject.toml") ? (/^\[tool\.poetry(?:\]|\.)/m.test(content("pyproject.toml"))
        ? "pip install --no-cache-dir poetry && poetry config virtualenvs.create false && poetry install --only main --no-root"
        : "pip install --no-cache-dir .")
        : `pip install --no-cache-dir pipenv && pipenv ${files.has("Pipfile.lock") ? "sync --system" : "install --system --skip-lock"}`;
    const server = /\bgunicorn\b/.test(command) ? "gunicorn" : /\buvicorn\b/.test(command) ? "uvicorn" : null;
    // WhiteNoise's manifest must exist before serving; use runtime settings/env.
    const prepare = wsgi && /\bwhitenoise\b/i.test(dependencies) ? "python manage.py collectstatic --noinput && " : "";
    return plan("python", 8000, [
      "FROM python:3.12-slim", "WORKDIR /app", "ENV PYTHONUNBUFFERED=1", "COPY . .", `RUN ${install}`,
      ...(server ? [`RUN pip install --no-cache-dir ${server}`] : []), "ENV PORT=8000", "EXPOSE 8000",
      // Procfile commands retain their shell semantics; defaults also bind servers that omit flags.
      `CMD ${JSON.stringify(["sh", "-c", 'export GUNICORN_CMD_ARGS="--bind=0.0.0.0:$PORT" UVICORN_HOST=0.0.0.0 UVICORN_PORT="$PORT" FLASK_RUN_HOST=0.0.0.0 FLASK_RUN_PORT="$PORT"; ' + prepare + (proc ? command : `exec ${command}`)])}`,
    ], proc ? "Python with Procfile web command" : wsgi ? "Django WSGI" : fastapi ? "FastAPI" : "Flask app.py");
  }
  if (files.has("go.mod")) {
    return plan("go", 8080, [
      "FROM golang:1-alpine AS build", "WORKDIR /app", "COPY . .", "RUN CGO_ENABLED=0 go build -o /out/app .",
      "FROM alpine:3", "RUN apk add --no-cache ca-certificates", "WORKDIR /app",
      // Keep templates and other runtime assets alongside the binary.
      "COPY --from=build /app /app", "COPY --from=build /out/app /usr/local/bin/app",
      "ENV PORT=8080", "EXPOSE 8080", 'CMD ["/usr/local/bin/app"]',
    ], "go.mod with a root main package");
  }
  if (files.has("index.html")) {
    return plan("static", 80, nginxStage("COPY . /usr/share/nginx/html"), "Root index.html served by nginx");
  }
  return unsupported("No Dockerfile and no Node/Python/Go/static app detected");
}
