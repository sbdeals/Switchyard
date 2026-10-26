import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "./dokploy";
import { useServiceDeeplink } from "../components/use-service-deeplink";

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useEffect: vi.fn(),
  useTransition: vi.fn(),
  useSearchParams: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("react", () => ({
  useState: mocks.useState,
  useEffect: mocks.useEffect,
  useTransition: mocks.useTransition,
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
function mount(path = "/") {
  const location = { href: new URL(path, "http://localhost:3067").href };
  const entries = [location.href];
  let entry = 0;
  let refreshing = false;
  let dirty = false;
  let stateIndex = 0;
  let effectIndex = 0;
  const states: unknown[] = [];
  const effects: Effect[] = [];
  let pending: (() => void)[] = [];

  function navigate(url: string | URL | null | undefined, replace: boolean) {
    location.href = new URL(String(url), location.href).href;
    if (replace) entries[entry] = location.href;
    else entries.splice(++entry, entries.length, location.href);
  }
  const history = {
    pushState: vi.fn((_data: unknown, _title: string, url?: string | URL | null) => navigate(url, false)),
    replaceState: vi.fn((_data: unknown, _title: string, url?: string | URL | null) => navigate(url, true)),
  };
  vi.stubGlobal("window", { location, history, setTimeout, clearTimeout });
  mocks.useState.mockImplementation((initial: unknown) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (value: unknown) => {
      if (!Object.is(states[index], value)) dirty = true;
      states[index] = value;
    }];
  });
  mocks.useEffect.mockImplementation((run: () => void | (() => void), deps: unknown[]) => {
    const index = effectIndex++;
    if (effects[index] && deps.every((dep, i) => Object.is(dep, effects[index].deps[i]))) return;
    pending.push(() => {
      effects[index]?.cleanup?.();
      effects[index] = { deps, cleanup: run() };
    });
  });
  mocks.useTransition.mockImplementation(() => [refreshing, (run: () => void) => {
    refreshing = true;
    run();
  }]);

  function flushEffects() {
    const callbacks = pending;
    pending = [];
    callbacks.forEach((run) => run());
  }

  function render(nextServices = services, flush = true) {
    mocks.useSearchParams.mockReturnValue(new URL(location.href).searchParams);
    let value: ReturnType<typeof useServiceDeeplink>;
    let renders = 0;
    do {
      if (++renders > 10) throw new Error("Hook did not settle after state updates");
      dirty = false;
      stateIndex = 0;
      effectIndex = 0;
      pending = [];
      // eslint-disable-next-line react-hooks/rules-of-hooks -- This harness supplies the mocked React lifecycle.
      value = useServiceDeeplink(nextServices);
    } while (dirty);
    if (flush) flushEffects();
    return value;
  }

  return {
    location, history, render, flushEffects,
    back: () => { location.href = entries[--entry]; },
    forward: () => { location.href = entries[++entry]; },
    finishRefresh: () => { refreshing = false; },
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
  it("keeps the new link while refresh is pending, then opens the arriving service", () => {
    const hook = mount();
    hook.render().onDeployed("new-app");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(hook.history.pushState).toHaveBeenCalledExactlyOnceWith(
      null, "", "/?service=new-app&tab=overview",
    );
    expect(hook.render()).toMatchObject({ service: null, notFound: false });
    expect(hook.history.replaceState).not.toHaveBeenCalled();
    const created = { ...services[0], id: "new-app" };
    hook.finishRefresh();
    expect(hook.render([...services, created])).toMatchObject({ service: created, tab: "overview", notFound: false });
    expect(hook.history.replaceState).not.toHaveBeenCalled();
  });

  it("repairs a service still missing after refresh completes", () => {
    const hook = mount();
    hook.render().onDeployed("new-app");
    hook.render();
    hook.finishRefresh();
    expect(hook.render()).toMatchObject({ service: null, notFound: true });
    expect(hook.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/");
  });
});
