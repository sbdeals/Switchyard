import { describe, expect, it } from "vitest";
import type { ComposeService } from "@/lib/dokploy";
import { APP_ACCENT, COMPOSE_ACCENT, presentedKind, serviceAccent, serviceLabel, serviceSubtitle } from "@/lib/service-meta";

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
