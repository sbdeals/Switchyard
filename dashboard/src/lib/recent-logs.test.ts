import { PassThrough, Readable } from "node:stream";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listContainers: vi.fn(), dial: vi.fn(), openSession: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("dockerode", () => ({
  default: class {
    listContainers = mocks.listContainers;
    modem = { dial: mocks.dial };
  },
}));
vi.mock("./session", () => ({ SESSION_COOKIE: "switchyard_session", openSession: mocks.openSession }));

import { collectLogBytes, parseLogLines, recentLogsResponse } from "./recent-logs";
import { proxy } from "../proxy";

const timestamp = "2026-10-26T12:00:00.123456789Z";
const cookie = "session=test-only";
const headers = { Authorization: `Bearer ${Buffer.from(cookie).toString("base64url")}` };
const tree = [{ projectId: "project", environments: [{
  environmentId: "environment", applications: [{ applicationId: "app" }], compose: [{ composeId: "stack" }],
}] }];
const fetchMock = vi.fn();
const request = (query = "service=app", requestHeaders = headers) =>
  new Request(`http://localhost/api/services/logs/recent?${query}`, { headers: requestHeaders });

function frame(text: string): Buffer {
  const body = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.openSession.mockReturnValue(null);
  fetchMock.mockImplementation(async (url: string) => Response.json(url.endsWith("project.all") ? tree : {
    appName: "my-app", environmentId: "environment", serverId: null,
  }));
  mocks.listContainers.mockResolvedValue([{ Id: "container", Created: 10, Labels: {
    "com.docker.swarm.service.name": "my-app", "com.docker.compose.project": "my-app",
  } }]);
  mocks.dial.mockImplementation((_options, callback) => callback(null, Readable.from([
    frame(`${timestamp} first\n${timestamp} second\n`),
  ])));
});

describe("recent service logs route", () => {
  it("requires authentication before accessing Dokploy or Docker", async () => {
    const response = await recentLogsResponse(request("service=app", {} as typeof headers));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.listContainers).not.toHaveBeenCalled();
  });

  it("rejects invalid bearer credentials and expired Dokploy sessions", async () => {
    expect((await recentLogsResponse(request("service=app", { Authorization: "Bearer invalid" }))).status).toBe(401);
    fetchMock.mockResolvedValue(new Response("expired", { status: 401 }));
    expect((await recentLogsResponse(request())).status).toBe(401);
    expect(mocks.listContainers).not.toHaveBeenCalled();
  });

  it("accepts an existing dashboard session", async () => {
    mocks.openSession.mockReturnValue({ dokployCookie: cookie });
    const response = await recentLogsResponse(new Request("http://localhost/api/services/logs/recent?service=app", {
      headers: { Cookie: "switchyard_session=sealed" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.openSession).toHaveBeenCalledWith("sealed");
  });

  it.each(["lines=0", "lines=1001", "lines=1.5", "lines=no", "since=2h", "since=constructor"])(
    "rejects invalid query %s", async (query) => {
      expect((await recentLogsResponse(request(`service=app&${query}`))).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("requires a service id", async () => {
    expect((await recentLogsResponse(request(""))).status).toBe(400);
  });

  it("rejects foreign services before looking them up or reading Docker", async () => {
    expect((await recentLogsResponse(request("service=other"))).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.listContainers).not.toHaveBeenCalled();
  });

  it("revalidates ownership for each caller without caching a previous user's projects", async () => {
    expect((await recentLogsResponse(request())).status).toBe(200);
    fetchMock.mockResolvedValue(Response.json([]));
    expect((await recentLogsResponse(request())).status).toBe(404);
    expect(mocks.listContainers).toHaveBeenCalledTimes(1);
  });

  it("rejects a moved service and remote-server services", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(tree))
      .mockResolvedValueOnce(Response.json({ appName: "my-app", environmentId: "other" }));
    expect((await recentLogsResponse(request())).status).toBe(404);
    fetchMock.mockResolvedValueOnce(Response.json(tree)).mockResolvedValueOnce(Response.json({
      appName: "my-app", environmentId: "environment", serverId: "remote",
    }));
    expect((await recentLogsResponse(request())).status).toBe(422);
    expect(mocks.listContainers).not.toHaveBeenCalled();
  });

  it("returns recent lines with stable precise timestamps and forwards the caller cookie", async () => {
    const response = await recentLogsResponse(request("service=app&lines=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ lines: [{ ts: timestamp, text: "second" }], truncated: false });
    expect(fetchMock.mock.calls[0][1].headers.Cookie).toBe(cookie);
    expect(mocks.dial.mock.calls[0][0].options).toMatchObject({ follow: false, tail: 1, timestamps: true });
  });

  it("uses compose labels and passes since to Docker", async () => {
    const before = Math.floor(Date.now() / 1000);
    expect((await recentLogsResponse(request("service=stack&since=15m"))).status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toContain("compose.one?composeId=stack");
    expect(mocks.listContainers.mock.calls[0][0].filters).toEqual({ label: ["com.docker.compose.project=my-app"] });
    expect(mocks.dial.mock.calls[0][0].options.since).toBeGreaterThanOrEqual(before - 900);
  });

  it.each(["postgres", "mysql", "mariadb", "mongo", "redis"])("supports %s services", async (kind) => {
    fetchMock.mockResolvedValueOnce(Response.json([{ projectId: "project", environments: [{
      environmentId: "environment", [kind]: [{ [`${kind}Id`]: "database" }],
    }] }]));
    expect((await recentLogsResponse(request("service=database"))).status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toContain(`${kind}.one?${kind}Id=database`);
    expect(mocks.listContainers.mock.calls[0][0].filters).toEqual({ label: ["com.docker.swarm.service.name=my-app"] });
  });

  it("never attaches to prefix-colliding container names", async () => {
    mocks.listContainers.mockResolvedValue([{ Id: "foreign", Created: 10, Labels: {
      "com.docker.swarm.service.name": "my-app-other",
    } }]);
    expect(await (await recentLogsResponse(request())).json()).toEqual({ lines: [], truncated: false });
    expect(mocks.dial).not.toHaveBeenCalled();
  });

  it("caps bytes even when a single log line exceeds the limit", async () => {
    const stream = Readable.from([frame(`${timestamp} ${"x".repeat(300_000)}\n`)]);
    mocks.dial.mockImplementation((_options, callback) => callback(null, stream));
    const response = await recentLogsResponse(request());
    const body = await response.text();
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.parse(body).truncated).toBe(true);
    expect(stream.destroyed).toBe(true);
  });

  it("bounds the serialized response when escaping expands raw logs", async () => {
    mocks.dial.mockImplementation((_options, callback) => callback(null, Readable.from([
      frame(Array.from({ length: 1000 }, () => `${timestamp} ${"\u0001".repeat(200)}\n`).join("")),
    ])));
    const body = await (await recentLogsResponse(request("service=app&lines=1000"))).text();
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.parse(body).truncated).toBe(true);
  });

  it("does not leak upstream error details", async () => {
    mocks.listContainers.mockRejectedValue(new Error("sensitive backend detail"));
    const response = await recentLogsResponse(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive backend detail");
  });

  it("closes an active Docker log stream when the caller cancels", async () => {
    const controller = new AbortController();
    const stream = new PassThrough();
    mocks.dial.mockImplementation((_options, callback) => {
      callback(null, stream);
      queueMicrotask(() => controller.abort());
    });
    const response = await recentLogsResponse(new Request("http://localhost/api/services/logs/recent?service=app", {
      headers, signal: controller.signal,
    }));
    expect(response.status).toBe(503);
    expect(stream.destroyed).toBe(true);
  });

  it("caps the number of service containers inspected", async () => {
    mocks.listContainers.mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({
      Id: `container-${index}`, Created: index, Labels: { "com.docker.swarm.service.name": "my-app" },
    })));
    const response = await recentLogsResponse(request());
    expect((await response.json()).truncated).toBe(true);
    expect(mocks.dial).toHaveBeenCalledTimes(20);
  });
});

describe("log parsing and stream bounds", () => {
  it("preserves blank messages, repeated lines, nanoseconds and container identity", () => {
    const bytes = frame(`${timestamp} same\n${timestamp} same\n${timestamp} \n`);
    const lines = parseLogLines(bytes, "a");
    expect(lines.map((line) => line.text)).toEqual(["same", "same", ""]);
    expect(new Set(lines.map((line) => line.id)).size).toBe(3);
    expect(parseLogLines(bytes, "a")).toEqual(lines);
    expect(parseLogLines(bytes, "b")[0].id).not.toBe(lines[0].id);
    expect(parseLogLines(frame(`${timestamp.replace("789", "790")} same\n`), "a")[0].id).not.toBe(lines[0].id);
  });

  it("drops partial lines when capped and gives untimestamped logs stable identities", () => {
    expect(parseLogLines(Buffer.from("full\npartial"), "a", true).map((line) => line.text)).toEqual(["full"]);
    expect(parseLogLines(Buffer.from("plain\n"), "a")).toEqual(parseLogLines(Buffer.from("plain\n"), "a"));
  });

  it("keeps only the allowed bytes and destroys an unfinished stream", async () => {
    const stream = Readable.from([Buffer.from("123"), Buffer.from("456789")]);
    const result = await collectLogBytes(stream, 5);
    expect(result.bytes.toString()).toBe("12345");
    expect(result.truncated).toBe(true);
    expect(stream.destroyed).toBe(true);
  });
});

it("only lets CLI bearer authentication reach the exact recent-logs route", () => {
  expect(proxy(new NextRequest("http://localhost/api/services/logs/recent", { headers })).status).toBe(200);
  expect(proxy(new NextRequest("http://localhost/api/services/logs", { headers })).status).toBe(401);
  expect(proxy(new NextRequest("http://localhost/api/services/logs/recent")).status).toBe(401);
});
