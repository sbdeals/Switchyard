import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateMountInput, Mount, MountPatch } from "./dokploy";

const api = vi.hoisted(() => ({
  listMounts: vi.fn(),
  loadWorkspace: vi.fn(async () => ({ services: [{ id: "owned-app", kind: "application" }], projects: [] })),
  createMount: vi.fn(),
  updateMount: vi.fn(),
  removeMount: vi.fn(),
  applicationAction: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/docker", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/docker")>()), listVolumeDiskUsage: vi.fn(async () => null) }));
vi.mock("@/lib/dokploy", () => api);
vi.mock("@/lib/project-settings-server", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: api.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: api.unstable_rethrow }));

import { createMountAction, listMountsAction, removeMountAction, updateMountAction } from "../app/actions";

const volume: Mount = {
  mountId: "owned-mount", type: "volume", mountPath: "/data", volumeName: "app-data",
  hostPath: null, filePath: null, content: null,
};
const file: Mount = {
  ...volume, mountId: "file-mount", type: "file", mountPath: "/etc/app.conf",
  volumeName: null, filePath: "managed.conf", content: "original",
};
const input: CreateMountInput = {
  serviceType: "application", serviceId: "owned-app", type: "volume",
  mountPath: "/cache", volumeName: "app-cache",
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listMounts.mockResolvedValue([volume, file]);
});

describe("mount server actions", () => {
  it("checks workspace scope before adding, strips extra fields, and never deploys", async () => {
    expect(await createMountAction({ ...input, hostPath: "/host" })).toEqual({ ok: true });
    expect(api.listMounts).toHaveBeenCalledWith("application", "owned-app");
    expect(api.createMount).toHaveBeenCalledWith(input);
    expect(api.listMounts.mock.invocationCallOrder[0]).toBeLessThan(api.createMount.mock.invocationCallOrder[0]);
    expect(api.revalidatePath).toHaveBeenCalledWith("/");
    expect(api.applicationAction).not.toHaveBeenCalled();
  });

  it("generates unique managed file sources, ignoring supplied source paths", async () => {
    const newFile = { ...input, type: "file" as const, filePath: "../../host", content: "" };
    expect(await createMountAction(newFile)).toEqual({ ok: true });
    expect(await createMountAction(newFile)).toEqual({ ok: true });
    const first = api.createMount.mock.calls[0][0];
    const second = api.createMount.mock.calls[1][0];
    expect(first).toEqual({
      serviceType: "application", serviceId: "owned-app", type: "file", mountPath: "/cache",
      filePath: expect.stringMatching(/^[a-f0-9-]+\.conf$/), content: "",
    });
    expect(first.filePath).not.toBe(second.filePath);
  });

  it.each([
    { ...input, mountPath: "/data/" },
    { ...input, mountPath: "relative" },
    { ...input, type: "bind" as const, hostPath: "/host" },
    { ...input, volumeName: "bad/name" },
    { ...input, type: "file" as const, content: "x".repeat(65537) },
  ])("rejects invalid creates before mutation", async (invalid) => {
    expect((await createMountAction(invalid)).ok).toBe(false);
    expect(api.createMount).not.toHaveBeenCalled();
    expect(api.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not mutate when the service is outside the user's tree", async () => {
    api.listMounts.mockRejectedValue(new Error("unowned service"));
    expect((await createMountAction(input)).ok).toBe(false);
    expect((await updateMountAction("application", "other", volume.mountId, {})).ok).toBe(false);
    expect((await removeMountAction("application", "other", volume.mountId)).ok).toBe(false);
    expect(api.createMount).not.toHaveBeenCalled();
    expect(api.updateMount).not.toHaveBeenCalled();
    expect(api.removeMount).not.toHaveBeenCalled();
  });

  it("requires the mount to belong to the supplied service for edit and remove", async () => {
    expect((await updateMountAction("application", "owned-app", "another-mount", {})).ok).toBe(false);
    expect((await removeMountAction("application", "owned-app", "another-mount")).ok).toBe(false);
    expect(api.updateMount).not.toHaveBeenCalled();
    expect(api.removeMount).not.toHaveBeenCalled();
  });

  it("keeps binds read-only even for forged action requests", async () => {
    api.listMounts.mockResolvedValue([{ ...volume, type: "bind" }]);
    expect((await updateMountAction("application", "owned-app", volume.mountId, {})).ok).toBe(false);
    expect((await removeMountAction("application", "owned-app", volume.mountId)).ok).toBe(false);
    expect(api.updateMount).not.toHaveBeenCalled();
    expect(api.removeMount).not.toHaveBeenCalled();
  });

  it("updates an owned file without accepting source, identity, or parent overrides", async () => {
    const patch = {
      content: "updated", filePath: "../../host", hostPath: "/host",
      mountId: "other-mount", applicationId: "other-app", serviceType: "compose",
    } as MountPatch;
    expect(await updateMountAction("application", "owned-app", file.mountId, patch)).toEqual({ ok: true });
    expect(api.updateMount).toHaveBeenCalledWith(file.mountId, {
      type: "file", mountPath: file.mountPath, filePath: file.filePath, content: "updated",
    });
    expect(api.applicationAction).not.toHaveBeenCalled();
  });

  it("rejects duplicate paths on update and does not allow changing type", async () => {
    expect((await updateMountAction("application", "owned-app", file.mountId, { mountPath: "/data" })).ok).toBe(false);
    expect((await updateMountAction("application", "owned-app", volume.mountId, { type: "file" })).ok).toBe(false);
    expect(api.updateMount).not.toHaveBeenCalled();
  });

  it("removes only an owned mount and does not deploy", async () => {
    expect(await removeMountAction("application", "owned-app", volume.mountId)).toEqual({ ok: true });
    expect(api.removeMount).toHaveBeenCalledWith(volume.mountId);
    expect(api.revalidatePath).toHaveBeenCalledWith("/");
    expect(api.applicationAction).not.toHaveBeenCalled();
  });

  it("never returns upstream errors or file content", async () => {
    const secret = "private file content";
    const upstream = new Error(`backend failed: ${secret}`);
    api.listMounts.mockRejectedValueOnce(upstream);
    expect(await listMountsAction("application", "owned-app")).toEqual({ ok: false, error: "Could not load mounts." });
    api.createMount.mockRejectedValue(upstream);
    api.updateMount.mockRejectedValue(upstream);
    api.removeMount.mockRejectedValue(upstream);
    expect(await createMountAction({ ...input, type: "file", content: secret })).toEqual({ ok: false, error: "Could not add mount." });
    expect(await updateMountAction("application", "owned-app", file.mountId, { content: secret })).toEqual({ ok: false, error: "Could not update mount." });
    expect(await removeMountAction("application", "owned-app", volume.mountId)).toEqual({ ok: false, error: "Could not remove mount." });
  });

  it("preserves Next's session redirect control flow", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.listMounts.mockRejectedValue(redirect);
    api.unstable_rethrow.mockImplementation(() => { throw redirect; });
    await expect(createMountAction(input)).rejects.toBe(redirect);
  });
});
