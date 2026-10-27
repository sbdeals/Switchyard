import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeploymentCommitInfo } from "../components/service/DeploymentCommitInfo";
import { newestDeployment, normalizeDeploymentCommit, type DeploymentSource } from "./deployment-commit";

const sha = "a32dc3da722e6b2e4fbfc72e40b1a697c4686460";
const source: DeploymentSource = { sourceType: "git", customGitUrl: "https://github.com/docker/compose.git" };
const deployment = { title: "test: Set stop_signal to SIGTERM\n\nFull commit body", description: `Commit: ${sha}` };

describe("normalizeDeploymentCommit", () => {
  it("reads v0.30.10 application and compose title/description without treating the body as the subject", () => {
    expect(normalizeDeploymentCommit(deployment, source)).toEqual({
      sha,
      subject: "test: Set stop_signal to SIGTERM",
      branch: null,
      url: `https://github.com/docker/compose/commit/${sha}`,
    });
  });

  it("reads webhook Hash descriptions and normalizes whitespace, case and CRLF", () => {
    expect(normalizeDeploymentCommit({
      title: "  Fix deployment\r\n\r\nDetails\n",
      description: `  Hash: ${sha.toUpperCase()}\n`,
    }, source)).toMatchObject({ sha, subject: "Fix deployment" });
  });

  it.each(["Preview Deployment", "Tag created: v1.0.0"])("does not mistake webhook event title %s for a subject", (title) => {
    expect(normalizeDeploymentCommit({ title, description: `Hash: ${sha}` }, source))
      .toMatchObject({ sha, subject: null });
    // Once git log replaces the metadata, even these strings can be real subjects.
    expect(normalizeDeploymentCommit({ title, description: `Commit: ${sha}` }, source))
      .toMatchObject({ sha, subject: title });
  });

  it("prefers explicit commit fields and normalizes a recorded branch ref", () => {
    expect(normalizeDeploymentCommit({
      ...deployment,
      commitHash: "1234567",
      commitMessage: "  New subject\nBody",
      branch: " refs/heads/feature/deploy-info ",
    }, source)).toEqual({
      sha: "1234567",
      subject: "New subject",
      branch: "feature/deploy-info",
      url: "https://github.com/docker/compose/commit/1234567",
    });
  });

  it("falls back to the description when an explicit hash is invalid", () => {
    expect(normalizeDeploymentCommit({ ...deployment, commitHash: "invalid" }, source)?.sha).toBe(sha);
  });

  it.each(["docker", "raw", undefined, null, "unknown"])("omits metadata for non-Git source %s", (sourceType) => {
    expect(normalizeDeploymentCommit(deployment, { ...source, sourceType })).toBeNull();
  });

  it.each([
    {},
    { title: "Manual deployment" },
    { title: "Deployment", description: "" },
    { title: "Old deployment", description: null },
    { title: "Deployment", description: "Commit: invalid" },
    { title: "Deployment", description: "Hash: 123456" },
    { title: "Deployment", description: `Some unrelated message ${sha}` },
    { title: "Deployment", description: `Commit: ${sha} extra text` },
    { commitHash: " ", commitMessage: " ", branch: " " },
  ])("omits absent or unrecognized commit metadata: %j", (fields) => {
    expect(normalizeDeploymentCommit(fields, source)).toBeNull();
  });

  it("keeps partial recorded metadata without placeholders", () => {
    expect(normalizeDeploymentCommit({ commitMessage: "A subject" }, source)).toEqual({
      sha: null, subject: "A subject", branch: null, url: null,
    });
    expect(normalizeDeploymentCommit({ description: `Commit: ${sha}` }, source)).toMatchObject({ sha, subject: null });
    expect(normalizeDeploymentCommit({ branch: "release" }, source)).toEqual({
      sha: null, subject: null, branch: "release", url: null,
    });
  });

  it("does not attach the service's current branch to historical commits", () => {
    const service = { ...source, branch: "new-branch", customGitBranch: "new-branch" };
    expect(normalizeDeploymentCommit(deployment, service)?.branch).toBeNull();
  });

  it.each([
    "https://github.com/docker/compose",
    "https://github.com/docker/compose.git/",
    "https://GITHUB.COM/docker/compose/",
  ])("links HTTPS github.com repository %s", (customGitUrl) => {
    expect(normalizeDeploymentCommit(deployment, { ...source, customGitUrl })?.url)
      .toBe(`https://github.com/docker/compose/commit/${sha}`);
  });

  it.each([
    "http://github.com/docker/compose",
    "git@github.com:docker/compose.git",
    "ssh://git@github.com/docker/compose.git",
    "https://gitlab.com/docker/compose",
    "https://github.example.com/docker/compose",
    "https://github.com.example.com/docker/compose",
    "https://user:password@github.com/docker/compose",
    "https://github.com:443/docker/compose",
    "https://github.com/docker/compose?token=value",
    "https://github.com/docker/compose#main",
    "https://github.com/docker/compose/tree/main",
    "https://github.com/docker/..",
    "https://github.com/docker/.git",
    "javascript:alert(1)",
    null,
  ])("keeps the SHA plain for other or malformed repository URLs: %s", (customGitUrl) => {
    expect(normalizeDeploymentCommit(deployment, { ...source, customGitUrl })).toMatchObject({ sha, url: null });
  });

  it("links the default and explicit public GitHub provider", () => {
    const github = { sourceType: "github", owner: "docker", repository: "compose" };
    expect(normalizeDeploymentCommit(deployment, github)?.url).toBe(`https://github.com/docker/compose/commit/${sha}`);
    expect(normalizeDeploymentCommit(deployment, { ...github, github: { githubUrl: "https://github.com/" } })?.url)
      .toBe(`https://github.com/docker/compose/commit/${sha}`);
  });

  it("does not mistake enterprise GitHub or another provider for public GitHub", () => {
    expect(normalizeDeploymentCommit(deployment, {
      sourceType: "github", owner: "docker", repository: "compose",
      github: { githubUrl: "https://git.example.com" },
    })?.url).toBeNull();
    for (const sourceType of ["gitlab", "bitbucket", "gitea"]) {
      expect(normalizeDeploymentCommit(deployment, { ...source, sourceType, owner: "docker", repository: "compose" }))
        .toMatchObject({ sha, url: null });
    }
  });
});

describe("newestDeployment", () => {
  it("uses the newest row even when only an older deployment has metadata, without mutating history", () => {
    const latest = { createdAt: "2026-10-26T01:00:00.000Z", commit: null };
    const oldest = { createdAt: "2026-10-24T01:00:00.000Z", commit: normalizeDeploymentCommit(deployment, source) };
    const middle = { createdAt: "2026-10-25T01:00:00.000Z", commit: null };
    const history = Object.freeze([oldest, latest, middle]);
    expect(newestDeployment(history)).toBe(latest);
    expect(history).toEqual([oldest, latest, middle]);
    expect(newestDeployment([])).toBeNull();
  });
});

describe("DeploymentCommitInfo", () => {
  it("renders a short linked SHA with its full hash in a tooltip", () => {
    const html = renderToStaticMarkup(createElement(DeploymentCommitInfo, { commit: normalizeDeploymentCommit(deployment, source) }));
    expect(html).toContain(`href="https://github.com/docker/compose/commit/${sha}"`);
    expect(html).toContain(`title="${sha}"`);
    expect(html).toContain(">a32dc3d</a>");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders a plain SHA for a non-GitHub HTTPS source", () => {
    const commit = normalizeDeploymentCommit(deployment, { sourceType: "git", customGitUrl: "https://git.example.com/owner/repo" });
    const html = renderToStaticMarkup(createElement(DeploymentCommitInfo, { commit }));
    expect(html).toContain(">a32dc3d</span>");
    expect(html).not.toContain("<a ");
  });

  it("truncates long subjects in the UI while preserving the full subject tooltip and recorded branch", () => {
    const subject = "A very long commit subject ".repeat(12).trim();
    const commit = normalizeDeploymentCommit({ commitMessage: `${subject}\nBody`, branch: "refs/heads/feature/test" }, source);
    const html = renderToStaticMarkup(createElement(DeploymentCommitInfo, { commit }));
    expect(commit?.subject).toBe(subject);
    expect(html).toContain(`title="${subject}" class="min-w-0 truncate">${subject}</span>`);
    expect(html).toContain('title="feature/test"');
    expect(html).not.toContain("Body");
  });

  it("renders nothing for missing metadata", () => {
    expect(renderToStaticMarkup(createElement(DeploymentCommitInfo, { commit: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(DeploymentCommitInfo, {
      commit: { sha: null, subject: null, branch: null, url: null },
    }))).toBe("");
  });
});
