import { beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({
  listContainers: vi.fn(),
  logs: vi.fn(),
  getContainer: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({
  default: class {
    listContainers = docker.listContainers;
    getContainer = docker.getContainer;
  },
}));

import { readRecentLogs } from "./docker";

beforeEach(() => {
  vi.resetAllMocks();
  docker.listContainers.mockResolvedValue([{ Id: "test-id", Names: ["/logs-download-test-app-1"] }]);
  docker.getContainer.mockReturnValue({ logs: docker.logs });
});

describe("readRecentLogs exports", () => {
  it("guards the Docker lookup with the supplied ownership set", async () => {
    expect(await readRecentLogs("other-app", 1000, new Set(["logs-download-test"]))).toEqual([]);
    expect(docker.listContainers).not.toHaveBeenCalled();
    expect(docker.logs).not.toHaveBeenCalled();
  });

  it("passes the bounded tail to Docker and keeps timestamp and stream metadata", async () => {
    const body = Buffer.from("2026-10-26T12:34:56.000Z failed\n");
    const header = Buffer.alloc(8);
    header[0] = 2;
    header.writeUInt32BE(body.length, 4);
    docker.logs.mockResolvedValue(Buffer.concat([header, body]));
    expect(await readRecentLogs("logs-download-test", 1000, new Set(["logs-download-test"]))).toEqual([
      { ts: Date.parse("2026-10-26T12:34:56.000Z"), text: "failed", stream: "stderr" },
    ]);
    expect(docker.logs).toHaveBeenCalledWith({ follow: false, stdout: true, stderr: true, tail: 1000, timestamps: true });
  });

  it("returns an empty log when no running container exists", async () => {
    docker.listContainers.mockResolvedValue([]);
    expect(await readRecentLogs("logs-download-test")).toEqual([]);
    expect(docker.logs).not.toHaveBeenCalled();
  });
});
