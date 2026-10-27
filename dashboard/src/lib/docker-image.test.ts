import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listContainers: vi.fn(),
  inspectContainer: vi.fn(),
  inspectImage: vi.fn(),
  getContainer: vi.fn(),
  getImage: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({
  default: class {
    listContainers = mocks.listContainers;
    getContainer = mocks.getContainer;
    getImage = mocks.getImage;
  },
}));

import { inspectServiceImages } from "./docker";

const digest = `nginx@sha256:${"a".repeat(64)}`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getContainer.mockReturnValue({ inspect: mocks.inspectContainer });
  mocks.getImage.mockReturnValue({ inspect: mocks.inspectImage });
  mocks.inspectImage.mockResolvedValue({ RepoDigests: [digest] });
});

describe("inspectServiceImages", () => {
  it("uses exact Swarm ownership and inspects the immutable container image ID", async () => {
    const labels = { "com.docker.swarm.service.name": "owned-app" };
    mocks.listContainers.mockResolvedValue([{ Id: "owned-container", Labels: labels }]);
    mocks.inspectContainer.mockResolvedValue({
      State: { Running: true }, Image: "sha256:container-image-id", Config: { Image: "nginx:alpine", Labels: labels },
    });
    expect(await inspectServiceImages("owned-app", "application")).toEqual([{ image: "nginx:alpine", repoDigests: [digest] }]);
    expect(mocks.listContainers).toHaveBeenCalledWith({ all: false, filters: { label: ["com.docker.swarm.service.name=owned-app"] } });
    expect(mocks.getImage).toHaveBeenCalledWith("sha256:container-image-id");
  });

  it("never follows a prefix match or an unrelated container returned by Docker", async () => {
    mocks.listContainers.mockResolvedValue([
      { Id: "other", Labels: { "com.docker.swarm.service.name": "owned-app-other" } },
      { Id: "unlabelled", Names: ["/owned-app"] },
    ]);
    expect(await inspectServiceImages("owned-app", "database")).toEqual([]);
    expect(mocks.getContainer).not.toHaveBeenCalled();
    expect(mocks.getImage).not.toHaveBeenCalled();
  });

  it("checks running state and ownership again after container inspection", async () => {
    const labels = { "com.docker.swarm.service.name": "owned-app" };
    mocks.listContainers.mockResolvedValue([{ Id: "stopped", Labels: labels }, { Id: "other", Labels: labels }]);
    mocks.inspectContainer.mockResolvedValueOnce({ State: { Running: false }, Config: { Labels: labels } });
    mocks.inspectContainer.mockResolvedValueOnce({ State: { Running: true }, Config: { Labels: {} } });
    expect(await inspectServiceImages("owned-app", "application")).toEqual([]);
    expect(mocks.getImage).not.toHaveBeenCalled();
  });

  it("uses exact compose project labels and returns the compose service name", async () => {
    const labels = { "com.docker.compose.project": "owned-stack", "com.docker.compose.service": "web" };
    mocks.listContainers.mockResolvedValue([{ Id: "web", Labels: labels }]);
    mocks.inspectContainer.mockResolvedValue({
      State: { Running: true }, Image: "sha256:image-id", Config: { Image: "nginx:alpine", Labels: labels },
    });
    expect(await inspectServiceImages("owned-stack", "compose")).toEqual([{ image: "nginx:alpine", repoDigests: [digest], serviceName: "web" }]);
    expect(mocks.listContainers).toHaveBeenCalledWith({ all: false, filters: { label: ["com.docker.compose.project=owned-stack"] } });
  });
});
