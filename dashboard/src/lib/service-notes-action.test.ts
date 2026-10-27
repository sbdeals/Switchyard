import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { loadWorkspace, updateServiceNotes, type Service } from "./dokploy";
import { saveServiceNotesAction } from "../app/actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/dokploy", () => ({
  loadWorkspace: vi.fn(),
  updateServiceNotes: vi.fn(),
}));

const owned = { id: "owned", kind: "database", engine: "postgres" } as Service;
const failure = { ok: false, error: "Could not save service notes. Please try again." };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadWorkspace).mockResolvedValue({ services: [owned], projects: [] });
  vi.mocked(updateServiceNotes).mockResolvedValue();
});

describe("saveServiceNotesAction", () => {
  it("resolves the owned service, normalizes notes, and refreshes the workspace", async () => {
    expect(await saveServiceNotesAction("owned", "  first\r\n<script>text</script>  ")).toEqual({ ok: true });
    expect(updateServiceNotes).toHaveBeenCalledWith(owned, "first\n<script>text</script>");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("caps direct action input at 500 characters", async () => {
    await saveServiceNotesAction("owned", "x".repeat(600));
    expect(updateServiceNotes).toHaveBeenCalledWith(owned, "x".repeat(500));
  });

  it("allows clearing notes", async () => {
    await saveServiceNotesAction("owned", " \n ");
    expect(updateServiceNotes).toHaveBeenCalledWith(owned, "");
  });

  it("rejects a service outside the current workspace before writing", async () => {
    expect(await saveServiceNotesAction("someone-elses-service", "note")).toEqual(failure);
    expect(updateServiceNotes).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [null, "note"],
    ["", "note"],
    ["  ", "note"],
    ["owned", null],
    ["owned", { description: "note" }],
  ])("rejects malformed input without loading or writing the workspace", async (id, notes) => {
    expect(await saveServiceNotesAction(id as string, notes as string)).toEqual(failure);
    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(updateServiceNotes).not.toHaveBeenCalled();
  });

  it("fails closed when ownership cannot be checked", async () => {
    vi.mocked(loadWorkspace).mockRejectedValue(new Error("Private backend details"));
    expect(await saveServiceNotesAction("owned", "note")).toEqual(failure);
    expect(updateServiceNotes).not.toHaveBeenCalled();
  });

  it("returns a generic error for upstream failures", async () => {
    vi.mocked(updateServiceNotes).mockRejectedValue(new Error("Private backend details"));
    expect(await saveServiceNotesAction("owned", "note")).toEqual(failure);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves Next authentication redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    vi.mocked(loadWorkspace).mockRejectedValue(redirect);
    vi.mocked(unstable_rethrow).mockImplementation(() => { throw redirect; });
    await expect(saveServiceNotesAction("owned", "note")).rejects.toBe(redirect);
    expect(updateServiceNotes).not.toHaveBeenCalled();
  });
});
