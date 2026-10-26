import { describe, expect, it } from "vitest";
import { detectBuildPlan, djangoWsgiPath } from "./build-plan";

const detect = (contents: Record<string, string>) => detectBuildPlan({ files: Object.keys(contents), contents });
const node = (pkg: object, extra: Record<string, string> = {}) => detect({ "package.json": JSON.stringify(pkg), ...extra });

describe("build detection", () => {
  it("always prefers a repository Dockerfile over other manifests", () => {
    expect(detect({ Dockerfile: "FROM alpine\nEXPOSE 80", "package.json": "invalid" }))
      .toMatchObject({ kind: "dockerfile", dockerfileInline: null });
  });

  it.each([
    [{}, "npm install", '["npm","run","start"]'],
    [{ "package-lock.json": "" }, "npm ci", '["npm","run","start"]'],
    [{ "pnpm-lock.yaml": "" }, "corepack pnpm install --frozen-lockfile", '["corepack","pnpm","run","start"]'],
    [{ "yarn.lock": "" }, "corepack yarn install --frozen-lockfile", '["corepack","yarn","run","start"]'],
    [{ "package-lock.json": "", "pnpm-lock.yaml": "", "yarn.lock": "" }, "npm ci", '["npm","run","start"]'],
  ])("uses the lockfile's package manager: %j", (extra, install, start) => {
    const plan = node({ scripts: { build: "tsc", start: "node dist/server.js" } }, extra);
    expect(plan).toMatchObject({ kind: "node", port: 3000 });
    expect(plan.dockerfileInline).toContain(`RUN ${install}\n`);
    expect(plan.dockerfileInline).toMatch(/RUN (?:npm|corepack pnpm|corepack yarn) run build\n/);
    expect(plan.dockerfileInline).toContain(`CMD ${start}`);
    expect(plan.dockerfileInline).toContain("ENV HOST=0.0.0.0");
  });

  it("enables Corepack and supports modern Yarn", () => {
    const plan = node({ packageManager: "yarn@4.6.0", scripts: { start: "node server.js" } }, { "yarn.lock": "" });
    expect(plan.dockerfileInline).toContain("corepack enable");
    expect(plan.dockerfileInline).toContain("corepack yarn install --immutable");
  });

  it.each([
    ["^20.11.0", 20], [">=22 <25", 22], ["24.x", 24], ["18", 18],
    ["99", 22], ["lts/*", 22], ["", 22], ["22\nFROM evil", 22],
  ])("uses a sane Node engine major from %s", (engine, version) => {
    expect(node({ engines: { node: engine }, scripts: { start: "node server.js" } }).dockerfileInline)
      .toContain(`FROM node:${version}-bookworm-slim`);
  });

  it.each([
    [{ main: "dist/app.js", scripts: { build: "tsc" } }, {}, "dist/app.js"],
    [{}, { "server.js": "", "index.js": "" }, "server.js"],
    [{}, { "index.js": "" }, "index.js"],
  ])("uses main, then server.js, then index.js without a start script", (pkg, extra, entry) => {
    expect(node(pkg, extra).dockerfileInline).toContain(`CMD ["node","./${entry}"]`);
  });

  it.each([
    ["vite", "vite build", "dist"], ["react-scripts", "react-scripts build", "build"],
  ])("serves a %s SPA build through nginx on port 80", (dependency, build, directory) => {
    const plan = node({ scripts: { build }, devDependencies: { [dependency]: "*" } });
    expect(plan).toMatchObject({ kind: "node", port: 80 });
    expect(plan.dockerfileInline).toContain(`COPY --from=build /app/${directory} /usr/share/nginx/html`);
    expect(plan.dockerfileInline).toContain("try_files $uri $uri/ /index.html");
    expect(plan.dockerfileInline).toContain("listen ${PORT}");
  });

  it("prefers an explicit start script even when Vite is present", () => {
    const plan = node({ scripts: { build: "vite build", start: "node server.js" }, dependencies: { vite: "*" } });
    expect(plan.port).toBe(3000);
    expect(plan.dockerfileInline).not.toContain("nginx");
  });

  it("preserves a Procfile web command and its runtime variables and shell syntax", () => {
    const command = "python prepare.py && gunicorn project.wsgi --log-file - --bind 0.0.0.0:$PORT";
    const plan = detect({ "requirements.txt": "django", Procfile: `worker: python worker.py\r\nweb: ${command}\r\n` });
    const cmd = JSON.parse(plan.dockerfileInline!.split("CMD ")[1]);
    expect(plan).toMatchObject({ kind: "python", port: 8000, reason: "Python with Procfile web command" });
    expect(cmd[2]).toContain(`; ${command}`);
    expect(cmd[2]).toContain('GUNICORN_CMD_ARGS="--bind=0.0.0.0:$PORT"');
    expect(plan.dockerfileInline).toContain("pip install --no-cache-dir gunicorn");
  });

  it("infers Django WSGI, Flask, and FastAPI commands", () => {
    const django = detect({ "requirements.txt": "django", "manage.py": "", "project/wsgi.py": "" });
    expect(django.dockerfileInline).toContain("gunicorn project.wsgi:application --bind 0.0.0.0:$PORT");
    expect(django.dockerfileInline).not.toContain("collectstatic");
    const flask = detect({ "requirements.txt": "flask", "app.py": "" });
    expect(flask.dockerfileInline).toContain("gunicorn app:app --bind 0.0.0.0:$PORT");
    const fastapi = detect({ "requirements.txt": "fastapi>=0.100", "main.py": "" });
    expect(fastapi.dockerfileInline).toContain("uvicorn main:app --host 0.0.0.0 --port $PORT");
    expect(fastapi.dockerfileInline).toContain("pip install --no-cache-dir uvicorn");
  });

  it("prepares a Django WhiteNoise manifest at startup before its Procfile command", () => {
    const plan = detect({
      "requirements.txt": "django\nwhitenoise", "manage.py": "", "project/wsgi.py": "",
      Procfile: "web: gunicorn project.wsgi",
    });
    expect(plan.dockerfileInline).toContain("python manage.py collectstatic --noinput && gunicorn project.wsgi");
    expect(plan.dockerfileInline).not.toContain("RUN python manage.py");
  });

  it.each([
    [{ "pyproject.toml": '[project]\ndependencies = ["flask"]' }, "pip install --no-cache-dir ."],
    [{ "pyproject.toml": '[tool.poetry]\nname = "web"' }, "poetry install --only main --no-root"],
    [{ Pipfile: '[packages]\nflask = "*"' }, "pipenv install --system --skip-lock"],
    [{ Pipfile: '[packages]\nflask = "*"', "Pipfile.lock": "{}" }, "pipenv sync --system"],
  ])("installs Python dependencies from %j", (manifests, install) => {
    expect(detect({ ...manifests, "app.py": "" }).dockerfileInline).toContain(install);
  });

  it("extracts only a conventional Django settings path", () => {
    expect(djangoWsgiPath('os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")')).toBe("config/wsgi.py");
    expect(djangoWsgiPath('os.environ.setdefault("DJANGO_SETTINGS_MODULE", "../../bad.settings")')).toBeNull();
    expect(djangoWsgiPath("load_settings()")).toBeNull();
  });

  it("builds a Go main package in a separate stage and keeps runtime assets", () => {
    const plan = detect({ "go.mod": "module example.com/web\ngo 1.23" });
    expect(plan).toMatchObject({ kind: "go", port: 8080 });
    expect(plan.dockerfileInline).toContain("RUN CGO_ENABLED=0 go build -o /out/app .");
    expect(plan.dockerfileInline).toContain("COPY --from=build /app /app");
    expect(plan.dockerfileInline).toContain('CMD ["/usr/local/bin/app"]');
  });

  it("serves plain static files using nginx", () => {
    const plan = detect({ "index.html": "<h1>Hello</h1>" });
    expect(plan).toMatchObject({ kind: "static", port: 80 });
    expect(plan.dockerfileInline).toContain("COPY . /usr/share/nginx/html");
    expect(plan.dockerfileInline).toContain("try_files $uri $uri/ =404");
  });

  it.each<Record<string, string>>([
    { "package.json": '{"scripts":{"start":"node index.js"}}' },
    { "package.json": '{"scripts":{"build":"vite build"}}' },
    { "requirements.txt": "flask", "app.py": "" }, { "go.mod": "module web" }, { "index.html": "" },
  ])("sets PORT and EXPOSE consistently for every generated recipe", (contents) => {
    const plan = detect(contents);
    expect(plan.dockerfileInline).toContain(`ENV PORT=${plan.port}\n`);
    expect(plan.dockerfileInline).toContain(`EXPOSE ${plan.port}\n`);
  });

  it("reports the source and actionable fixes for unknown apps", () => {
    expect(() => detectBuildPlan({ files: ["README.md"], contents: {} }, "https://github.com/team/app@main/apps/web"))
      .toThrow("No Dockerfile and no Node/Python/Go/static app detected in https://github.com/team/app@main/apps/web. Add a Dockerfile, or");
  });

  it("fails clearly on malformed manifests and unsupported entry points", () => {
    expect(() => detect({ "package.json": "not json" })).toThrow("Invalid package.json");
    expect(() => node({})).toThrow("No Node start script or entry point");
    expect(() => detect({ "requirements.txt": "django" })).toThrow("add a web: command to Procfile");
  });
});
