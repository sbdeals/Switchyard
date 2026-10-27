import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/environment-duplicate-server", () => ({
  executeEnvironmentDuplicate: mocks.execute,
  duplicateOptions: (input: unknown) => {
    if (!input) throw new Error("Invalid options");
    return input;
  },
  duplicateError: () => "Could not duplicate the environment.",
}));

import { POST } from "../app/api/environments/duplicate/route";

function request(origin: string | undefined = "http://dashboard.test", fingerprint = "a".repeat(64)) {
  return new Request("http://dashboard.test/api/environments/duplicate", {
    method: "POST",
    headers: { host: "dashboard.test", ...(origin === undefined ? {} : { origin }), "content-type": "application/json" },
    body: JSON.stringify({ options: { projectId: "project", sourceEnvironmentId: "source", name: "staging" }, fingerprint }),
  });
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.revalidate.mockReset();
});

describe("duplicate environment stream", () => {
  it("rejects foreign and malformed origins before executing", async () => {
    for (const origin of ["https://other.test", "not-a-url"]) {
      expect((await POST(request(origin))).status).toBe(403);
    }
    const missingOrigin = request();
    missingOrigin.headers.delete("origin");
    expect((await POST(missingOrigin)).status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("requires a valid preflight fingerprint", async () => {
    expect((await POST(request("http://dashboard.test", "invalid"))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("sends newline-delimited progress and refreshes the canvas", async () => {
    mocks.execute.mockImplementation(async (_options, _fingerprint, emit) => {
      emit({ type: "environment", environmentId: "target" });
      emit({ type: "done", failed: 0, environmentId: "target" });
    });
    const response = await POST(request());
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await response.text()).trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { type: "environment", environmentId: "target" },
      { type: "done", failed: 0, environmentId: "target" },
    ]);
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
  });

  it("completes the server operation after a disconnected client without writing to a closed stream", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let completed = false;
    mocks.execute.mockImplementation(async (_options, _fingerprint, emit) => {
      emit({ type: "environment", environmentId: "target" });
      await gate;
      emit({ type: "done", failed: 0, environmentId: "target" });
      completed = true;
    });
    const response = await POST(request());
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    resume();
    await vi.waitFor(() => expect(completed).toBe(true));
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
  });

  it("reports an execution failure without leaking the backend body", async () => {
    mocks.execute.mockRejectedValue(new Error("SECRET=must-never-leak"));
    const response = await POST(request());
    expect(await response.text()).toBe('{"type":"error","error":"Could not duplicate the environment."}\n');
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
  });
});
