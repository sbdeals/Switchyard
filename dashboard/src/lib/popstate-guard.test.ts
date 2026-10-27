import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPopstateGuard, POPSTATE_GUARD_SCRIPT, replayPopstate } from "./popstate-guard";

function mount() {
  const listeners: ((event: PopStateEvent) => void)[] = [];
  const addEventListener = vi.fn((type: string, listener: (event: PopStateEvent) => void) => {
    if (type === "popstate") listeners.push(listener);
  });
  const dispatchEvent = vi.fn((event: PopStateEvent) => {
    listeners.forEach((listener) => listener(event));
    return true;
  });
  vi.stubGlobal("window", { addEventListener, dispatchEvent });
  const bootstrap = () => runInNewContext(POPSTATE_GUARD_SCRIPT, { window });
  bootstrap();
  return { bootstrap, addEventListener, dispatchEvent };
}

const pop = () => new Event("popstate") as PopStateEvent;
afterEach(() => vi.unstubAllGlobals());

describe("popstate guard bootstrap", () => {
  it("registers one listener and preserves the installed handler across repeated bootstrap", () => {
    const ui = mount();
    const guard = window.__switchyardPopstateGuard;
    const handler = vi.fn();
    installPopstateGuard(handler);
    ui.bootstrap();
    const event = pop();
    ui.dispatchEvent(event);

    expect(ui.addEventListener).toHaveBeenCalledExactlyOnceWith("popstate", expect.any(Function));
    expect(window.__switchyardPopstateGuard).toBe(guard);
    expect(handler).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("stays inert before installation and after cleanup while later listeners still run", () => {
    const ui = mount();
    const handler = vi.fn();
    const next = vi.fn();
    window.addEventListener("popstate", next);
    ui.dispatchEvent(pop());
    const cleanup = installPopstateGuard(handler);
    ui.dispatchEvent(pop());
    cleanup();
    ui.dispatchEvent(pop());

    expect(handler).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledTimes(3);
    expect(window.__switchyardPopstateGuard.handler).toBeNull();
  });

  it("does not let stale cleanup remove a newer handler", () => {
    const ui = mount();
    const first = vi.fn();
    const second = vi.fn();
    const cleanupFirst = installPopstateGuard(first);
    const cleanupSecond = installPopstateGuard(second);
    cleanupFirst();
    const event = pop();
    ui.dispatchEvent(event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(event);
    cleanupSecond();
    expect(window.__switchyardPopstateGuard.handler).toBeNull();
  });

  it("bypasses only the exact replay while new events and later reuse remain guarded", () => {
    const ui = mount();
    const handler = vi.fn();
    installPopstateGuard(handler);
    const replay = pop();
    const nested = pop();
    const next = vi.fn((event) => {
      if (event === replay && window.__switchyardPopstateGuard.replay === replay) {
        ui.dispatchEvent(nested);
      }
    });
    window.addEventListener("popstate", next);
    replayPopstate(replay);

    expect(handler).toHaveBeenCalledExactlyOnceWith(nested);
    expect(next).toHaveBeenCalledWith(replay);
    expect(window.__switchyardPopstateGuard.replay).toBeNull();
    ui.dispatchEvent(replay);
    expect(handler).toHaveBeenLastCalledWith(replay);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("clears the replay marker when dispatch throws", () => {
    const ui = mount();
    const handler = vi.fn();
    installPopstateGuard(handler);
    ui.dispatchEvent.mockImplementationOnce(() => { throw new Error("Dispatch failed"); });

    expect(() => replayPopstate(pop())).toThrow("Dispatch failed");
    expect(window.__switchyardPopstateGuard.replay).toBeNull();
    const event = pop();
    ui.dispatchEvent(event);
    expect(handler).toHaveBeenCalledExactlyOnceWith(event);
  });
});
