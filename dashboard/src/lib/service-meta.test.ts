import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposeOverviewTab } from "@/components/service/ComposeTabs";
import type { ComposeService } from "@/lib/dokploy";
import { APP_ACCENT, COMPOSE_ACCENT, presentedKind, serviceAccent, serviceLabel, serviceSubtitle } from "@/lib/service-meta";

vi.mock("@/app/actions", () => ({}));
vi.mock("@/app/deploy-hook-actions", () => ({}));

const repo: ComposeService = {
  kind: "compose", id: "repo-1", name: "web", appName: "web-abc", status: "done",
  projectId: "project-1", projectName: "Project", environmentId: "env-1", environmentName: "production",
  dockerImage: "web-abc-app:latest", env: "", createdAt: null, cpuLimit: null, memoryLimit: null,
  replicas: null, composeFile: null, composeType: "docker-compose", domains: [], deployments: [],
  managed: {
    kind: "repo", image: "web-abc-app:latest", repoUrl: "https://github.com/docker/welcome-to-docker",
    branch: "main",
  },
};

describe("managed repo presentation", () => {
  it("labels preview services on both the canvas and project cards", () => {
    expect(serviceSubtitle({ ...repo, managed: { kind: "repo", image: "image", repoUrl: "https://github.com/acme/web",
      branch: "feature/header", preview: { parentId: "parent", number: 12, marker: "marker", title: "Header" } } }))
      .toBe("PR #12 · feature/header");
  });

  it("shows the detected builder and port in Overview, and preserves Dockerfile details", () => {
    const managed = { kind: "repo" as const, image: "web-app:latest", repoUrl: "https://github.com/team/web", branch: "main" };
    const detected: ComposeService = { ...repo, managed: { ...managed, buildKind: "node", buildPort: 3000 } };
    const html = renderToStaticMarkup(createElement(ComposeOverviewTab, { compose: detected }));
    expect(html).toContain("Built with");
    expect(html).toContain("Node (auto-detected)");
    expect(html).toContain("Detected port");
    expect(html).toContain("3000");
    const dockerfile = renderToStaticMarkup(createElement(ComposeOverviewTab, {
      compose: { ...repo, managed: { ...managed, dockerfile: "docker/Production" } },
    }));
    expect(dockerfile).toContain("docker/Production");
    expect(dockerfile).not.toContain("auto-detected");
  });

  it("presents a repo as an application with its source and branch", () => {
    expect(presentedKind(repo)).toBe("application");
    expect(serviceAccent(repo)).toBe(APP_ACCENT);
    expect(serviceLabel(repo)).toBe("GitHub repo");
    expect(serviceSubtitle(repo)).toBe("GitHub repo · main");
  });

  it.each(["https://git.example.com/org/web", "https://github.com.example.com/org/web"])(
    "labels a non-GitHub URL as a Git repo: %s", (repoUrl) => {
      const service: ComposeService = {
        ...repo,
        managed: { kind: "repo", image: "web-abc-app:latest", repoUrl, branch: "release" },
      };
      expect(serviceLabel(service)).toBe("Git repo");
      expect(serviceSubtitle(service)).toBe("Git repo · release");
    }
  );

  it("preserves the presentation of raw stacks and image apps", () => {
    const raw: ComposeService = { ...repo, dockerImage: null, managed: null };
    expect(presentedKind(raw)).toBe("compose");
    expect(serviceAccent(raw)).toBe(COMPOSE_ACCENT);
    expect(serviceLabel(raw)).toBe("Compose");
    const image: ComposeService = { ...repo, managed: { kind: "image", image: "web-abc-app:latest" } };
    expect(serviceLabel(image)).toBe("Docker image");
    expect(serviceSubtitle(image)).toBe("web-abc-app:latest");
  });
});
