import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeployment } from "./dokploy";

const lifecycle = vi.hoisted(() => ({
  seedClock: false,
  now: 0,
  effects: [] as Array<() => void | (() => void)>,
  updateClock: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (lifecycle.seedClock) {
        lifecycle.seedClock = false;
        return [lifecycle.now, lifecycle.updateClock];
      }
      return react.useState(initial);
    },
    useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: lifecycle.refresh }) }));
vi.mock("@/app/actions", () => ({}));
vi.mock("@/components/service/primitives", () => ({}));
vi.mock("@/lib/utils", () => ({}));
vi.mock("@/lib/deploy-stats", () => import("./deploy-stats"));

import { DeploymentHistory } from "../components/service/AppTabs";

const start = "2026-10-26T12:00:00.000Z";
const startMs = Date.parse(start);
const deployment = (patch: Partial<AppDeployment> = {}): AppDeployment => ({
  deploymentId: "deploy-1",
  title: "Deploy one",
  status: "done",
  createdAt: start,
  startedAt: start,
  finishedAt: new Date(startMs + 72_000).toISOString(),
  rollbackId: null,
  ...patch,
});

function render(deployments: AppDeployment[]) {
  lifecycle.seedClock = true;
  lifecycle.effects = [];
  return renderToStaticMarkup(createElement(DeploymentHistory, { deployments }));
}

beforeEach(() => {
  lifecycle.now = startMs + 120_000;
  lifecycle.updateClock.mockClear();
  lifecycle.refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("deployment history presentation", () => {
  it("keeps the empty history clear without fabricated summary metrics", () => {
    const html = render([]);
    expect(html).toContain("No deployments yet.");
    expect(html).not.toContain("Deployment insights");
    expect(html).not.toContain("<svg");
  });

  it("shows measured duration and summary values while explaining missing timing", () => {
    const html = render([
      deployment(),
      deployment({ deploymentId: "missing", title: "Missing timing", status: "error", startedAt: null }),
    ]);
    expect(html).toContain("Last 2 deployments");
    expect(html).toContain(">50%</dd>");
    expect(html).toContain("Median duration");
    expect(html).toContain("p90 duration");
    expect(html).toContain(">1m 12s</dd>");
    expect(html).toContain("1 completed duration sample");
    expect(html).toContain('title="duration unavailable" aria-label="duration unavailable"');
    expect(html).toContain("Missing timestamps: duration unavailable (—).");
    expect(html).toContain("Missing timing: error, duration unavailable.");
  });

  it("shows relative creation time, absolute tooltips, last successful finish and rollback", () => {
    const html = render([deployment({ rollbackId: "rollback-one" })]);
    expect(html).toContain(">2m ago</span>");
    expect(html).toContain(">48s ago</dd>");
    expect(html).toContain('title="2026-10-26 12:00:00.000 UTC"');
    expect(html).toContain('title="2026-10-26 12:01:12.000 UTC"');
    expect(html).toContain('title="Roll back to this deployment"');
    expect(html).toContain("Roll back</button>");
    expect(html).toContain('class="sr-only">done</span>');
  });

  it("falls back to successful creation time and handles an invalid row timestamp", () => {
    const html = render([
      deployment({ finishedAt: null }),
      deployment({ deploymentId: "invalid", status: "error", createdAt: "invalid", startedAt: null }),
    ]);
    expect(html).toContain(">2m ago</dd>");
    expect(html).toContain('title="Time unavailable">—</span>');
    expect(html).toContain('title="duration unavailable"');
  });

  it("draws proportional status bars oldest first with a dash for unavailable timing", () => {
    const html = render([
      deployment({ deploymentId: "long", title: "Long", createdAt: new Date(startMs + 1000).toISOString() }),
      deployment({ deploymentId: "short", title: "Short", status: "error", finishedAt: new Date(startMs + 36_000).toISOString() }),
      deployment({ deploymentId: "queued", title: "Queued", status: "queued", createdAt: new Date(startMs + 2000).toISOString() }),
    ]);
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
    expect(svg).toContain('role="img"');
    expect(svg).toContain("Dashes: duration unavailable.");
    expect(svg.indexOf("Short: error")).toBeLessThan(svg.indexOf("Long: done"));
    expect(svg).toContain('height="16" rx="1" fill="var(--color-danger)"');
    expect(svg).toContain('height="32" rx="1" fill="var(--color-ok)"');
    expect(svg).toContain('stroke="var(--color-idle)"');
    expect(svg).toContain("Queued: queued, duration unavailable.");
  });

  it("preserves real zero duration without inventing bar height", () => {
    const html = render([deployment({ finishedAt: start })]);
    expect(html).toContain('height="0" rx="1"');
    expect(html).toContain('aria-label="0s"');
    expect(html).not.toContain("<line");
  });
});

describe("deployment history timer lifecycle", () => {
  function mountClock(deployments: AppDeployment[]) {
    vi.useFakeTimers();
    vi.setSystemTime(lifecycle.now);
    vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
    const html = render(deployments);
    const cleanup = lifecycle.effects[0]();
    if (!cleanup) throw new Error("Expected timer cleanup");
    vi.advanceTimersByTime(0);
    lifecycle.updateClock.mockClear();
    return { html, cleanup };
  }

  it("ticks measurable running deployments, refreshes completion and cleans up on unmount", () => {
    lifecycle.now = startMs + 34_000;
    const { html, cleanup } = mountClock([deployment({ status: "running", finishedAt: null })]);
    expect(html).toContain('aria-label="running 34s"');
    vi.advanceTimersByTime(1000);
    expect(lifecycle.updateClock).toHaveBeenLastCalledWith(startMs + 35_000);
    vi.advanceTimersByTime(4000);
    expect(lifecycle.refresh).toHaveBeenCalledTimes(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(lifecycle.refresh).toHaveBeenCalledTimes(1);
    expect(lifecycle.updateClock).toHaveBeenCalledTimes(5);
  });

  it("stops ticking and refreshing when refreshed history reports completion", () => {
    const running = mountClock([deployment({ status: "running", finishedAt: null })]);
    vi.advanceTimersByTime(1000);
    running.cleanup();
    render([deployment()]);
    const cleanup = lifecycle.effects[0]();
    vi.advanceTimersByTime(0);
    lifecycle.updateClock.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(lifecycle.updateClock).not.toHaveBeenCalled();
    expect(lifecycle.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    cleanup?.();
  });

  it("refreshes a running deployment without timing without starting an elapsed timer", () => {
    const { html, cleanup } = mountClock([deployment({ status: "running", startedAt: null, finishedAt: null })]);
    expect(html).toContain('aria-label="duration unavailable"');
    vi.advanceTimersByTime(5000);
    expect(lifecycle.updateClock).not.toHaveBeenCalled();
    expect(lifecycle.refresh).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
