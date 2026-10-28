import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "./dokploy";

type Control = { tag: string; props: Record<string, unknown> };
const ui = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, controls: [] as Control[],
  effects: [] as (() => void | (() => void))[], fetch: vi.fn(), refresh: vi.fn(),
}));
// The repository uses server-rendered component tests. Capture handlers/effects
// and retain their state updates so errors are checked in actual rendered UI.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = ui.cursor++;
      if (!(index in ui.states)) ui.states[index] = typeof initial === "function" ? initial() : initial;
      return [ui.states[index], (next: unknown) => {
        ui.states[index] = typeof next === "function" ? next(ui.states[index]) : next;
      }];
    },
    useEffect: (effect: () => void | (() => void)) => { ui.effects.push(effect); },
    useTransition: () => [false, (action: () => void) => action()],
  };
});
vi.mock("react/jsx-runtime", async (original) => {
  const runtime = await original<typeof import("react/jsx-runtime")>();
  const capture = (fn: typeof runtime.jsx): typeof runtime.jsx => (type, props, key) => {
    if (typeof type === "string") ui.controls.push({ tag: type, props: props as Record<string, unknown> });
    return fn(type, props, key);
  };
  return { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) };
});
vi.mock("react/jsx-dev-runtime", async (original) => {
  const runtime = await original<typeof import("react/jsx-dev-runtime")>();
  const jsxDEV: typeof runtime.jsxDEV = (type, props, ...rest) => {
    if (typeof type === "string") ui.controls.push({ tag: type, props: props as Record<string, unknown> });
    return runtime.jsxDEV(type, props, ...rest);
  };
  return { ...runtime, jsxDEV };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: ui.refresh }) }));
vi.mock("@/lib/client-actions", () => ({}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    aside: ({ children, className }: { children: ReactNode; className: string }) => createElement("aside", { className }, children),
    div: ({ children, className }: { children: ReactNode; className: string }) => createElement("div", { className }, children),
  },
}));

import { ConsoleTab } from "../components/service/ConsoleTab";
import { DataTab } from "../components/service/DataTab";
import { LogsTab } from "../components/service/LogsTab";
import { MetricsTab } from "../components/service/MetricsTab";
import { AgentPanel } from "../components/agent/AgentPanel";
import { SESSION_EXPIRED_MESSAGE } from "./action-call";
import { isSessionExpired, setSessionExpired } from "./session-expiry";

const cleanups: (() => void)[] = [];
class TestEventSource {
  static latest: TestEventSource;
  onopen?: () => void;
  onerror?: () => void;
  addEventListener = vi.fn();
  close = vi.fn();
  constructor() { TestEventSource.latest = this; }
}
function render(element: ReactNode) {
  ui.cursor = 0;
  ui.controls = [];
  ui.effects = [];
  return renderToStaticMarkup(element);
}
function mountEffects() {
  for (const effect of ui.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}
function control(matches: (control: Control) => boolean) {
  const found = ui.controls.find(matches);
  expect(found).toBeDefined();
  return found!.props;
}
function change(matches: (control: Control) => boolean, value: string) {
  (control(matches).onChange as (e: { target: { value: string } }) => void)({ target: { value } });
}
function click(matches: (control: Control) => boolean) {
  return (control(matches).onClick as () => void | Promise<void>)();
}
const settle = () => vi.advanceTimersByTimeAsync(0);
const config = {
  configured: true, source: "ui", masked: "masked", provider: "anthropic", baseUrl: null,
  model: "test-model", models: [{ id: "test-model", label: "Test", hint: "" }], presets: [],
};

beforeEach(() => {
  ui.states = [];
  ui.fetch.mockReset();
  ui.refresh.mockReset();
  setSessionExpired(false);
  vi.useFakeTimers();
  vi.stubGlobal("fetch", ui.fetch);
  vi.stubGlobal("EventSource", TestEventSource);
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setSessionExpired(false);
});

describe.each([
  [401, "unauthenticated", SESSION_EXPIRED_MESSAGE],
  [403, "forbidden", "Unknown or unmanaged service."],
  [503, "unavailable", "Workspace unavailable."],
] as const)("client rendering of HTTP %s", (status, code, message) => {
  beforeEach(() => { ui.fetch.mockImplementation(async () => Response.json({ error: message, code }, { status })); });
  afterEach(() => expect(isSessionExpired()).toBe(status === 401));

  it("shows an exec rejection in the console transcript", async () => {
    const element = createElement(ConsoleTab, { appName: "test" });
    render(element);
    change(({ tag }) => tag === "input", "echo draft");
    render(element);
    (control(({ tag }) => tag === "form").onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await settle();
    const html = render(element);
    expect(html).toContain(message);
    expect(html).toContain("echo draft");
  });

  it("shows a Postgres rejection instead of attempting to parse plain text as JSON", async () => {
    const element = createElement(DataTab, { service: { appName: "test" } as Service });
    render(element);
    mountEffects();
    await settle();
    expect(render(element)).toContain(message);
  });

  it("shows EventSource authorization failures after probing the failed stream", async () => {
    const element = createElement(LogsTab, { appName: "test", active: true });
    render(element);
    mountEffects();
    TestEventSource.latest.onerror!();
    await settle();
    expect(render(element)).toContain(message);
    expect(ui.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows log-download errors without saving an error response as a file", async () => {
    const element = createElement(LogsTab, { appName: "test", active: false });
    render(element);
    await click(({ tag, props }) => tag === "button" && Array.isArray(props.children) && props.children.includes(" Download .log"));
    expect(render(element)).toContain(message);
  });

  it.each(["/api/services/metrics", "/api/services/metrics/history", "/api/services/http-metrics"])("renders errors from polling %s", async (path) => {
    ui.fetch.mockImplementation(async (url: string) => new URL(url, "http://dashboard.test").pathname === path
      ? Response.json({ error: message, code }, { status })
      : Response.json({ enabled: false, samples: [], status: "not-running", sample: null, available: false, points: [] }));
    const element = createElement(MetricsTab, { appName: "test", active: true });
    render(element);
    mountEffects();
    await settle();
    expect(render(element)).toContain(message);
  });

  it("shows agent configuration read errors", async () => {
    const element = createElement(AgentPanel);
    render(element);
    await click(({ props }) => props["aria-label"] === "Open agent");
    render(element);
    mountEffects();
    await settle();
    expect(render(element)).toContain(message);
  });

  async function agent(write: "key" | "chat" | "provider") {
    ui.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ error: message, code }, { status });
      return Response.json(url.endsWith("/config") ? { ...config, configured: write !== "key" } : { configured: write !== "key", changes: [] });
    });
    const element = createElement(AgentPanel);
    render(element);
    await click(({ props }) => props["aria-label"] === "Open agent");
    render(element);
    mountEffects();
    await settle();
    render(element);
    return element;
  }

  it("keeps the key draft and shows a failed agent configuration write", async () => {
    const element = await agent("key");
    change(({ props }) => props.type === "password", "test-key-draft");
    render(element);
    await click(({ tag, props }) => tag === "button" && props.children === "Save");
    expect(render(element)).toContain(message);
    expect(control(({ props }) => props.type === "password").value).toBe("test-key-draft");
    expect(ui.refresh).not.toHaveBeenCalled();
  });

  it("stops a multi-step provider change on the first rejection and displays it", async () => {
    const element = await agent("provider");
    change(({ tag }) => tag === "select", "custom");
    await settle();
    expect(render(element)).toContain(message);
    expect(ui.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("keeps the chat draft and renders the error without refreshing away editor state", async () => {
    const element = await agent("chat");
    change(({ tag }) => tag === "textarea", "Inspect my service");
    render(element);
    await click(({ props }) => props["aria-label"] === "Send");
    await settle();
    expect(render(element)).toContain(message);
    expect(control(({ tag }) => tag === "textarea").value).toBe("Inspect my service");
    expect(ui.refresh).not.toHaveBeenCalled();
  });
});
