import { describe, expect, it } from "vitest";
import { diagnoseDeployment } from "./deploy-diagnosis";

describe("diagnoseDeployment", () => {
  const fixtures = [
    {
      name: "a missing Dockerfile from BuildKit",
      log: "#1 [internal] load build definition from Dockerfile\n#1 transferring dockerfile: 2B done\nERROR: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory",
      ruleId: "missing-dockerfile", tab: "build",
    },
    {
      name: "a missing build context",
      log: 'Building service web\nunable to prepare context: path "/workspace/api" not found\nError: Docker build failed',
      ruleId: "build-context", tab: "build",
    },
    {
      name: "a file excluded from the build context",
      log: '#5 [2/3] COPY package.json .\nERROR: failed to solve: failed to calculate checksum of ref abc: "/package.json": not found',
      ruleId: "build-context", tab: "build",
    },
    {
      name: "Nixpacks cannot detect a language",
      log: "Nixpacks v1.34.1\nError: Nixpacks was unable to generate a build plan for this app.\nPlease check the documentation for supported languages.",
      ruleId: "language-detection", tab: "build",
    },
    {
      name: "Railpack cannot detect a language",
      log: "Railpack 0.8.0\nError: Railpack could not determine how to build the app\nThe app directory contains: README.md",
      ruleId: "language-detection", tab: "build",
    },
    {
      name: "npm peer dependency resolution",
      log: "#8 1.20 npm error code ERESOLVE\n#8 1.20 npm error ERESOLVE unable to resolve dependency tree\n#8 1.20 npm error Found: react@19.0.0",
      ruleId: "dependency-conflict", tab: "build",
    },
    {
      name: "pnpm frozen lockfile mismatch",
      log: "Lockfile is up to date, resolution step is skipped\nERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile because pnpm-lock.yaml is not up to date with package.json",
      ruleId: "lockfile-mismatch", tab: "build",
    },
    {
      name: "npm ci lockfile mismatch",
      log: "npm error code EUSAGE\nnpm error `npm ci` can only install packages when your package.json and package-lock.json are in sync. Please update your lock file with `npm install` before continuing.",
      ruleId: "lockfile-mismatch", tab: "build",
    },
    {
      name: "Yarn immutable install mismatch",
      log: "➤ YN0000: ┌ Post-resolution validation\n➤ YN0028: The lockfile would have been modified by this install, which is explicitly forbidden.\n➤ YN0000: Failed with errors in 0s 128ms",
      ruleId: "lockfile-mismatch", tab: "build",
    },
    {
      name: "npm registry installation error",
      log: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/absent-package\nnpm error A complete log of this run can be found in /root/.npm/_logs/debug.log",
      ruleId: "package-install", tab: "build",
    },
    {
      name: "pnpm unavailable package version",
      log: "Progress: resolved 1, reused 0, downloaded 0, added 0\nERR_PNPM_NO_MATCHING_VERSION No matching version found for example@999.0.0",
      ruleId: "package-install", tab: "build",
    },
    {
      name: "Yarn classic installation failure",
      log: 'yarn install v1.22.22\n[1/4] Resolving packages...\nerror Couldn\'t find package "absent-package" on the "npm" registry.',
      ruleId: "package-install", tab: "build",
    },
    {
      name: "a build process killed with exit code 137",
      log: '#9 12.70 Compiling application...\nERROR: process "/bin/sh -c npm ci" did not complete successfully: exit code: 137',
      ruleId: "out-of-memory", tab: "settings",
    },
    {
      name: "a JavaScript heap exhausted during compilation",
      log: "[24:0x1d00] Mark-Compact 497.8 (510.5) -> 497.1 (511.5) MB\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\nAborted (core dumped)",
      ruleId: "out-of-memory", tab: "settings",
    },
    {
      name: "a published port already allocated",
      log: "Container demo-web-1 Starting\nError response from daemon: driver failed programming external connectivity: Bind for 0.0.0.0:8080 failed: port is already allocated",
      ruleId: "port-conflict", tab: "domains",
    },
    {
      name: "a denied private image pull",
      log: "web Pulling\nweb Error pull access denied for private/example, repository does not exist or may require 'docker login': denied: requested access to the resource is denied",
      ruleId: "image-pull-denied", tab: "build",
    },
    {
      name: "an unknown image manifest",
      log: "web Pulling\nError response from daemon: manifest for nginx:nonexistent-diagnosis-tag not found: manifest unknown: manifest unknown",
      ruleId: "image-manifest", tab: "build",
    },
    {
      name: "Compose YAML indentation error",
      log: "Deploying compose project\nyaml: line 4: did not find expected key\nError: Command failed: docker compose up -d",
      ruleId: "compose-yaml", tab: "editor",
    },
    {
      name: "Dokploy's YAML parser rejects an unterminated flow sequence",
      log: "Initializing deployment\nFile 'docker-compose.yml' created: ✅\n❌ Has occurred an error: Flow sequence in block collection must be sufficiently indented and end with a ] at line 4, column 1:\n\n    image: [unterminated\n\n^\n\nError occurred ❌, check the logs for details.",
      ruleId: "compose-yaml", tab: "editor",
    },
    {
      name: "Compose schema validation error",
      log: "validating /etc/dokploy/compose/demo/code/docker-compose.yml: services.web Additional property environmentt is not allowed",
      ruleId: "compose-yaml", tab: "editor",
    },
    {
      name: "an unhealthy dependency",
      log: "Container demo-db-1 Waiting\ndependency failed to start: container demo-db-1 is unhealthy",
      ruleId: "healthcheck", tab: "deploy",
    },
    {
      name: "a failed healthcheck",
      log: "Waiting for deployment to become healthy\nHealthcheck failed: HTTP GET /health returned 503",
      ruleId: "healthcheck", tab: "deploy",
    },
    {
      name: "an undefined configuration variable",
      log: "Starting server\nReferenceError: DATABASE_URL is not defined\n    at /app/server.js:18:9",
      ruleId: "missing-variable", tab: "variables",
    },
    {
      name: "Python os.environ missing a key",
      log: 'Traceback (most recent call last):\n  File "app.py", line 8, in <module>\n    secret = os.environ["APP_SECRET"]\nKeyError: \'APP_SECRET\'',
      ruleId: "missing-variable", tab: "variables",
    },
    {
      name: "Compose requires a variable",
      log: "error while interpolating services.web.environment: required variable APP_SECRET is missing a value: set APP_SECRET",
      ruleId: "missing-variable", tab: "variables",
    },
  ];

  it.each(fixtures)("recognizes $name", ({ log, ruleId, tab }) => {
    const result = diagnoseDeployment(log);
    expect(result.ruleId).toBe(ruleId);
    expect(result.tab).toBe(tab);
    expect(result.fix).toBeTruthy();
    expect(result.excerpt.split("\n").length).toBeLessThanOrEqual(3);
  });

  it("prioritizes specific causes over later generic installation errors", () => {
    const log = 'npm error code ERESOLVE\nERROR: process "/bin/sh -c npm install" did not complete successfully: exit code: 1';
    expect(diagnoseDeployment(log).ruleId).toBe("dependency-conflict");
    expect(diagnoseDeployment(log.split("\n").reverse().join("\n")).ruleId).toBe("dependency-conflict");
  });

  it("prioritizes missing configuration over a downstream healthcheck failure", () => {
    const log = "Healthcheck failed\nAPP_SECRET is not defined\nContainer web is unhealthy";
    expect(diagnoseDeployment(log).ruleId).toBe("missing-variable");
  });

  it("includes the matching line and at most one line of context on each side", () => {
    const log = "first\nsecond\ncontext before\nnpm error code ERESOLVE\ncontext after\nlast";
    expect(diagnoseDeployment(log).excerpt).toBe("context before\nnpm error code ERESOLVE\ncontext after");
  });

  it("strips ANSI colors, terminal hyperlinks, and carriage returns before matching", () => {
    const log = "progress\r\u001b[31mnpm error code E\u001b[0mRESOLVE\r\n\u001b]8;;https://example.com\u0007details\u001b]8;;\u0007\n";
    const result = diagnoseDeployment(log);
    expect(result.ruleId).toBe("dependency-conflict");
    expect(result.excerpt).toBe("progress\nnpm error code ERESOLVE\ndetails");
  });

  it("returns the last 20 lines when no pattern matches", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `unrecognized output ${index + 1}`);
    expect(diagnoseDeployment(`${lines.join("\n")}\n`)).toEqual({
      ruleId: null,
      cause: "No known pattern",
      excerpt: lines.slice(-20).join("\n"),
      fix: null,
      tab: null,
    });
  });

  it("preserves errors between terminal hyperlinks terminated with ESC-backslash", () => {
    const link = "\u001b]8;;https://example.com\u001b\\docs\u001b]8;;\u001b\\";
    const result = diagnoseDeployment(`${link}\nError: manifest unknown\n${link}`);
    expect(result.ruleId).toBe("image-manifest");
    expect(result.excerpt).toBe("docs\nError: manifest unknown\ndocs");
  });

  it("handles an empty log without inventing a cause", () => {
    expect(diagnoseDeployment("").ruleId).toBeNull();
    expect(diagnoseDeployment("").excerpt).toBe("");
  });

  it("keeps unsafe HTML as plain text for React to escape, without double escaping", () => {
    const log = '<script>alert("example")</script>\nReferenceError: APP_SECRET is not defined\n<img src=x onerror=alert(1)> & text';
    expect(diagnoseDeployment(log).excerpt).toBe(log);
    expect(diagnoseDeployment('<img src=x onerror=alert(1)>').excerpt).toBe('<img src=x onerror=alert(1)>');
  });

  it.each([
    "Dockerfile successfully loaded; sending build context to Docker daemon",
    "Nixpacks detected Node.js; npm install completed successfully",
    "Nixpacks build failed: an unexpected internal error occurred",
    "Healthcheck passed: container is healthy",
    "Setting environment variable APP_SECRET",
    "ReferenceError: widget is not defined",
    "Process exited with code 0; 137 packages installed",
    "Lockfile is up to date, resolution step is skipped",
    "The server listens on port 3000",
    "0 processes killed",
  ])("does not diagnose unrelated or successful output: %s", (log) => {
    expect(diagnoseDeployment(log).ruleId).toBeNull();
  });
});
