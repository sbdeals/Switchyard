import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GitConnectionHelp } from "@/components/GithubDeployModal";
import { ComposeOverviewTab } from "@/components/service/ComposeTabs";
import type { ComposeService } from "./dokploy";
import { parseManaged, providerRepoStack, repoStack, withManagedAutoDomain } from "./managed-compose";
import { detectBuildPlan } from "./build-plan";
import { canDeployPrivateRepo, privateRepoCommand, privateRepoSourceCommand, validatePrivateRepoInput, validSshRepoUrl, type GitProviderKind, type PrivateRepoInput } from "./private-repo";

vi.mock("@/app/actions", () => ({}));

const input: PrivateRepoInput = { providerKind: "github", providerId: "provider-1", repository: "team/web", branch: "main", port: 8080 };
const stackInput = { appName: "private-web-abc", repoUrl: "team/web", branch: "main", port: 8080 };

describe("managed provider Compose", () => {
  it.each<GitProviderKind>(["github", "gitlab", "bitbucket", "gitea", "ssh"])("round-trips %s metadata with the chosen first-deploy port", (repoProvider) => {
    const compose = withManagedAutoDomain(providerRepoStack({ ...stackInput, repoProvider, subdirectory: "apps/web", dockerfile: "docker/Production" }), { host: "web.example.test", port: 8080 });
    expect(parseManaged(compose)).toEqual({
      kind: "repo", image: "private-web-abc-app:latest", repoUrl: "team/web", branch: "main",
      repoProvider, subdirectory: "apps/web", dockerfile: "docker/Production", buildKind: "dockerfile", buildPort: 8080,
      autoDomain: { host: "web.example.test", port: 8080 },
    });
    expect(compose).toContain("context: ./.switchyard-source/apps/web");
    expect(compose).toContain("dockerfile: docker/Production");
    expect(compose).toContain("network_mode: none");
    expect(compose).toContain("git -c safe.directory=/repo -C /repo archive HEAD");
    expect(compose).toContain("./code:/repo:ro");
    expect(compose).toContain("profiles: [switchyard-build]");
    expect(compose).toContain("$$(readlink -f /source/apps/web)");
    expect(compose).not.toContain("dockerfile_inline");
    expect(compose).not.toMatch(/(?:token|password|privateKey|providerId|SSH_KEY|GIT_SSH_COMMAND):/);
  });

  it("stages tracked source before building, within Dokploy's allowed command grammar", () => {
    const command = privateRepoCommand(stackInput.appName);
    expect(command).toBe("compose -p private-web-abc --env-file ../.env -f ../switchyard.compose.yaml run --rm --no-deps switchyard-source && docker compose -p private-web-abc --env-file ../.env -f ../switchyard.compose.yaml up -d --build --remove-orphans app");
    expect(command).not.toMatch(/[;|`$(){}<>\n\\]/);
    expect(() => privateRepoCommand("bad; command")).toThrow("Invalid Compose project name");
  });

  it("keeps public Dockerfile repositories on the original remote-context path", () => {
    const compose = repoStack({ appName: "web-abc", repoUrl: "https://github.com/team/web", branch: "main" });
    expect(compose).toContain('context: "https://github.com/team/web.git#main"');
    expect(compose).not.toContain("switchyard-source");
    expect(compose).not.toContain("repoProvider");
    expect(parseManaged(compose)).not.toHaveProperty("buildKind");
  });

  it("checks the staged context before building and rejects paths that could inject commands", () => {
    expect(privateRepoSourceCommand("apps/web")).toContain('test -d /source/apps/web && test "$(readlink -f /source/apps/web)" = /source/apps/web');
    expect(() => privateRepoSourceCommand("../code")).toThrow("Invalid build subdirectory");
    expect(() => privateRepoSourceCommand("apps/web;env")).toThrow("Invalid build subdirectory");
  });

  it("ignores unknown or nested provider markers", () => {
    const compose = providerRepoStack({ ...stackInput, repoProvider: "gitlab" });
    for (const marker of ["  repoProvider: other", "    repoProvider: gitlab"]) {
      expect(parseManaged(compose.replace("  repoProvider: gitlab", marker))).not.toHaveProperty("repoProvider");
    }
  });
});

describe("private repo input and form gating", () => {
  it.each(["git@git.example.test:team/repo.git", "ssh://git@fixture-git:2222/repos/demo.git"])("accepts a credential-free SSH identity: %s", (repository) => {
    expect(validSshRepoUrl(repository)).toBe(true);
    expect(canDeployPrivateRepo({ ...input, providerKind: "ssh", repository }, false)).toBe(true);
  });

  it.each([
    "https://user:secret@git.example.test/repo.git", "ssh://git:secret@git.example.test/repo.git",
    "ssh://git@git.example.test/repo.git?token=secret", "git@git.example.test:../secrets",
    "git@git.example.test:repo.git;echo", "git@git.example.test:$(echo)/repo.git",
    "ssh://git@git.example.test:0/repo.git", "ssh://git@git.example.test:65536/repo.git",
    "git@git.example.test:team/%2e%2e/repo.git",
  ])("rejects credentials and unsafe custom Git input without echoing it", (repository) => {
    const invalid = { ...input, providerKind: "ssh" as const, repository };
    expect(canDeployPrivateRepo(invalid, false)).toBe(false);
    try { validatePrivateRepoInput(invalid); } catch (e) { expect(String(e)).not.toContain(repository); }
  });

  it.each([
    { providerId: "" }, { repository: "" }, { branch: "" }, { branch: "../main" }, { branch: "-option" },
    { subdirectory: "../app" }, { dockerfile: "/etc/passwd" }, { port: 0 }, { port: 65536 }, { port: 1.5 },
  ])("disables deploy for an incomplete or unsafe selection: %j", (patch) => {
    expect(canDeployPrivateRepo({ ...input, ...patch }, false)).toBe(false);
  });

  it("enables a valid selection only when idle", () => {
    expect(canDeployPrivateRepo(input, false)).toBe(true);
    expect(canDeployPrivateRepo({ ...input, port: undefined }, false)).toBe(true);
    expect(canDeployPrivateRepo(input, true)).toBe(false);
  });

  it("provides working connection links even when there are no providers", () => {
    const props = { connectUrl: "http://localhost:3000/dashboard/settings/git-providers", sshKeysUrl: "http://localhost:3000/dashboard/settings/ssh-keys" };
    const html = renderToStaticMarkup(createElement(GitConnectionHelp, props));
    expect(html).toContain(`href="${props.connectUrl}"`);
    expect(html).toContain(`href="${props.sshKeysUrl}"`);
    expect(html).toContain("then refresh");
    expect(renderToStaticMarkup(createElement(GitConnectionHelp, { connectUrl: props.connectUrl }))).not.toContain("SSH key");
  });

  it("shows the private Dockerfile and configured port in Overview", () => {
    const composeFile = providerRepoStack({ ...stackInput, repoProvider: "github" });
    const compose = {
      kind: "compose", appName: stackInput.appName, composeFile, domains: [], managed: parseManaged(composeFile),
    } as unknown as ComposeService;
    const html = renderToStaticMarkup(createElement(ComposeOverviewTab, { compose }));
    expect(html).toContain("Dockerfile (Dokploy clone)");
    expect(html).toContain("GitHub repo");
    expect(html).toContain("App port");
    expect(html).toContain("8080");
    expect(html).not.toContain("auto-detected");
  });

  it("shows the builder detected after a private clone in Overview", () => {
    const plan = detectBuildPlan({ files: ["index.html"], contents: {} });
    const composeFile = providerRepoStack({ ...stackInput, repoProvider: "ssh", port: plan.port }, plan);
    const compose = { kind: "compose", appName: stackInput.appName, composeFile, domains: [], managed: parseManaged(composeFile) } as unknown as ComposeService;
    const html = renderToStaticMarkup(createElement(ComposeOverviewTab, { compose }));
    expect(html).toContain("Static (nginx) (auto-detected after Dokploy clone)");
    expect(html).toContain("Custom Git (SSH)");
    expect(html).toContain("80");
    expect(composeFile).toContain("dockerfile_inline:");
  });
});
