import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/docker", () => ({ readRecentLogs: vi.fn() }));
vi.mock("@/lib/dokploy", () => ({ knownAppNamesForRequest: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

import { GET } from "../app/api/services/logs/download/route";
import { readRecentLogs } from "./docker";
import { knownAppNamesForRequest } from "./dokploy";

const allowed = new Set(["logs-download-test"]);
const ts = Date.parse("2026-10-26T12:34:56.000Z");
const request = (params = "") => new Request(`http://localhost/api/services/logs/download?app=logs-download-test${params}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(knownAppNamesForRequest).mockResolvedValue(allowed);
  vi.mocked(readRecentLogs).mockResolvedValue([{ ts, text: "\x1b[32mhello\x1b[0m", stream: "stdout" }]);
});

describe("GET log download", () => {
  it("requires an app name", async () => {
    expect((await GET(new Request("http://localhost/api/services/logs/download"))).status).toBe(400);
    expect(readRecentLogs).not.toHaveBeenCalled();
  });

  it("rejects unknown apps before reading any container logs", async () => {
    const response = await GET(new Request("http://localhost/api/services/logs/download?app=another-app"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unknown or unmanaged service.", code: "forbidden" });
    expect(readRecentLogs).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace cannot be read", async () => {
    vi.mocked(knownAppNamesForRequest).mockRejectedValue(new Error("unavailable"));
    expect((await GET(request())).status).toBe(503);
    expect(readRecentLogs).not.toHaveBeenCalled();
  });

  it("defaults to a streamed ANSI-free 5k log attachment", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(readRecentLogs).toHaveBeenCalledWith("logs-download-test", 5000, allowed);
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="logs-download-test-\d{4}-\d{2}-\d{2}T[\d-]+Z\.log"$/);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("2026-10-26T12:34:56.000Z hello\n");
  });

  it("downloads JSON with timestamps and actual streams", async () => {
    const response = await GET(request("&format=json&lines=1000"));
    expect(readRecentLogs).toHaveBeenCalledWith("logs-download-test", 1000, allowed);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/\.json"$/);
    expect(await response.json()).toEqual([
      { timestamp: "2026-10-26T12:34:56.000Z", text: "\x1b[32mhello\x1b[0m", stream: "stdout" },
    ]);
  });

  it("caps both the Docker request and response to the last 10k lines", async () => {
    vi.mocked(readRecentLogs).mockResolvedValue(Array.from({ length: 10002 }, (_, i) => ({ ts, text: `line ${i}` })));
    const response = await GET(request("&format=json&lines=999999999"));
    expect(readRecentLogs).toHaveBeenCalledWith("logs-download-test", 10000, allowed);
    const lines = await response.json();
    expect(lines).toHaveLength(10000);
    expect(lines[0].text).toBe("line 2");
    expect(lines.at(-1).text).toBe("line 10001");
  });

  it("applies the selected smaller cap to the response too", async () => {
    vi.mocked(readRecentLogs).mockResolvedValue(Array.from({ length: 1002 }, (_, i) => ({ ts, text: `line ${i}` })));
    const lines = await (await GET(request("&format=json&lines=1000"))).json();
    expect(lines).toHaveLength(1000);
    expect(lines[0].text).toBe("line 2");
  });

  it("rejects unknown formats and handles an unavailable Docker daemon", async () => {
    expect((await GET(request("&format=html"))).status).toBe(400);
    expect(readRecentLogs).not.toHaveBeenCalled();
    vi.mocked(readRecentLogs).mockRejectedValue(new Error("socket unavailable"));
    expect((await GET(request())).status).toBe(503);
  });
});
