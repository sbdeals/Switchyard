import { describe, expect, it } from "vitest";
import {
  deploymentStatusLabel,
  detectDeploymentEvents,
  eventsForProject,
  formatDeploymentDuration,
  markAllRead,
  mergeActivity,
  parseStoredActivity,
  visibleActivity,
  type DeploymentEvent,
  type DeploymentServiceSnapshot,
  type DeploymentSnapshot,
} from "./deploy-notifications";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const iso = (offset: number) => new Date(NOW + offset).toISOString();

function deployment(status: string, overrides: Partial<DeploymentSnapshot> = {}): DeploymentSnapshot {
  return { deploymentId: "deploy-1", status, createdAt: iso(-10_000), ...overrides };
}

function service(deployments: DeploymentSnapshot[], overrides: Partial<DeploymentServiceSnapshot> = {}): DeploymentServiceSnapshot {
  return { id: "service-1", name: "api", projectId: "project-1", kind: "compose", deployments, ...overrides };
}

function event(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
  const value: DeploymentEvent = {
    id: "",
    serviceId: "service-1",
    serviceKind: "compose",
    serviceName: "api",
    projectId: "project-1",
    deploymentId: "deploy-1",
    status: "done",
    durationMs: 10_000,
    finishedAt: iso(0),
    read: false,
    ...overrides,
  };
  value.id = JSON.stringify([value.projectId, value.serviceKind, value.serviceId, value.deploymentId]);
  return value;
}

describe("detectDeploymentEvents", () => {
  it("seeds completed history on first load without notifications", () => {
    const services = [service([
      deployment("done"),
      deployment("error", { deploymentId: "deploy-2" }),
      deployment("cancelled", { deploymentId: "deploy-3" }),
    ])];
    const initial = detectDeploymentEvents(null, services, NOW);
    expect(initial.events).toEqual([]);
    expect(detectDeploymentEvents(initial.tracker, services, NOW + 1000).events).toEqual([]);
  });

  it.each([
    ["done", "done"],
    ["error", "error"],
    ["cancelled", "cancelled"],
    ["canceled", "cancelled"],
  ])("reports a running to %s transition as %s", (status, expected) => {
    const initial = detectDeploymentEvents(null, [service([deployment("running")])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment(status, {
      startedAt: iso(-8000), finishedAt: iso(2000),
    })])], NOW + 3000);
    expect(result.events).toEqual([event({ status: expected as DeploymentEvent["status"], finishedAt: iso(2000) })]);
    expect(initial.tracker.services.values().next().value?.deployments.get("deploy-1")).toBe(false);
  });

  it("does not report queued or running deployments as complete", () => {
    const initial = detectDeploymentEvents(null, [service([deployment("queued")])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("running")])], NOW + 1000);
    expect(result.events).toEqual([]);
  });

  it("deduplicates repeated, missing, and stale deployment rows", () => {
    const initial = detectDeploymentEvents(null, [service([deployment("running")])], NOW);
    const done = service([deployment("done"), deployment("done")]);
    const completed = detectDeploymentEvents(initial.tracker, [done], NOW + 1000);
    expect(completed.events).toHaveLength(1);
    const missing = detectDeploymentEvents(completed.tracker, [], NOW + 2000);
    const stale = detectDeploymentEvents(missing.tracker, [service([deployment("running")])], NOW + 3000);
    expect(detectDeploymentEvents(stale.tracker, [done], NOW + 4000).events).toEqual([]);
    expect(detectDeploymentEvents(completed.tracker, [service([deployment("error")])], NOW + 4000).events).toEqual([]);
  });

  it("reports multiple services and keeps deployment IDs scoped to their service", () => {
    const services = [service([deployment("running")]), service([deployment("running")], {
      id: "service-2", name: "worker", kind: "application",
    })];
    const initial = detectDeploymentEvents(null, services, NOW);
    const result = detectDeploymentEvents(initial.tracker, services.map((item, index) => ({
      ...item, deployments: [deployment(index === 0 ? "done" : "error")],
    })), NOW + 1000);
    expect(result.events.map((item) => [item.serviceName, item.status])).toEqual([["api", "done"], ["worker", "error"]]);
    expect(new Set(result.events.map((item) => item.id)).size).toBe(2);
  });

  it("detects a quick deployment completed entirely between polls", () => {
    const initial = detectDeploymentEvents(null, [service([])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("done", {
      createdAt: iso(1000), finishedAt: iso(2000),
    })])], NOW + 3000);
    expect(result.events).toEqual([event({ durationMs: 1000, finishedAt: iso(2000) })]);
  });

  it("does not notify about old history added to a later response", () => {
    const initial = detectDeploymentEvents(null, [service([])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("error")])], NOW + 1000);
    expect(result.events).toEqual([]);
  });

  it("quietly seeds history when another service first becomes visible", () => {
    const initial = detectDeploymentEvents(null, [service([])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([]), service([
      deployment("done"), deployment("running", { deploymentId: "active" }),
    ], { id: "service-2" })], NOW + 1000);
    expect(result.events).toEqual([]);
    const completed = detectDeploymentEvents(result.tracker, [service([
      deployment("done", { deploymentId: "active" }),
    ], { id: "service-2" })], NOW + 2000);
    expect(completed.events).toHaveLength(1);
  });

  it("notifies when a newly created service finishes its first deploy between polls", () => {
    const initial = detectDeploymentEvents(null, [service([])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("done", {
      createdAt: iso(1000), finishedAt: iso(2000),
    })], { id: "new-service", createdAt: iso(500) })], NOW + 3000);
    expect(result.events).toEqual([event({ serviceId: "new-service", durationMs: 1000, finishedAt: iso(2000) })]);
  });

  it("still seeds newly visible existing services quietly, even with recent deployments", () => {
    const initial = detectDeploymentEvents(null, [service([])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("done", {
      createdAt: iso(1000), finishedAt: iso(2000),
    })], { id: "newly-visible", createdAt: iso(-60_000) })], NOW + 3000);
    expect(result.events).toEqual([]);
  });

  it("never emits on first load even if service timestamps appear newer than the browser clock", () => {
    const result = detectDeploymentEvents(null, [service([deployment("done", {
      createdAt: iso(1000), finishedAt: iso(2000),
    })], { createdAt: iso(500) })], NOW);
    expect(result.events).toEqual([]);
  });

  it("does not seed unavailable deployment data", () => {
    const initial = detectDeploymentEvents(null, [service([], { deployments: undefined })], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("done", {
      createdAt: iso(1000),
    })])], NOW + 2000);
    expect(result.events).toEqual([]);
  });

  it("keeps an in-flight deployment across temporary detail failures", () => {
    const initial = detectDeploymentEvents(null, [service([deployment("running")])], NOW);
    const missing = detectDeploymentEvents(initial.tracker, [service([], { deployments: undefined })], NOW + 1000);
    expect(detectDeploymentEvents(missing.tracker, [service([deployment("done")])], NOW + 2000).events).toHaveLength(1);
  });

  it("falls back to createdAt and observation time for missing timestamps", () => {
    const initial = detectDeploymentEvents(null, [service([deployment("running")])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("done", {
      startedAt: "invalid", finishedAt: null,
    })])], NOW + 2000);
    expect(result.events[0]).toMatchObject({ durationMs: 12_000, finishedAt: iso(2000) });
  });

  it.each([
    { createdAt: "invalid", startedAt: null },
    { createdAt: iso(3000), startedAt: iso(3000) },
  ])("uses an unavailable duration for invalid or inverted timestamps: %j", (timestamps) => {
    const initial = detectDeploymentEvents(null, [service([deployment("running")])], NOW);
    const result = detectDeploymentEvents(initial.tracker, [service([deployment("done", {
      ...timestamps, finishedAt: iso(2000),
    })])], NOW + 3000);
    expect(result.events[0].durationMs).toBeNull();
  });
});

describe("recent activity", () => {
  it("keeps the latest 20 events in descending completion order", () => {
    const events = Array.from({ length: 25 }, (_, index) => event({
      deploymentId: `deploy-${index}`, finishedAt: iso(index * 1000),
    }));
    const result = mergeActivity(events.slice(0, 10), events.slice(10));
    expect(result).toHaveLength(20);
    expect(result[0].deploymentId).toBe("deploy-24");
    expect(result[19].deploymentId).toBe("deploy-5");
  });

  it("deduplicates events without resetting their read state", () => {
    const read = event({ read: true });
    expect(mergeActivity([read], [event()])).toEqual([read]);
  });

  it("marks all events read without modifying the input", () => {
    const events = [event(), event({ deploymentId: "deploy-2", read: true })];
    expect(markAllRead(events).every((item) => item.read)).toBe(true);
    expect(events[0].read).toBe(false);
  });

  it("filters events to the selected project, or includes all projects", () => {
    const events = [event(), event({ projectId: "project-2" })];
    expect(eventsForProject(events, "project-1")).toEqual([events[0]]);
    expect(eventsForProject(events, null)).toEqual(events);
    expect(eventsForProject(events, "missing")).toEqual([]);
  });

  it("shows only accessible services and uses their current names", () => {
    const events = [event(), event({ serviceId: "removed" }), event({ projectId: "another-user" }), event({ serviceKind: "application" })];
    expect(visibleActivity(events, [service([], { name: "renamed-api" })])).toEqual([
      event({ serviceName: "renamed-api" }),
    ]);
    expect(visibleActivity(events, [])).toEqual([]);
  });

  it("loads valid stored activity while deduplicating and preserving read state", () => {
    const stored = event({ read: true });
    expect(parseStoredActivity(JSON.stringify([stored, stored]))).toEqual([stored]);
  });

  it.each([null, "", "{", "null", "{}", "42", "[null, 1, [], {}]"])("ignores invalid storage: %s", (value) => {
    expect(parseStoredActivity(value)).toEqual([]);
  });

  it("rejects invalid event fields without losing valid events", () => {
    const valid = event();
    const invalid = [
      { ...valid, id: "forged-id" },
      { ...valid, serviceName: 42 },
      { ...valid, serviceKind: "" },
      { ...valid, status: "running" },
      { ...valid, read: "false" },
      { ...valid, durationMs: -1 },
      { ...valid, durationMs: "1000" },
      { ...valid, finishedAt: "invalid" },
    ];
    expect(parseStoredActivity(JSON.stringify([...invalid, valid]))).toEqual([valid]);
  });
});

describe("notification labels", () => {
  it("distinguishes successful, failed, and cancelled deployments", () => {
    expect(deploymentStatusLabel("done")).toBe("Succeeded");
    expect(deploymentStatusLabel("error")).toBe("Failed");
    expect(deploymentStatusLabel("cancelled")).toBe("Cancelled");
  });

  it.each([
    [null, "Duration unavailable"],
    [0, "0s"],
    [1499, "1s"],
    [59_500, "1m 0s"],
    [63_000, "1m 3s"],
  ])("formats duration %s as %s", (duration, expected) => {
    expect(formatDeploymentDuration(duration)).toBe(expected);
  });
});
