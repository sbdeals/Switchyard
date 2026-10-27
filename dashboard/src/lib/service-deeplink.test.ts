import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "./dokploy";
import { createDirtyRegistry, decideDirtyNavigation } from "./dirty-guard";
import { useServiceDeeplink } from "../components/use-service-deeplink";

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn(),
  useCallback: vi.fn(),
  useTransition: vi.fn(),
  useSearchParams: vi.fn(),
  useGuardedNavigation: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("react", () => ({
  useState: mocks.useState,
  useEffect: mocks.useEffect,
  useLayoutEffect: mocks.useLayoutEffect,
  useRef: mocks.useRef,
  useCallback: mocks.useCallback,
  useTransition: mocks.useTransition,
}));
vi.mock("@/components/DirtyGuard", () => ({
  useGuardedNavigation: mocks.useGuardedNavigation,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: mocks.useSearchParams,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const services = [
  { id: "app", kind: "application" },
  { id: "db", kind: "database", engine: "postgres" },
] as Service[];

type Effect = { deps: unknown[]; cleanup?: void | (() => void) };

// Execute the real hook with persistent state/effects. Query re-renders and
// completion of router.refresh are explicit; browser proof covers Next itself.
function mount(path = "/", initialHistoryState: unknown = null) {
  const location = { href: new URL(path, "http://localhost:3067").href };
  const entries = [location.href];
  const entryStates = [initialHistoryState];
  let entry = 0;
  let refreshing = false;
  let dirty = false;
  let stateIndex = 0;
  let effectIndex = 0;
  let layoutIndex = 0;
  let refIndex = 0;
  let callbackIndex = 0;
  const states: unknown[] = [];
  const effects: Effect[] = [];
  const layouts: Effect[] = [];
  const refs: { current: unknown }[] = [];
  const callbacks: { deps: unknown[]; value: unknown }[] = [];
  let pending: (() => void)[] = [];
  let pendingLayouts: (() => void)[] = [];
  const listeners = new Set<{ listener: (event: PopStateEvent) => void; capture: boolean }>();
  const registry = createDirtyRegistry();
  let activeScope: string | null = null;
  let pendingNavigation: (() => void) | null = null;
  let session = 0;
  const guard = {
    getState: (scope: string | null) => ({
      labels: scope === null ? [] : registry.labels(scope),
      pending: pendingNavigation !== null,
    }),
    activateScope: vi.fn((scope: string | null) => {
      registry.retainScope(scope);
      if (activeScope === scope) return;
      activeScope = scope;
      pendingNavigation = null;
    }),
    navigate: vi.fn((action: () => void) => {
      const labels = activeScope === null ? [] : registry.labels(activeScope);
      const decision = decideDirtyNavigation(labels, pendingNavigation !== null);
      if (decision === "proceed") action();
      else if (decision === "confirm") pendingNavigation = action;
    }),
    get session() { return session; },
  };
  mocks.useGuardedNavigation.mockReturnValue(guard);

  function navigate(data: unknown, url: string | URL | null | undefined, replace: boolean) {
    location.href = new URL(String(url), location.href).href;
    if (replace) {
      entries[entry] = location.href;
      entryStates[entry] = data;
    } else {
      entries.splice(++entry, entries.length, location.href);
      entryStates.splice(entry, entryStates.length, data);
    }
    dirty = true;
  }
  const history = {
    pushState: vi.fn((data: unknown, _title: string, url?: string | URL | null) => navigate(data, url, false)),
    replaceState: vi.fn((data: unknown, _title: string, url?: string | URL | null) => navigate(data, url, true)),
    get state() { return entryStates[entry]; },
  };
  const addEventListener = vi.fn((type: string, listener: (event: PopStateEvent) => void, capture = false) => {
    if (type === "popstate") listeners.add({ listener, capture });
  });
  const removeEventListener = vi.fn((type: string, listener: (event: PopStateEvent) => void, capture = false) => {
    if (type !== "popstate") return;
    for (const entry of listeners) {
      if (entry.listener === listener && entry.capture === capture) listeners.delete(entry);
    }
  });
  vi.stubGlobal("PopStateEvent", class {
    type: string;
    state: unknown;
    stopped = false;
    constructor(type: string, options: { state?: unknown } = {}) {
      this.type = type;
      this.state = options.state;
    }
    stopImmediatePropagation = vi.fn(() => { this.stopped = true; });
  });
  const dispatchEvent = vi.fn((event: PopStateEvent) => {
    for (const { listener } of [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      listener(event);
      if ((event as unknown as { stopped: boolean }).stopped) break;
    }
    return true;
  });
  vi.stubGlobal("window", { location, history, setTimeout, clearTimeout, addEventListener, removeEventListener, dispatchEvent });
  mocks.useState.mockImplementation((initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (value: unknown) => {
      const next = typeof value === "function" ? value(states[index]) : value;
      if (!Object.is(states[index], next)) dirty = true;
      states[index] = next;
    }];
  });
  const sameDeps = (previous: unknown[], next: unknown[]) => previous.length === next.length &&
    next.every((dep, i) => Object.is(dep, previous[i]));
  function scheduleEffect(list: Effect[], queue: (() => void)[], index: number, run: () => void | (() => void), deps: unknown[]) {
    if (list[index] && sameDeps(list[index].deps, deps)) return;
    queue.push(() => {
      list[index]?.cleanup?.();
      list[index] = { deps, cleanup: run() };
    });
  }
  mocks.useEffect.mockImplementation((run: () => void | (() => void), deps: unknown[]) => {
    scheduleEffect(effects, pending, effectIndex++, run, deps);
  });
  mocks.useLayoutEffect.mockImplementation((run: () => void | (() => void), deps: unknown[]) => {
    scheduleEffect(layouts, pendingLayouts, layoutIndex++, run, deps);
  });
  mocks.useRef.mockImplementation((initial: unknown) => {
    const index = refIndex++;
    if (!(index in refs)) refs[index] = { current: initial };
    return refs[index];
  });
  mocks.useCallback.mockImplementation((value: unknown, deps: unknown[]) => {
    const index = callbackIndex++;
    if (!callbacks[index] || !sameDeps(callbacks[index].deps, deps)) callbacks[index] = { deps, value };
    return callbacks[index].value;
  });
  const startRefresh = (run: () => void) => {
    refreshing = true;
    run();
  };
  mocks.useTransition.mockImplementation(() => [refreshing, startRefresh]);

  function flushEffects() {
    const layoutCallbacks = pendingLayouts;
    const callbacks = pending;
    pendingLayouts = [];
    pending = [];
    layoutCallbacks.forEach((run) => run());
    callbacks.forEach((run) => run());
  }

  function render(nextServices = services, flush = true) {
    let value: ReturnType<typeof useServiceDeeplink>;
    let renders = 0;
    do {
      if (++renders > 10) throw new Error("Hook did not settle after state updates");
      dirty = false;
      stateIndex = 0;
      effectIndex = 0;
      layoutIndex = 0;
      refIndex = 0;
      callbackIndex = 0;
      pending = [];
      pendingLayouts = [];
      mocks.useSearchParams.mockReturnValue(new URL(location.href).searchParams);
      // eslint-disable-next-line react-hooks/rules-of-hooks -- This harness supplies the mocked React lifecycle.
      value = useServiceDeeplink(nextServices);
      if (!dirty && flush) flushEffects();
    } while (dirty);
    return value;
  }

  function travel(delta: number) {
    const next = entry + delta;
    if (next < 0 || next >= entries.length) throw new Error("No history entry in that direction");
    entry = next;
    location.href = entries[entry];
    const event = new PopStateEvent("popstate", { state: entryStates[entry] });
    dispatchEvent(event);
    return event;
  }

  return {
    location, history, render, flushEffects, guard, registry, entries, addEventListener, removeEventListener, dispatchEvent,
    back: () => travel(-1),
    forward: () => travel(1),
    markDirty: (label = "Variables") => {
      if (activeScope === null) throw new Error("No active form scope");
      registry.set("form", label, true, activeScope);
    },
    keep: () => { pendingNavigation = null; },
    discard: () => {
      const action = pendingNavigation;
      pendingNavigation = null;
      if (!action) throw new Error("No pending confirmation");
      registry.clear();
      session++;
      action();
    },
    get pending() { return pendingNavigation !== null; },
    get listenerCount() { return listeners.size; },
    finishRefresh: () => { refreshing = false; },
    unmount: () => {
      for (const effect of [...layouts, ...effects]) effect?.cleanup?.();
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("service drawer navigation", () => {
  it("pushes opening/closing and replaces tabs while preserving unrelated params and hash", () => {
    const hook = mount("/workspace?project=one&filter=a&filter=b#canvas");
    expect(hook.render().service).toBeNull();
    hook.render().open("app");
    expect(hook.history.pushState).toHaveBeenLastCalledWith(
      null, "", "/workspace?project=one&filter=a&filter=b&service=app&tab=overview#canvas",
    );
    expect(hook.render().service).toBe(services[0]);
    hook.render().selectTab("logs");
    expect(hook.history.replaceState).toHaveBeenLastCalledWith(
      null, "", "/workspace?project=one&filter=a&filter=b&service=app&tab=logs#canvas",
    );
    expect(hook.render().tab).toBe("logs");
    hook.render().close();
    expect(hook.history.pushState).toHaveBeenLastCalledWith(
      null, "", "/workspace?project=one&filter=a&filter=b#canvas",
    );
    expect(hook.render().service).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("restores the previous service and tab, then closes, on Back and reopens on Forward", () => {
    const hook = mount();
    hook.render().open("app");
    hook.render().selectTab("logs");
    hook.render().open("db");
    hook.render().selectTab("data");
    hook.back();
    expect(hook.render()).toMatchObject({ service: services[0], tab: "logs" });
    hook.back();
    expect(hook.render().service).toBeNull();
    hook.forward();
    expect(hook.render()).toMatchObject({ service: services[0], tab: "logs" });
    hook.forward();
    expect(hook.render()).toMatchObject({ service: services[1], tab: "data" });
    hook.render().close();
    hook.back();
    expect(hook.render()).toMatchObject({ service: services[1], tab: "data" });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("restores a pasted link immediately without a navigation or refresh", () => {
    const hook = mount("/?service=db&tab=data");
    expect(hook.render()).toMatchObject({ service: services[1], tab: "data", notFound: false });
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not create duplicate history entries for unchanged selections", () => {
    const hook = mount("/?service=app&tab=overview");
    hook.render().open("app");
    hook.render().selectTab("overview");
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).not.toHaveBeenCalled();
  });
});

describe("invalid drawer links", () => {
  it("removes stale service and tab parameters and shows a brief notice after repair", () => {
    const hook = mount("/?project=one&service=removed&tab=logs#canvas");
    expect(hook.render()).toMatchObject({ service: null, tab: "overview", notFound: true });
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/?project=one#canvas");
    expect(hook.render().notFound).toBe(true);
    vi.advanceTimersByTime(3999);
    expect(hook.render().notFound).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hook.render().notFound).toBe(false);
    expect(hook.history.replaceState).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(hook.guard.navigate).not.toHaveBeenCalled();
  });

  it("repairs unsupported service tabs to Overview without a missing-service notice", () => {
    const hook = mount("/?project=one&service=app&tab=backups#canvas");
    expect(hook.render()).toMatchObject({ service: services[0], tab: "overview", notFound: false });
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(
      null, "", "/?project=one&service=app#canvas",
    );
    hook.render();
    expect(hook.history.replaceState).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer URL when an older invalid-link effect runs", () => {
    const hook = mount("/?service=removed");
    hook.render(services, false);
    hook.location.href = "http://localhost:3067/?service=app&tab=logs";
    hook.flushEffects();
    expect(hook.history.replaceState).not.toHaveBeenCalled();
    expect(hook.render()).toMatchObject({ service: services[0], tab: "logs" });
  });
});

describe("newly created service links", () => {
  it("waits for the refreshed authorized service before writing its link", () => {
    const hook = mount();
    hook.render().onDeployed("new-app");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.location.href).toBe("http://localhost:3067/");
    expect(hook.render()).toMatchObject({ service: null, notFound: false });
    expect(hook.history.replaceState).not.toHaveBeenCalled();
    const created = { ...services[0], id: "new-app" };
    hook.finishRefresh();
    expect(hook.render([...services, created])).toMatchObject({ service: created, tab: "overview", notFound: false });
    expect(hook.history.pushState).toHaveBeenCalledExactlyOnceWith(
      null, "", "/?service=new-app&tab=overview",
    );
    expect(hook.history.replaceState).not.toHaveBeenCalled();
  });

  it("shows a missing-service notice without writing an unknown service URL", () => {
    const hook = mount();
    hook.render().onDeployed("new-app");
    hook.render();
    hook.finishRefresh();
    expect(hook.render()).toMatchObject({ service: null, notFound: true });
    expect(hook.location.href).toBe("http://localhost:3067/");
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).not.toHaveBeenCalled();
  });
});

describe("dirty drawer navigation", () => {
  it.each(["close", "tab", "service"])("keeps the current form until a dirty %s change is discarded", (change) => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    const before = hook.location.href;
    const attempt = () => {
      const drawer = hook.render();
      if (change === "close") drawer.close();
      else if (change === "tab") drawer.selectTab("settings");
      else drawer.open("db");
    };

    attempt();
    expect(hook.pending).toBe(true);
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
    expect(hook.location.href).toBe(before);
    expect(hook.render()).toMatchObject({ service: services[0], tab: "variables" });
    attempt();
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).not.toHaveBeenCalled();

    hook.keep();
    expect(hook.location.href).toBe(before);
    expect(hook.registry.labels()).toEqual(["Variables"]);
    attempt();
    expect(hook.guard.navigate).toHaveBeenCalledTimes(2);
    hook.discard();
    const destination = hook.render();
    expect(destination.service).toBe(change === "close" ? null : change === "service" ? services[1] : services[0]);
    expect(destination.tab).toBe(change === "tab" ? "settings" : "overview");
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.pending).toBe(false);
  });

  it("ignores the same service and tab while dirty without a confirmation", () => {
    const hook = mount("/?service=app&tab=overview");
    hook.render();
    hook.markDirty("Settings");
    hook.render().open("app");
    hook.render().selectTab("overview");
    expect(hook.guard.navigate).not.toHaveBeenCalled();
    expect(hook.registry.labels()).toEqual(["Settings"]);
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).not.toHaveBeenCalled();
  });

  it.each(["back", "forward"] as const)("restores the dirty URL synchronously on %s, then applies Discard", (direction) => {
    const hook = mount("/?service=app&tab=variables");
    hook.render().open("db");
    hook.render();
    if (direction === "forward") {
      hook.back();
      hook.render();
    }
    hook.markDirty();
    const previous = hook.location.href;
    const event = hook[direction]();

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(hook.location.href).toBe(previous);
    expect(hook.pending).toBe(true);
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
    expect(hook.render().service).toBe(direction === "back" ? services[1] : services[0]);
    hook.discard();
    expect(hook.render()).toMatchObject({
      service: direction === "back" ? services[0] : services[1],
      tab: direction === "back" ? "variables" : "overview",
    });
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.pending).toBe(false);
  });

  it("repeated Back and Keep preserves the form without growing history", () => {
    const hook = mount();
    hook.render().open("app");
    hook.render().selectTab("variables");
    hook.render();
    hook.markDirty();
    const before = hook.location.href;
    const count = hook.entries.length;

    for (let attempt = 0; attempt < 3; attempt++) {
      hook.back();
      expect(hook.location.href).toBe(before);
      expect(hook.pending).toBe(true);
      hook.keep();
      expect(hook.render()).toMatchObject({ service: services[0], tab: "variables" });
      expect(hook.entries).toHaveLength(count);
      expect(hook.registry.labels()).toEqual(["Variables"]);
    }
    expect(hook.guard.navigate).toHaveBeenCalledTimes(3);
  });

  it("restores a repeated popstate while a confirmation is pending without opening another prompt", () => {
    const hook = mount();
    hook.render().open("app");
    hook.render();
    hook.markDirty();
    const before = hook.location.href;
    hook.back();
    hook.render();
    const repeated = hook.back();
    expect(repeated.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(hook.location.href).toBe(before);
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
    expect(hook.pending).toBe(true);
    hook.discard();
    expect(hook.render().service).toBeNull();
  });

  it("preserves source history state and replays an accepted popstate once with its target state", () => {
    const targetState = { tree: "workspace" };
    const sourceState = { tree: "application" };
    const hook = mount("/projects", targetState);
    hook.render();
    hook.history.pushState(sourceState, "", "/workspace?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    const observer = vi.fn();
    hook.addEventListener("popstate", observer, false);

    hook.back();
    expect(observer).not.toHaveBeenCalled();
    expect(hook.history.state).toBe(sourceState);
    expect(hook.location.href).toBe("http://localhost:3067/workspace?service=app&tab=variables");
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
    hook.discard();
    expect(hook.history.state).toBe(targetState);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer.mock.calls[0][0].state).toBe(targetState);
    expect(hook.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
    expect(hook.pending).toBe(false);
    expect(hook.location.href).toBe("http://localhost:3067/projects");
    expect(hook.render().service).toBeNull();
  });

  it.each(["unknown", "removed", "unowned", "%E0%A4%A"])("repairs a clean invalid service target without confirming: %s", (id) => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.render().open(id);
    expect(hook.guard.navigate).not.toHaveBeenCalled();
    expect(hook.pending).toBe(false);
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.render()).toMatchObject({ service: null, tab: "overview", notFound: true });
    expect(new URL(hook.location.href).searchParams.has("service")).toBe(false);
    expect(hook.history.pushState).not.toHaveBeenCalled();
  });

  it.each(["unknown", "removed", "unowned", "%E0%A4%A"])("keeps dirty edits until an invalid service target is discarded: %s", (id) => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    const before = hook.location.href;
    hook.render().open(id);
    expect(hook.pending).toBe(true);
    expect(hook.location.href).toBe(before);
    expect(hook.render()).toMatchObject({ service: services[0], tab: "variables", notFound: false });
    hook.keep();
    expect(hook.registry.labels()).toEqual(["Variables"]);
    expect(hook.location.href).toBe(before);
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).not.toHaveBeenCalled();

    hook.render().open(id);
    expect(hook.guard.navigate).toHaveBeenCalledTimes(2);
    hook.discard();
    expect(hook.render()).toMatchObject({ service: null, tab: "overview", notFound: true });
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.pending).toBe(false);
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/");
  });

  it("repairs a clean invalid tab to Overview without a prompt", () => {
    const hook = mount("/?service=app&tab=variables");
    hook.render().selectTab("backups");
    expect(hook.guard.navigate).not.toHaveBeenCalled();
    expect(hook.render()).toMatchObject({ service: services[0], tab: "overview", notFound: false });
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/?service=app");
  });

  it("keeps dirty edits on an invalid tab until Discard and ignores another pending target", () => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    const before = hook.location.href;
    hook.render().selectTab("backups");
    expect(hook.pending).toBe(true);
    expect(hook.location.href).toBe(before);
    expect(hook.render()).toMatchObject({ service: services[0], tab: "variables", notFound: false });
    hook.keep();
    expect(hook.registry.labels()).toEqual(["Variables"]);
    expect(hook.history.replaceState).not.toHaveBeenCalled();

    hook.render().selectTab("backups");
    hook.render().open("db");
    expect(hook.guard.navigate).toHaveBeenCalledTimes(2);
    expect(hook.location.href).toBe(before);
    hook.discard();
    expect(hook.pending).toBe(false);
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.render()).toMatchObject({ service: services[0], tab: "overview", notFound: false });
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/?service=app");
    expect(hook.history.pushState).not.toHaveBeenCalled();
  });

  it("preserves a pending valid request when another invalid target is attempted", () => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    hook.render().open("db");
    hook.render().selectTab("backups");
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
    expect(hook.pending).toBe(true);
    expect(hook.registry.labels()).toEqual(["Variables"]);
    expect(hook.history.replaceState).not.toHaveBeenCalled();
    hook.discard();
    expect(hook.render()).toMatchObject({ service: services[1], tab: "overview", notFound: false });
  });

  it.each([false, true])("silently repairs the same destination while retaining its dirty registration (pending=%s)", (pending) => {
    const hook = mount("/?service=app&tab=overview");
    hook.render();
    hook.markDirty("Settings");
    if (pending) hook.render().open("db");
    hook.render().selectTab("backups");
    expect(hook.guard.navigate).toHaveBeenCalledTimes(pending ? 1 : 0);
    expect(hook.pending).toBe(pending);
    expect(hook.render()).toMatchObject({ service: services[0], tab: "overview", notFound: false });
    expect(hook.registry.labels()).toEqual(["Settings"]);
    expect(hook.location.href).toBe("http://localhost:3067/?service=app");
    if (pending) {
      hook.discard();
      expect(hook.render().service).toBe(services[1]);
    }
  });

  it.each([
    ["/?service=unowned&tab=logs", null, true],
    ["/?service=app&tab=backups", services[0], false],
  ] as const)("repairs a clean invalid popped target without prompting: %s", (path, service, notFound) => {
    const hook = mount(path);
    hook.history.pushState(null, "", "/?service=app&tab=variables");
    hook.render();
    const event = hook.back();
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(hook.guard.navigate).not.toHaveBeenCalled();
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.pending).toBe(false);
    expect(hook.render()).toMatchObject({ service, tab: "overview", notFound });
    expect(hook.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["/?service=unowned&tab=logs", null, true, "/"],
    ["/?service=app&tab=backups", services[0], false, "/?service=app"],
  ] as const)("keeps dirty edits across repeated invalid Back targets until Discard: %s", (path, service, notFound, repairedPath) => {
    const hook = mount(path);
    hook.history.pushState(null, "", "/?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    const before = hook.location.href;
    const count = hook.entries.length;
    const observer = vi.fn();
    hook.addEventListener("popstate", observer, false);

    for (let attempt = 0; attempt < 3; attempt++) {
      const event = hook.back();
      expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
      expect(hook.location.href).toBe(before);
      expect(hook.pending).toBe(true);
      expect(hook.render()).toMatchObject({ service: services[0], tab: "variables", notFound: false });
      hook.keep();
      expect(hook.entries).toHaveLength(count);
      expect(hook.registry.labels()).toEqual(["Variables"]);
      expect(observer).not.toHaveBeenCalled();
    }
    expect(hook.guard.navigate).toHaveBeenCalledTimes(3);
    expect(hook.dispatchEvent).toHaveBeenCalledTimes(3);

    hook.back();
    hook.render();
    const repeated = hook.back();
    expect(repeated.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(hook.location.href).toBe(before);
    expect(hook.entries).toHaveLength(count);
    expect(hook.guard.navigate).toHaveBeenCalledTimes(4);
    expect(hook.pending).toBe(true);
    expect(observer).not.toHaveBeenCalled();
    expect(hook.dispatchEvent).toHaveBeenCalledTimes(5);
    hook.discard();
    expect(hook.render()).toMatchObject({ service, tab: "overview", notFound });
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.pending).toBe(false);
    expect(hook.entries).toHaveLength(count);
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", repairedPath);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(hook.dispatchEvent).toHaveBeenCalledTimes(6);
  });

  it("revalidates a destination removed while confirmation is pending before writing its URL", () => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    hook.render().open("db");
    hook.render([services[0]]);
    expect(hook.pending).toBe(true);
    hook.discard();
    expect(hook.render([services[0]])).toMatchObject({ service: null, notFound: true });
    expect(hook.location.href).toBe("http://localhost:3067/");
    expect(hook.history.pushState).not.toHaveBeenCalled();
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/");
    expect(hook.registry.labels()).toEqual([]);
  });

  it("clears the pending request when the current service disappears", () => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.markDirty();
    hook.render().open("db");
    expect(hook.pending).toBe(true);
    expect(hook.render([services[1]])).toMatchObject({ service: null, notFound: true });
    expect(hook.pending).toBe(false);
    expect(hook.registry.labels()).toEqual([]);
    expect(hook.guard.navigate).toHaveBeenCalledTimes(1);
  });

  it("maintains one capture listener across renders and removes it on unmount", () => {
    const hook = mount("/?service=app&tab=variables");
    hook.render();
    hook.render();
    expect(hook.listenerCount).toBe(1);
    expect(hook.addEventListener).toHaveBeenCalledExactlyOnceWith("popstate", expect.any(Function), true);
    hook.render().selectTab("settings");
    hook.render();
    expect(hook.listenerCount).toBe(1);
    expect(hook.removeEventListener).toHaveBeenCalledWith("popstate", expect.any(Function), true);
    hook.unmount();
    expect(hook.listenerCount).toBe(0);
  });
});
