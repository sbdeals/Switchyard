import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { unstable_rethrow } from "next/navigation";
import { openBridgeDatabaseBackup } from "@/lib/bridge-backups";
import { GET } from "./route";

vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/bridge-backups", () => ({ openBridgeDatabaseBackup: vi.fn() }));

const openBackup = vi.mocked(openBridgeDatabaseBackup);
const filename = "2026-10-23T12-34-56.789Z.dump";

function request(params: Record<string, string>) {
  return new Request(`http://localhost/api/services/backups?${new URLSearchParams(params)}`);
}

beforeEach(() => { vi.resetAllMocks(); });

describe("bridge backup download route", () => {
  it("streams the authorized file as a private attachment with its exact size", async () => {
    const content = Buffer.from([0x50, 0x47, 0x44, 0x4d, 0x50, 0, 1, 255]);
    openBackup.mockResolvedValue({
      stream: Readable.from([content]) as Awaited<ReturnType<typeof openBridgeDatabaseBackup>>["stream"],
      size: content.length,
    });
    const response = await GET(request({ composeId: "owned-compose", filename }));
    expect(openBackup).toHaveBeenCalledWith("owned-compose", filename);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${filename}"`);
    expect(response.headers.get("Content-Length")).toBe(String(content.length));
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
  });

  it.each([
    {}, { composeId: "owned-compose" }, { filename },
    { composeId: "owned-compose", filename: `../${filename}` },
    { composeId: "owned-compose", filename: `${filename}\r\nX-Injected: value` },
  ] as Record<string, string>[])("rejects missing or unsafe parameters before opening a backup: %o", async (params) => {
    const response = await GET(request(params));
    expect(response.status).toBe(400);
    expect(openBackup).not.toHaveBeenCalled();
  });

  it("does not disclose file paths or existence when access is denied", async () => {
    openBackup.mockRejectedValue(new Error("Access denied: /private/backups/other-user/private.dump"));
    const response = await GET(request({ composeId: "other-compose", filename }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Backup unavailable or access denied. Refresh the backup list and retry." });
  });

  it("preserves Next navigation control errors for authentication redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    openBackup.mockRejectedValue(redirect);
    vi.mocked(unstable_rethrow).mockImplementation((error) => { throw error; });
    await expect(GET(request({ composeId: "owned-compose", filename }))).rejects.toBe(redirect);
  });
});
