export type DiagnosisTab = "settings" | "variables" | "build" | "editor" | "deploy" | "domains";

export interface DeploymentDiagnosis {
  ruleId: string | null;
  cause: string;
  excerpt: string;
  fix: string | null;
  tab: DiagnosisTab | null;
}

interface DiagnosisRule {
  id: string;
  patterns: RegExp[];
  cause: string;
  fix: string;
  tab: DiagnosisTab;
}

// Order is priority, independent of log order. Specific root causes win over
// downstream healthcheck failures and generic package-install errors.
const RULES: DiagnosisRule[] = [
  {
    id: "missing-dockerfile",
    patterns: [
      /failed to read dockerfile:.*(?:no such file|not found)/i,
      /(?:cannot locate|unable to find|could not find).*dockerfile/i,
      /dockerfile.*(?:does not exist|no such file or directory)/i,
    ],
    cause: "Dockerfile not found",
    fix: "Set the Dockerfile path relative to the build context and commit that file to the deployed branch.",
    tab: "build",
  },
  {
    id: "build-context",
    patterns: [
      /unable to prepare context/i,
      /(?:build context|context path).*(?:not found|does not exist|no such file)/i,
      /(?:COPY|ADD) failed:.*(?:not found|no source files|outside.*context)/i,
      /failed to calculate checksum.*(?:not found|no such file)/i,
      /failed to compute cache key:.*(?:not found|no such file)/i,
    ],
    cause: "Build context or source file is missing",
    fix: "Set the build context to the directory containing your app. Check COPY paths and make sure .dockerignore does not exclude required files.",
    tab: "build",
  },
  {
    id: "language-detection",
    patterns: [
      /(?:nixpacks|railpack).*(?:unable|failed|could not|cannot|can't).*(?:detect|(?:generate|create).*plan|determine how to build)/i,
      /(?:unable|failed|could not|cannot|can't) to (?:detect|determine).*(?:language|build plan|provider)/i,
      /no (?:supported )?(?:language|build provider|providers?) (?:was |were )?(?:detected|found)/i,
    ],
    cause: "Build system could not detect a language",
    fix: "Point the build context at the app directory containing package.json, requirements.txt, or another language manifest, or choose a Dockerfile build.",
    tab: "build",
  },
  {
    id: "dependency-conflict",
    patterns: [/\bERESOLVE\b/, /unable to resolve dependency tree/i],
    cause: "Package dependencies conflict",
    fix: "Resolve the reported peer-dependency version conflict locally, regenerate the lockfile with your package manager, and commit both the manifest and lockfile.",
    tab: "build",
  },
  {
    id: "lockfile-mismatch",
    patterns: [
      /ERR_PNPM_(?:OUTDATED_LOCKFILE|FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE|LOCKFILE_BREAKING_CHANGE)/,
      /(?:npm ci|npm clean-install).*(?:in sync|lockfile|package-lock)/i,
      /(?:lockfile|lock file).*(?:would have been modified|needs? to be updated|not up.to.date|out of date|not in sync)/i,
      /frozen.lockfile.*(?:failed|error|cannot|outdated)/i,
      /\bYN0028\b/,
    ],
    cause: "Package lockfile does not match the manifest",
    fix: "Run your package manager's install command locally using the same version as the build, then commit the updated lockfile and package.json together.",
    tab: "build",
  },
  {
    id: "out-of-memory",
    patterns: [
      /\b(?:out of memory|OOMKilled|heap out of memory)\b/i,
      /\b(?:exit(?:ed)?(?: with)?(?: (?:status|code))?|exitcode)\s*[:=]?\s*137\b/i,
      /(?:^|\s)Killed(?:\s|$)/,
    ],
    cause: "Process was killed (possibly out of memory)",
    fix: "Check the service memory limit and increase it if needed, or reduce build concurrency and memory use. Exit 137 can also mean an external SIGKILL.",
    tab: "settings",
  },
  {
    id: "port-conflict",
    patterns: [
      /port is already allocated/i,
      /address already in use/i,
      /\bEADDRINUSE\b/,
      /failed to bind host port/i,
    ],
    cause: "Port is already in use",
    fix: "Remove an unnecessary published host port or choose a free host port. Check that only one process listens on the app's configured port.",
    tab: "domains",
  },
  {
    id: "image-pull-denied",
    patterns: [
      /pull access denied/i,
      /requested access to the resource is denied/i,
      /(?:unauthorized|authentication required).*(?:pull|registry|repository)/i,
      /(?:pull|registry|repository).*(?:unauthorized|authentication required|access denied)/i,
      /denied:.*(?:requested access|permission_denied)/i,
    ],
    cause: "Container image access was denied",
    fix: "Verify the image repository name. For a private image, configure registry authentication with permission to pull it, or use a public image.",
    tab: "build",
  },
  {
    id: "image-manifest",
    patterns: [
      /manifest (?:for .+ )?(?:unknown|not found)/i,
      /no matching manifest for/i,
      /failed to resolve reference.*not found/i,
    ],
    cause: "Container image tag or platform was not found",
    fix: "Use an image tag that exists in the registry and supports the server's CPU architecture, then redeploy.",
    tab: "build",
  },
  {
    id: "compose-yaml",
    patterns: [
      /yaml:.*(?:line \d+|unmarshal errors|mapping|sequence)/i,
      /(?:YAMLException|YAMLParseError|yaml\.parser\.ParserError)/i,
      /(?:mapping values are not allowed|did not find expected key|could not find expected ':')/i,
      /flow sequence in block collection must be sufficiently indented and end with a \]/i,
      /(?:services|networks|volumes)(?:\.[\w-]+)* must be a (?:mapping|list)/i,
      /validating .*\.(?:ya?ml).*?(?:additional propert|must be|is not allowed)/i,
    ],
    cause: "Compose YAML is invalid",
    fix: "Fix the reported YAML line or field in the Compose editor. Check indentation and validate the file with docker compose config before deploying again.",
    tab: "editor",
  },
  {
    id: "missing-variable",
    patterns: [
      /\b[A-Z][A-Z0-9_]*\b["']? is not defined\b/,
      /\bKeyError:\s*["'][A-Za-z_][A-Za-z0-9_]*["']/,
      /(?:environment variable|env var).*(?:not (?:set|defined|found)|missing|required)/i,
      /(?:missing|required|undefined).*\b(?:environment variable|env var)\b/i,
      /required variable .* (?:is missing|missing a value)/i,
    ],
    cause: "Required configuration or environment variable is missing",
    fix: "Add the named variable in Variables with the value your app expects, check its spelling, and redeploy. A KeyError can also refer to a missing application configuration key.",
    tab: "variables",
  },
  {
    id: "healthcheck",
    patterns: [
      /health[ -]?check.*(?:failed|failure|unhealthy|timed out)/i,
      /(?:container|dependency).*(?:is unhealthy|failed to become healthy)/i,
    ],
    cause: "Service did not pass its healthcheck",
    fix: "Check the healthcheck path, port, and startup timeout. Make sure the app listens on 0.0.0.0 and responds successfully before the timeout.",
    tab: "deploy",
  },
  {
    id: "package-install",
    patterns: [
      /(?:npm (?:ERR!|error)).*(?:E404|E401|E403|EINTEGRITY|ENOTFOUND|ECONNRESET|ETIMEDOUT)/i,
      /\bERR_PNPM_(?:FETCH|NO_MATCHING_VERSION|TARBALL|META_FETCH)/,
      /error (?:Couldn't find package|Couldn't find any versions|An unexpected error occurred)/i,
      /(?:npm (?:ci|install)|pnpm (?:install|i)|yarn(?: install)?).*?(?:did not complete successfully|failed|exit code: [1-9])/i,
    ],
    cause: "Package installation failed",
    fix: "Reproduce the install locally with the same package manager version. Check the reported package version, registry URL, network access, and any required registry authentication.",
    tab: "build",
  },
];

export function diagnoseDeployment(log: string): DeploymentDiagnosis {
  // Keep excerpts as plain text: React escapes them when rendering. Strip
  // terminal formatting so ANSI sequences cannot split a recognizable error.
  const clean = log.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, "").replace(/\r\n?/g, "\n").trimEnd();
  const lines = clean ? clean.split("\n") : [];

  for (const rule of RULES) {
    const index = lines.findIndex((line) => rule.patterns.some((pattern) => pattern.test(line)));
    if (index === -1) continue;
    return {
      ruleId: rule.id,
      cause: rule.cause,
      excerpt: lines.slice(Math.max(0, index - 1), index + 2).join("\n"),
      fix: rule.fix,
      tab: rule.tab,
    };
  }

  return {
    ruleId: null,
    cause: "No known pattern",
    excerpt: lines.slice(-20).join("\n"),
    fix: null,
    tab: null,
  };
}
