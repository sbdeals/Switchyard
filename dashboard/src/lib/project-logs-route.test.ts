vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProjectLogs: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/lib/project-logs", () => ({
  getProjectLogs: mocks.getProjectLogs,
  logRangeMs: (range: string) => ({ "15m": 900_000, "1h": 3_600_000, "6h": 21_600_000 })[range],
  ProjectLogScopeError: class ProjectLogScopeError extends Error {},
}));

import { GET } from "../app/api/projects/logs/route";
import { ProjectLogScopeError } from "@/lib/project-logs";

beforeEach(() => vi.clearAllMocks());

describe("project log endpoint", () => {
  it("rejects missing scope and unsupported ranges before loading logs", async () => {
    for (const query of ["", "projectId=p", "projectId=p&environmentId=e&range=all"]) {
      expect((await GET(new Request(`http://localhost/api/projects/logs?${query}`))).status).toBe(400);
    }
    expect(mocks.getProjectLogs).not.toHaveBeenCalled();
  });

  it("returns uncached snapshots and defaults to the last fifteen minutes", async () => {
    const snapshot = { sources: [], lines: [], warnings: [], fetchedAt: 123 };
    mocks.getProjectLogs.mockResolvedValue(snapshot);
    const result = await GET(new Request("http://localhost/api/projects/logs?projectId=p&environmentId=e"));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(await result.json()).toEqual(snapshot);
    expect(mocks.getProjectLogs).toHaveBeenCalledWith("p", "e", 900_000, expect.any(AbortSignal));
  });

  it("returns forbidden for unknown scopes and hides upstream error details", async () => {
    const url = "http://localhost/api/projects/logs?projectId=p&environmentId=e&range=1h";
    mocks.getProjectLogs.mockRejectedValue(new ProjectLogScopeError("unknown"));
    expect((await GET(new Request(url))).status).toBe(403);
    mocks.getProjectLogs.mockRejectedValue(new Error("private backend details"));
    const result = await GET(new Request(url));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private backend details");
  });

  it("propagates client cancellation to the backend signal", async () => {
    mocks.getProjectLogs.mockResolvedValue({ sources: [], lines: [], warnings: [] });
    const controller = new AbortController();
    await GET(new Request("http://localhost/api/projects/logs?projectId=p&environmentId=e", { signal: controller.signal }));
    const passedSignal = mocks.getProjectLogs.mock.calls[0][3] as AbortSignal;
    controller.abort();
    expect(passedSignal.aborted).toBe(true);
  });
});
