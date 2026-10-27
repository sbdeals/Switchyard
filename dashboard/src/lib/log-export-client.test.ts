import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyVisibleLogs, downloadServiceLogs } from "./log-export-client";

describe("copy visible logs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("copies only the supplied visible lines, with timestamps and no ANSI", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyVisibleLogs([{ ts: 0, text: "\u001b[32mmatching line\u001b[0m" }]);
    expect(writeText).toHaveBeenCalledWith("1970-01-01T00:00:00.000Z matching line");
  });

  it("waits for the clipboard and propagates rejection instead of reporting success", async () => {
    const error = new Error("permission denied");
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(error) } });
    await expect(copyVisibleLogs([{ ts: 0, text: "line" }])).rejects.toBe(error);
  });
});

describe("download service logs", () => {
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(link),
      body: { appendChild: vi.fn() },
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:logs");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(["log", "json"] as const)("requests the selected cap and %s format, preserving the server filename", async (format) => {
    fetchMock.mockResolvedValue(new Response(format === "json" ? "[]" : "line\n", {
      headers: {
        "Content-Type": format === "json" ? "application/json" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="service-2026-10-26T00-00-00-000Z.${format}"`,
      },
    }));
    await downloadServiceLogs("service & test", 1000, format);
    expect(fetchMock).toHaveBeenCalledWith(`/api/services/logs/download?app=service+%26+test&lines=1000&format=${format}`);
    expect(link.download).toBe(`service-2026-10-26T00-00-00-000Z.${format}`);
    expect(link.href).toBe("blob:logs");
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:logs");
  });

  it.each([403, 503])("surfaces HTTP %s without saving an error page", async (status) => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status }));
    await expect(downloadServiceLogs("service", 5000, "log")).rejects.toThrow(String(status));
    expect(link.click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a login redirect rather than saving its HTML", async () => {
    fetchMock.mockResolvedValue(new Response("sign in", { headers: { "Content-Type": "text/html" } }));
    await expect(downloadServiceLogs("service", 5000, "json")).rejects.toThrow("Sign in");
    expect(link.click).not.toHaveBeenCalled();
  });
});
