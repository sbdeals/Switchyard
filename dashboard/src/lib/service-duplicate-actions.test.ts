import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@/lib/dokploy", () => ({ request: mocks.request }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstable_rethrow }));

import { duplicateServiceAction } from "@/app/actions";

const ref = { kind: "application", id: "source" } as const;
const secret = "arbitrary-private-value";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "project.all") return [{ environments: [{
      environmentId: "target",
      applications: [{ applicationId: "source", name: "original" }],
    }] }];
    if (path === "application.one?applicationId=source") return {
      sourceType: "docker", dockerImage: "nginx:alpine", env: `VALUE=${secret}`, password: secret,
    };
    if (path.startsWith("mounts.listByServiceId")) return [];
    if (path === "application.create") return { applicationId: "copy" };
    return {};
  });
});

describe("duplicate service action security", () => {
  it("copies secrets on the server and returns only the new ID", async () => {
    expect(await duplicateServiceAction(ref, "copy", "target")).toEqual({ ok: true, id: "copy" });
    expect(mocks.request).toHaveBeenCalledWith("application.saveEnvironment", {
      method: "POST", body: expect.objectContaining({ applicationId: "copy", env: `VALUE=${secret}` }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/");
  });

  it.each(["project.all", "application.create", "application.saveEnvironment"])(
    "does not expose backend secrets when %s fails", async (failurePath) => {
      const implementation = mocks.request.getMockImplementation()!;
      mocks.request.mockImplementation(async (path, init) => {
        if (path === failurePath) throw new Error(`Backend echoed ${secret}`);
        return implementation(path, init);
      });
      expect(await duplicateServiceAction(ref, "copy", "target")).toEqual({
        ok: false, error: "Could not duplicate the service. Please try again.",
      });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("keeps safe cleanup guidance without echoing either backend failure", async () => {
    const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path, init) => {
      if (path === "application.update" || path === "application.delete") throw new Error(secret);
      return implementation(path, init);
    });
    expect(await duplicateServiceAction(ref, "copy", "target")).toEqual({
      ok: false,
      error: 'Duplication failed and cleanup failed. Remove the incomplete service "copy" (copy) before retrying.',
    });
  });

  it.each(["project.all", "application.update", "application.delete"])(
    "preserves login redirects from %s", async (failurePath) => {
      const redirect = new Error("NEXT_REDIRECT");
      mocks.unstable_rethrow.mockImplementation((error) => {
        if (error === redirect) throw error;
      });
      const implementation = mocks.request.getMockImplementation()!;
      mocks.request.mockImplementation(async (path, init) => {
        if (path === failurePath) throw redirect;
        if (failurePath === "application.delete" && path === "application.update") throw new Error(secret);
        return implementation(path, init);
      });
      await expect(duplicateServiceAction(ref, "copy", "target")).rejects.toBe(redirect);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      if (failurePath === "application.update") {
        expect(mocks.request.mock.calls.some(([path]) => path === "application.delete")).toBe(false);
      }
    },
  );
});
