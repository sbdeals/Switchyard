import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./dokploy";
import { updateResourceSettings } from "./resource-settings";
import { updateResourcesAction } from "@/app/actions";
import type { ResourceInputs } from "./resource-limits";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("./dokploy", () => ({
  ENGINES: ["postgres", "mysql", "mariadb", "mongo", "redis"],
  request: vi.fn(),
}));

const call = vi.mocked(request);
const small: ResourceInputs = {
  cpuLimit: "0.5",
  memoryLimit: "512 MiB",
  cpuReservation: "",
  memoryReservation: "",
};

beforeEach(() => call.mockReset());

describe("resource settings save", () => {
  it.each(["application", "postgres", "mysql", "mariadb", "mongo", "redis"] as const)(
    "saves %s resources in Dokploy units after checking project ownership, without deploying",
    async (kind) => {
      const collection = kind === "application" ? "applications" : kind;
      const idKey = `${kind}Id`;
      call.mockResolvedValueOnce([
        { environments: [] },
        { environments: [{ [collection]: [{ [idKey]: "owned" }] }] },
      ]).mockResolvedValueOnce(undefined);

      await updateResourceSettings(kind, "owned", small);

      expect(call.mock.calls).toEqual([
        ["project.all"],
        [`${kind}.update`, {
          method: "POST",
          body: {
            [idKey]: "owned",
            cpuLimit: "500000000",
            memoryLimit: "536870912",
            cpuReservation: null,
            memoryReservation: null,
          },
        }],
      ]);
    }
  );

  it("does not write to a service absent from the user's project tree", async () => {
    call.mockResolvedValueOnce([{ environments: [{ applications: [{ applicationId: "other" }] }] }]);
    await expect(updateResourceSettings("application", "unowned", small)).rejects.toThrow("not in your projects");
    expect(call.mock.calls).toEqual([["project.all"]]);
  });

  it("does not authorize a matching ID from a different service kind", async () => {
    call.mockResolvedValueOnce([{ environments: [{ redis: [{ redisId: "same-id" }] }] }]);
    await expect(updateResourceSettings("application", "same-id", small)).rejects.toThrow("not in your projects");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not mutate when the project lookup fails", async () => {
    call.mockRejectedValueOnce(new Error("Session expired"));
    await expect(updateResourceSettings("application", "owned", small)).rejects.toThrow("Session expired");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...small, cpuReservation: "1" },
    { ...small, memoryReservation: "1 GiB" },
    { ...small, cpuLimit: "500000000" },
    { ...small, memoryLimit: "garbage" },
    { ...small, cpuLimit: 0.5 } as unknown as ResourceInputs,
  ])("validates submitted values on the server before writing", async (input) => {
    call.mockResolvedValueOnce([{ environments: [{ applications: [{ applicationId: "owned" }] }] }]);
    await expect(updateResourceSettings("application", "owned", input)).rejects.toThrow();
    expect(call.mock.calls).toEqual([["project.all"]]);
  });

  it("rejects arbitrary procedure names and missing IDs", async () => {
    await expect(updateResourceSettings("compose" as "application", "owned", small)).rejects.toThrow("Unsupported");
    await expect(updateResourceSettings("application", "", small)).rejects.toThrow("Service is required");
    expect(call).not.toHaveBeenCalled();
  });

  it("surfaces update failures without deploying or retrying", async () => {
    call.mockResolvedValueOnce([{ environments: [{ applications: [{ applicationId: "owned" }] }] }]);
    call.mockRejectedValueOnce(new Error("Update rejected"));
    await expect(updateResourceSettings("application", "owned", small)).rejects.toThrow("Update rejected");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("scrubs backend credentials before returning resource action errors to the client", async () => {
    call.mockResolvedValueOnce([{ environments: [{ applications: [{ applicationId: "owned" }] }] }]);
    call.mockRejectedValueOnce(new Error("Update failed: https://user:resource-secret@example.com"));

    const result = await updateResourcesAction("application", "owned", small);

    expect(result).toEqual({ ok: false, error: "Update failed: https://example.com" });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("keeps useful validation errors in the resource action without updating", async () => {
    call.mockResolvedValueOnce([{ environments: [{ applications: [{ applicationId: "owned" }] }] }]);

    expect(await updateResourcesAction("application", "owned", { ...small, cpuReservation: "1" }))
      .toEqual({ ok: false, error: "CPU reservation must be less than or equal to its limit." });
    expect(call.mock.calls).toEqual([["project.all"]]);
  });
});
