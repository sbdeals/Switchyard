import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listImages: vi.fn(),
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
    listImages = mocks.listImages;
    listContainers = mocks.listContainers;
    getContainer = mocks.getContainer;
    getImage = mocks.getImage;
  },
}));

import { pruneComposeAppImages, pruneComposePortFixupImages, snapshotComposeAppImage, verifyComposeAppImage } from "./docker";

const appName = "web-x1";
const tag = `${appName}-app:sy-1792756800000`;
const imageId = `sha256:${"a".repeat(64)}`;
const labels = { "com.docker.compose.project": appName, "com.docker.compose.service": "app" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listImages.mockResolvedValue([]);
  mocks.listContainers.mockResolvedValue([{ Id: "container-id", State: "running", Created: 1, Labels: labels }]);
  mocks.getContainer.mockReturnValue({ inspect: mocks.containerInspect });
  mocks.containerInspect.mockResolvedValue({ Image: imageId, State: { Running: true }, Config: { Labels: labels } });
  mocks.getImage.mockReturnValue({ inspect: mocks.imageInspect, tag: mocks.imageTag, remove: mocks.imageRemove });
  mocks.imageInspect.mockRejectedValue({ statusCode: 404 });
  mocks.imageTag.mockResolvedValue(undefined);
  mocks.imageRemove.mockResolvedValue(undefined);
});

describe("snapshotComposeAppImage", () => {
  it.each([tag, `${tag}-portfix`])("saves the running container's image ID as %s using exact project and app service labels", async (savedTag) => {
    await snapshotComposeAppImage(appName, savedTag);
    expect(mocks.listContainers).toHaveBeenCalledWith({ all: false, filters: { label: [
      `com.docker.compose.project=${appName}`, "com.docker.compose.service=app",
    ] } });
    expect(mocks.getContainer).toHaveBeenCalledWith("container-id");
    expect(mocks.getImage).toHaveBeenCalledWith(imageId);
    expect(mocks.imageTag).toHaveBeenCalledWith({ repo: `${appName}-app`, tag: savedTag.split(":")[1] });
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
  it.each([tag, `${tag}-portfix`])("checks local tag %s without pulling an image", async (savedTag) => {
    mocks.imageInspect.mockResolvedValue({ Id: imageId });
    await verifyComposeAppImage(appName, savedTag);
    expect(mocks.getImage).toHaveBeenCalledWith(savedTag);
    expect(mocks.imageInspect).toHaveBeenCalledOnce();
  });

  it("rejects a missing tag", async () => {
    await expect(verifyComposeAppImage(appName, tag)).rejects.toEqual({ statusCode: 404 });
  });
});

describe("pruneComposePortFixupImages", () => {
  const portFixupTag = `${tag}-portfix`;

  it("prunes only this app's port-fix tags, excluding rollback snapshots and retained references", async () => {
    const retained = `${appName}-app:sy-1792756800001-portfix`;
    mocks.listImages.mockResolvedValue([{ Id: imageId, RepoTags: [
      portFixupTag, tag, retained, "other-app:sy-1792756800000-portfix", `${appName}-app:sy-invalid-portfix`,
    ] }]);
    mocks.listContainers.mockResolvedValue([]);
    await pruneComposePortFixupImages(appName, [tag, retained]);
    expect(mocks.listImages).toHaveBeenCalledWith({ filters: { reference: [`${appName}-app:sy-*-portfix`] } });
    expect(mocks.getImage.mock.calls).toEqual([[portFixupTag]]);
    expect(mocks.imageRemove).toHaveBeenCalledExactlyOnceWith({ force: false, noprune: true });
  });

  it("keeps a port-fix tag when its image ID is running under another tag or app", async () => {
    mocks.listImages.mockResolvedValue([{ Id: imageId, RepoTags: [portFixupTag] }]);
    mocks.listContainers.mockResolvedValue([{ ImageID: imageId, Image: "another-app:latest", State: "running" }]);
    await pruneComposePortFixupImages(appName, []);
    expect(mocks.listContainers).toHaveBeenCalledWith({ all: false });
    expect(mocks.imageRemove).not.toHaveBeenCalled();
  });

  it.each(["listImages", "listContainers"] as const)("keeps tags if %s fails", async (operation) => {
    mocks.listImages.mockResolvedValue([{ Id: imageId, RepoTags: [portFixupTag] }]);
    mocks[operation].mockRejectedValue(new Error("Docker unavailable"));
    await pruneComposePortFixupImages(appName, []);
    expect(mocks.imageRemove).not.toHaveBeenCalled();
  });

  it("rejects invalid app names before accessing Docker", async () => {
    await expect(pruneComposePortFixupImages("other/app", [])).rejects.toThrow();
    expect(mocks.listImages).not.toHaveBeenCalled();
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
