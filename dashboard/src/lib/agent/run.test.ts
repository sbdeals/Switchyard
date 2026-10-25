import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: "anthropic" as "anthropic" | "openai",
  role: vi.fn(),
  anthropicStream: vi.fn(),
  openaiStream: vi.fn(),
  runTool: vi.fn(),
}));

// The real chat route and both tool loops run, but no credential is loaded and
// no SDK/provider or deployment call is made.
vi.mock("../dokploy", () => ({
  getDokployRole: mocks.role,
  DokploySessionExpiredError: class extends Error {},
}));
vi.mock("./client", () => ({
  activeProvider: () => mocks.provider,
  isAgentConfigured: () => true,
  agentModel: () => "fixture-model",
  fallbackConfig: () => null,
  activeKeyIsOAuth: () => false,
  ensureAgentCredentialFresh: async () => {},
  getAnthropic: () => ({ messages: { stream: mocks.anthropicStream } }),
  getOpenAI: () => ({ chat: { completions: { create: mocks.openaiStream } } }),
}));
vi.mock("./tools", () => ({ toolSchemas: [], runTool: mocks.runTool }));
vi.mock("./store", () => ({ sessionKey: () => "fixture-session" }));

import { DokploySessionExpiredError } from "../dokploy";
import { SESSION_COOKIE, sealSession } from "../session";
import { POST } from "@/app/api/agent/chat/route";

function anthropicStream(names: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } };
    },
    finalMessage: async () => ({
      stop_reason: names.length ? "tool_use" : "end_turn",
      content: names.map((name) => ({ type: "tool_use", id: name, name, input: {} })),
    }),
  };
}

async function* openaiStream(names: string[]) {
  yield {
    choices: [{ delta: {
      content: "hello",
      tool_calls: names.map((name, index) => ({ index, id: name, function: { name, arguments: "{}" } })),
    } }],
  };
}

const outcome = { content: "ok", label: "Fixture tool", isError: false };
async function chat() {
  const token = sealSession({ dokployCookie: "sess=stream-fixture", email: "fixture@example.test", iat: Date.now() });
  const response = await POST(new Request("http://dashboard.test/api/agent/chat", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  }));
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('"type":"done"');
  for (const args of mocks.role.mock.calls) expect(args).toEqual(["sess=stream-fixture"]);
  return text;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
  mocks.role.mockReset().mockResolvedValue("admin");
  mocks.runTool.mockReset().mockResolvedValue(outcome);
  mocks.anthropicStream.mockReset()
    .mockImplementationOnce(() => anthropicStream(["first_tool", "second_tool"]))
    .mockImplementation(() => anthropicStream([]));
  mocks.openaiStream.mockReset()
    .mockImplementationOnce(() => openaiStream(["first_tool", "second_tool"]))
    .mockImplementation(() => openaiStream([]));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe.each(["anthropic", "openai"] as const)("%s streaming session checkpoints", (provider) => {
  beforeEach(() => { mocks.provider = provider; });
  const modelCalls = () => provider === "anthropic" ? mocks.anthropicStream : mocks.openaiStream;

  it("keeps valid tool results and the follow-up model response unchanged", async () => {
    const text = await chat();
    expect(text).not.toContain('"type":"error"');
    expect(text).toContain('"type":"text","text":"hello"');
    expect(mocks.runTool).toHaveBeenNthCalledWith(1, "first_tool", {}, { sessionKey: "fixture-session" });
    expect(mocks.runTool).toHaveBeenNthCalledWith(2, "second_tool", {}, { sessionKey: "fixture-session" });
    expect(modelCalls()).toHaveBeenCalledTimes(2);
    expect(mocks.role).toHaveBeenCalledTimes(5); // Route, two model calls, two tools.
  });

  it.each(["revoked", "unavailable"])("stops before the next tool when Dokploy is %s mid-turn", async (failure) => {
    mocks.runTool.mockImplementationOnce(async () => {
      mocks.role.mockRejectedValue(failure === "revoked" ? new DokploySessionExpiredError() : new Error("offline"));
      return outcome;
    });
    const text = await chat();
    expect(text).toContain('"type":"error"');
    expect(text).toContain(failure === "revoked" ? "Session expired. Sign in again" : "Could not verify your session");
    expect(text).not.toContain('"name":"second_tool"');
    expect(mocks.runTool).toHaveBeenCalledTimes(1);
    expect(modelCalls()).toHaveBeenCalledTimes(1);
  });

  it("blocks all tools if the session is revoked while the model is responding", async () => {
    mocks.role.mockResolvedValueOnce("admin").mockResolvedValueOnce("admin")
      .mockRejectedValue(new DokploySessionExpiredError());
    expect(await chat()).toContain("Session expired. Sign in again");
    expect(mocks.runTool).not.toHaveBeenCalled();
    expect(modelCalls()).toHaveBeenCalledTimes(1);
  });

  it("stops spending tokens when revocation happens after the last tool", async () => {
    mocks.runTool.mockResolvedValueOnce(outcome).mockImplementationOnce(async () => {
      mocks.role.mockRejectedValue(new DokploySessionExpiredError());
      return outcome;
    });
    expect(await chat()).toContain("Session expired. Sign in again");
    expect(mocks.runTool).toHaveBeenCalledTimes(2);
    expect(modelCalls()).toHaveBeenCalledTimes(1);
  });
});
