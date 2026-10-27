# Config as code

Open a Git service’s **Build → Config as code → Preview config** panel. Enter a
public `https://github.com/owner/repo` URL and a branch or commit. The panel reads
root files through unauthenticated `raw.githubusercontent.com` requests and shows
each resolved value’s source. Private repositories and other Git hosts are not
supported by this reader.

**This release provides a preview, not deployment enforcement.** On this base,
Switchyard delegates repository cloning and deployment to Dokploy; it has no
checkout/config hook shared by initial deploys, redeploys, and webhooks. The panel
therefore does not save or execute commands, change settings, or schedule jobs.
Deployments continue using Dokploy’s saved settings. A preview reads the selected
ref at request time; use a commit SHA for repeatable results.

## Files and precedence

The first existing file wins, in this order:

1. `switchyard.json`
2. `railway.json` (migration)
3. `railway.toml` (migration)

Files are not merged. An invalid higher-priority file reports errors instead of
falling back to a lower-priority file. A missing file (HTTP 404) tries the next
name; other fetch failures stop the preview. Each file is limited to 64 KiB and
each request to 10 seconds. Redirects are rejected.

Within the preview, explicitly specified file keys override saved dashboard
values. Unspecified keys retain their dashboard value. Invalid files apply no
partial overrides. Empty build/start commands, empty pre-deploy arrays, and zero retries are
explicit values, not missing values. The panel compares the saved build strategy,
Dockerfile path (for Dockerfile builds), and start command. It does not use unsaved
form edits or infer other settings from Dokploy’s different runtime model.

The pure module `dashboard/src/lib/config-as-code.ts` accepts file contents and
performs parsing, validation, file selection, and precedence without filesystem
access, network calls, environment variables, or command execution. Unknown keys,
including `$schema`, produce warnings. Schema URLs and commands are inert data;
the reader never contacts Railway or any URL mentioned inside a file.

## Schema and mapping

JSON uses optional `build` and `deploy` objects. Values are case-sensitive.
All mappings below describe the setting’s meaning; none are applied by the
preview panel.

| Key | Accepted value | Dokploy mapping / limitation |
| --- | --- | --- |
| `build.builder` | `NIXPACKS`, `DOCKERFILE`, `RAILPACK` | Build strategy `nixpacks`, `dockerfile`, `railpack`. Other builders are rejected. |
| `build.buildCommand` | String, including empty | Build-phase command override. This dashboard has no direct build-command setting; not a container start command. |
| `build.dockerfilePath` | Nonempty relative path without `..` segments | Dockerfile path relative to repository root; relevant to Dockerfile builds. Does not implicitly change the builder. |
| `deploy.startCommand` | String, including empty | Dashboard start command (`application.command`). Dokploy appends it to the container entrypoint, so shell semantics can differ. |
| `deploy.preDeployCommand` | Nonempty string or array of nonempty strings | Pre-deploy/release commands. Empty arrays are accepted. No equivalent execution hook in this dashboard. |
| `deploy.healthcheckPath` | String beginning with `/`, without newlines | HTTP readiness path. Dokploy’s Swarm `healthCheckSwarm.Test` needs an explicit executable, container port, and HTTP client; a path alone cannot be mapped safely. |
| `deploy.healthcheckTimeout` | Positive integer seconds | Deployment readiness deadline, not Docker’s per-probe `Timeout`. No equivalent mapping is applied. |
| `deploy.restartPolicyType` | `ALWAYS`, `ON_FAILURE`, `NEVER` | Conceptually Swarm `restartPolicySwarm.Condition`: `any`, `on-failure`, `none`. |
| `deploy.restartPolicyMaxRetries` | Nonnegative integer | Conceptually Swarm `restartPolicySwarm.MaxAttempts`; runtime semantics differ. |
| `deploy.cronSchedule` | String containing five whitespace-separated fields | Scheduled job expression. Dokploy schedules run commands in existing containers; this is not an equivalent run-to-completion deployment. No schedule is created. |

```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node server.js",
    "preDeployCommand": ["npm run migrate"],
    "healthcheckPath": "/health",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

Equivalent migration TOML:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node server.js"
preDeployCommand = ["npm run migrate"]
healthcheckPath = "/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

The dependency-free TOML reader supports tables, dotted keys, quoted keys,
basic/literal strings, multiline strings, decimal numbers, booleans, and arrays
with comments and trailing commas. It is a bounded subset, not a full TOML
implementation: inline tables, array tables, dates, nondecimal numbers, and
`inf`/`nan` are unsupported and reported as errors. Unknown schema keys
using supported syntax are warnings. Known keys with incorrect types or enum
values are errors. Strings cannot contain NUL. Commands and individual cron
fields are not checked against a shell or scheduler.

## Local host limitations

The local proof host runs Dokploy v0.30.10 without a Swarm manager. Swarm health
checks, restart policies, replica placement, and reservations cannot be proven or
enabled here. Do not initialize Swarm for this feature. Pre-deploy jobs, cron
deployment semantics, readiness gates, automatic config enforcement, and private
repo config reads remain unsupported. Host-specific configuration must be set
through the existing dashboard controls where those controls are supported.

Pure parser and fetch behavior is covered by colocated Vitest suites. The fetch
suite uses mocked responses, including malformed files, precedence, timeouts,
oversized streams, and URL validation. Live proof artifacts for this change are
saved outside the repo at `/workspace/sy-codex-notes/fix/config-as-code-proof/`.
