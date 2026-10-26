import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const docker = vi.hoisted(() => ({ listContainers: vi.fn(), listVolumes: vi.fn(), getContainer: vi.fn(), getVolume: vi.fn() }));
vi.mock("dockerode", () => ({ default: class { constructor() { return docker; } } }));
import { cleanupPreviewContainers } from "./preview-cleanup";
import type { PreviewRecord } from "./pr-previews";

const preview: PreviewRecord = {
  number: 12, marker: "owned-marker", name: "web-pr-12", environmentId: "preview", serviceId: "preview-id",
  appName: "web-pr-12-unique", repoUrl: "https://github.com/acme/web", branch: "feature", sha: "a".repeat(40), title: "Title",
};
const labels = { "io.switchyard.preview": preview.marker, "com.docker.compose.project": preview.appName };
const remove = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  docker.listContainers.mockResolvedValue([{ Id: "owned-container", Labels: labels }]);
  docker.listVolumes.mockResolvedValue({ Volumes: [{ Name: "owned-volume", Labels: labels }] });
  docker.getContainer.mockReturnValue({ remove });
  docker.getVolume.mockReturnValue({ remove });
});

it("removes only containers and volumes matching both project and feature ownership", async () => {
  await cleanupPreviewContainers(preview);
  expect(docker.listContainers).toHaveBeenCalledWith({ all: true, filters: { label: [
    "com.docker.compose.project=web-pr-12-unique", "io.switchyard.preview=owned-marker",
  ] } });
  expect(docker.getContainer).toHaveBeenCalledExactlyOnceWith("owned-container");
  expect(docker.getVolume).toHaveBeenCalledExactlyOnceWith("owned-volume");
  expect(remove).toHaveBeenCalledWith({ force: true, v: true });
});

it.each([{}, { ...labels, "com.docker.compose.project": "parent" }, { ...labels, "io.switchyard.preview": "foreign" }])(
  "refuses container ownership mismatch %j", async (badLabels) => {
    docker.listContainers.mockResolvedValue([{ Id: "foreign", Labels: badLabels }]);
    await expect(cleanupPreviewContainers(preview)).rejects.toThrow("Preview ownership changed.");
    expect(remove).not.toHaveBeenCalled();
  },
);

it("refuses volume ownership mismatch", async () => {
  docker.listContainers.mockResolvedValue([]);
  docker.listVolumes.mockResolvedValue({ Volumes: [{ Name: "parent-data", Labels: { "com.docker.compose.project": preview.appName } }] });
  await expect(cleanupPreviewContainers(preview)).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
});

it("is idempotent for already-absent resources and unbound reservations", async () => {
  docker.listContainers.mockResolvedValue([]);
  docker.listVolumes.mockResolvedValue({ Volumes: [] });
  await cleanupPreviewContainers(preview);
  await cleanupPreviewContainers({ ...preview, appName: undefined });
  expect(docker.listContainers).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
});
