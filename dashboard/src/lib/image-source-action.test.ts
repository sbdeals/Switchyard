import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAppDockerSourceAction } from "../app/actions";

const mocks = vi.hoisted(() => ({
  setAppDockerSource: vi.fn(),
  getApplicationSource: vi.fn(),
  applicationAction: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dokploy", () => ({
  setAppDockerSource: mocks.setAppDockerSource,
  getApplicationSource: mocks.getApplicationSource,
  applicationAction: mocks.applicationAction,
}));
vi.mock("@/lib/engines", () => ({ ENGINE_META: {} }));
vi.mock("@/lib/names", () => ({ randomPassword: vi.fn(), randomServiceName: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstable_rethrow }));

describe("setAppDockerSourceAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.setAppDockerSource.mockResolvedValue(undefined);
    // Main's action reads the owned source first (ownership + credential preservation).
    mocks.getApplicationSource.mockResolvedValue({ gitUrl: null, dockerImage: null, registryUrl: null });
  });

  it("trims and saves the image, then refreshes the dashboard without deploying", async () => {
    expect(await setAppDockerSourceAction("app-1", "  nginx:alpine \n")).toEqual({ ok: true });

    expect(mocks.setAppDockerSource).toHaveBeenCalledExactlyOnceWith("app-1", "nginx:alpine", undefined);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/");
    expect(mocks.applicationAction).not.toHaveBeenCalled();
  });

  it("preserves the existing registry settings when saving an image", async () => {
    const registry = {
      username: "test-user",
      password: "test-password",
      registryUrl: "docker.io",
    };

    expect(await setAppDockerSourceAction("app-1", "example/app:next", registry)).toEqual({ ok: true });

    expect(mocks.setAppDockerSource).toHaveBeenCalledExactlyOnceWith("app-1", "example/app:next", registry);
    expect(mocks.applicationAction).not.toHaveBeenCalled();
  });

  it("treats empty registry settings as a public image", async () => {
    const registry = { username: "", password: "", registryUrl: "" };

    expect(await setAppDockerSourceAction("app-1", "nginx:alpine", registry)).toEqual({ ok: true });

    expect(mocks.setAppDockerSource).toHaveBeenCalledExactlyOnceWith("app-1", "nginx:alpine", undefined);
    expect(mocks.applicationAction).not.toHaveBeenCalled();
  });

  it.each(["", " \n\t "])("rejects an empty image %j before saving", async (image) => {
    expect(await setAppDockerSourceAction("app-1", image)).toEqual({
      ok: false,
      error: "Image is required.",
    });

    expect(mocks.setAppDockerSource).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.applicationAction).not.toHaveBeenCalled();
  });

  it("returns save failures without revalidating or deploying", async () => {
    const error = new Error("Could not save image.");
    mocks.setAppDockerSource.mockRejectedValueOnce(error);

    expect(await setAppDockerSourceAction("app-1", "nginx:alpine")).toEqual({
      ok: false,
      error: "Could not save image.",
    });

    expect(mocks.unstable_rethrow).toHaveBeenCalledExactlyOnceWith(error);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.applicationAction).not.toHaveBeenCalled();
  });

  it("does not deploy if an older client still supplies the removed redeploy argument", async () => {
    const result = await Reflect.apply(setAppDockerSourceAction, undefined, [
      "app-1", "nginx:alpine", undefined, true,
    ]);

    expect(result).toEqual({ ok: true });
    expect(mocks.setAppDockerSource).toHaveBeenCalledExactlyOnceWith("app-1", "nginx:alpine", undefined);
    expect(mocks.applicationAction).not.toHaveBeenCalled();
  });
});
