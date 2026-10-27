import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectSettings: vi.fn(),
  updateProjectSettings: vi.fn(),
  updateProjectEnvironment: vi.fn(),
  deleteProjectSettings: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@/lib/dokploy", () => ({}));
vi.mock("@/lib/project-settings-server", () => mocks);
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstable_rethrow }));

import {
  getProjectSettingsAction,
  updateProjectAction,
  renameEnvironmentAction,
  removeProjectAction,
} from "@/app/actions";

const cases = [
  { name: "load", run: () => getProjectSettingsAction("project"), backend: mocks.getProjectSettings },
  { name: "update", run: () => updateProjectAction("project", "Name", "Description"), backend: mocks.updateProjectSettings },
  { name: "rename environment", run: () => renameEnvironmentAction("env", "preview"), backend: mocks.updateProjectEnvironment },
  { name: "delete", run: () => removeProjectAction("project", "Name", "project", true, "inventory"), backend: mocks.deleteProjectSettings },
];

beforeEach(() => vi.resetAllMocks());

describe("project settings actions", () => {
  it.each(cases)("$name scrubs backend credentials", async ({ run, backend }) => {
    backend.mockRejectedValue(new Error("Failure at https://USER_SENTINEL:PASSWORD_SENTINEL@localhost/?token=TOKEN_SENTINEL"));
    expect(await run()).toEqual({ ok: false, error: "Failure at https://localhost/?token=***" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(cases)("$name preserves useful validation errors", async ({ run, backend }) => {
    backend.mockRejectedValue(new Error("Project services changed. Review the list and confirm deletion again."));
    expect(await run()).toEqual({ ok: false, error: "Project services changed. Review the list and confirm deletion again." });
  });

  it.each(cases)("$name preserves the expired-session redirect", async ({ run, backend }) => {
    const redirect = new Error("NEXT_REDIRECT");
    backend.mockRejectedValue(redirect);
    mocks.unstable_rethrow.mockImplementation((error) => { throw error; });
    await expect(run()).rejects.toBe(redirect);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes the full deletion confirmation to the server and refreshes after success", async () => {
    mocks.deleteProjectSettings.mockResolvedValue(undefined);
    expect(await removeProjectAction("project", "Name", "project", true, "inventory")).toEqual({ ok: true });
    expect(mocks.deleteProjectSettings).toHaveBeenCalledExactlyOnceWith("project", "Name", "project", true, "inventory");
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/");
  });
});
