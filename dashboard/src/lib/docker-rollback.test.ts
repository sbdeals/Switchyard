import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listContainers: vi.fn(),
  getContainer: vi.fn(),
  getImage: vi.fn(),
  containerInspect: vi.fn(),
  imageInspect: vi.fn(),
  imageTag: vi.fn(),
  imageRemove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({
  default: class {
    listContainers = mocks.listContainers;
    getContainer = mocks.getContainer;
    getImage = mocks.getImage;
  },
}));

import { pruneComposeAppImages, snapshotComposeAppImage, verifyComposeAppImage } from "./docker";

const appName = "web-x1";
const tag = `${appName}-app:sy-1792756800000`;
const imageId = `sha256:${"a".repeat(64)}`;
const labels = { "com.docker.compose.project": appName, "com.docker.compose.service": "app" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listContainers.mockResolvedValue([{ Id: "container-id", State: "running", Created: 1, Labels: labels }]);
  mocks.getContainer.mockReturnValue({ inspect: mocks.containerInspect });
  mocks.containerInspect.mockResolvedValue({ Image: imageId, State: { Running: true }, Config: { Labels: labels } });
  mocks.getImage.mockReturnValue({ inspect: mocks.imageInspect, tag: mocks.imageTag, remove: mocks.imageRemove });
  mocks.imageInspect.mockRejectedValue({ statusCode: 404 });
  mocks.imageTag.mockResolvedValue(undefined);
  mocks.imageRemove.mockResolvedValue(undefined);
});

describe("snapshotComposeAppImage", () => {
  it("saves the running container's image ID using exact project and app service labels", async () => {
    await snapshotComposeAppImage(appName, tag);
    expect(mocks.listContainers).toHaveBeenCalledWith({ all: false, filters: { label: [
      `com.docker.compose.project=${appName}`, "com.docker.compose.service=app",
    ] } });
    expect(mocks.getContainer).toHaveBeenCalledWith("container-id");
    expect(mocks.getImage).toHaveBeenCalledWith(imageId);
    expect(mocks.imageTag).toHaveBeenCalledWith({ repo: `${appName}-app`, tag: "sy-1792756800000" });
  });

  it.each([
    { ...labels, "com.docker.compose.project": `${appName}-other` },
    { ...labels, "com.docker.compose.service": "database" },
  ])("ignores containers from other projects or services", async (otherLabels) => {
    mocks.listContainers.mockResolvedValue([{ Id: "wrong-id", State: "running", Created: 1, Labels: otherLabels }]);
    await expect(snapshotComposeAppImage(appName, tag)).rejects.toThrow("No running app image");
    expect(mocks.getContainer).not.toHaveBeenCalled();
    expect(mocks.imageTag).not.toHaveBeenCalled();
  });

  it("rechecks the container's ownership before saving its image", async () => {
    mocks.containerInspect.mockResolvedValue({ Image: imageId, State: { Running: true }, Config: { Labels: {} } });
    await expect(snapshotComposeAppImage(appName, tag)).rejects.toThrow("compose app changed");
    expect(mocks.getImage).not.toHaveBeenCalled();
  });

  it("never overwrites an existing snapshot tag", async () => {
    mocks.imageInspect.mockResolvedValue({ Id: imageId });
    await expect(snapshotComposeAppImage(appName, tag)).rejects.toThrow("tag already exists");
    expect(mocks.imageTag).not.toHaveBeenCalled();
  });

  it("does not interpret a failed image inspection as an absent tag", async () => {
    mocks.imageInspect.mockRejectedValue(new Error("socket unavailable"));
    await expect(snapshotComposeAppImage(appName, tag)).rejects.toThrow("socket unavailable");
    expect(mocks.imageTag).not.toHaveBeenCalled();
  });

  it.each([
    ["other-app", tag],
    [appName, `${appName}-app:latest`],
    [appName, `${tag}\n`],
    ["web$(id)", tag],
  ])("rejects invalid or unscoped inputs before Docker access", async (name, snapshot) => {
    await expect(snapshotComposeAppImage(name, snapshot)).rejects.toThrow();
    expect(mocks.listContainers).not.toHaveBeenCalled();
    expect(mocks.getImage).not.toHaveBeenCalled();
  });
});

describe("verifyComposeAppImage", () => {
  it("checks the recorded local tag without pulling an image", async () => {
    mocks.imageInspect.mockResolvedValue({ Id: imageId });
    await verifyComposeAppImage(appName, tag);
    expect(mocks.getImage).toHaveBeenCalledWith(tag);
    expect(mocks.imageInspect).toHaveBeenCalledOnce();
  });

  it("rejects a missing tag", async () => {
    await expect(verifyComposeAppImage(appName, tag)).rejects.toEqual({ statusCode: 404 });
  });
});

describe("pruneComposeAppImages", () => {
  it("only removes scoped snapshot tags, deduplicates them, and tolerates images still in use", async () => {
    const secondTag = `${appName}-app:sy-1792756800001`;
    mocks.imageRemove.mockRejectedValueOnce({ statusCode: 409 });
    await pruneComposeAppImages(appName, [tag, "other-app:sy-1792756800000", `${appName}-app:latest`, tag, secondTag]);
    expect(mocks.getImage.mock.calls).toEqual([[tag], [secondTag]]);
    expect(mocks.imageRemove).toHaveBeenCalledTimes(2);
    expect(mocks.imageRemove).toHaveBeenCalledWith({ force: false, noprune: true });
  });
});
