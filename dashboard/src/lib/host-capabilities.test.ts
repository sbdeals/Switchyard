import { describe, expect, it } from "vitest";
import {
  featureUnavailableReason,
  hostModeFromSwarm,
  type DockerSwarmState,
  type HostCapabilities,
  type HostFeature,
} from "./host-capabilities";

describe("hostModeFromSwarm", () => {
  it.each<[DockerSwarmState | null | undefined, HostCapabilities["mode"]]>([
    [{ LocalNodeState: "active", ControlAvailable: true }, "swarm"],
    [{ LocalNodeState: "active", ControlAvailable: false }, "worker"],
    [{ LocalNodeState: "inactive", ControlAvailable: false }, "bridge"],
    [{ LocalNodeState: "active" }, "unknown"],
    [{ LocalNodeState: "inactive", ControlAvailable: true }, "unknown"],
    [{ LocalNodeState: "pending", ControlAvailable: false }, "unknown"],
    [{ LocalNodeState: "locked", ControlAvailable: true }, "unknown"],
    [{ LocalNodeState: "error", ControlAvailable: false }, "unknown"],
    [{}, "unknown"],
    [undefined, "unknown"],
    [null, "unknown"],
  ])("classifies %j as %s", (swarm, expected) => {
    expect(hostModeFromSwarm(swarm)).toBe(expected);
  });
});

describe("featureUnavailableReason", () => {
  const swarmFeatures: HostFeature[] = [
    "nativeApplication",
    "replicas",
    "swarmHealthcheck",
    "schedules",
    "s3Backups",
  ];

  it.each(swarmFeatures)("explains why %s needs Swarm on a bridge host", (feature) => {
    expect(featureUnavailableReason({ mode: "bridge", dokployVersion: "0.30.10" }, feature))
      .toBe("Needs Docker Swarm — this host runs in bridge mode. Use a Compose service instead.");
  });

  it.each(swarmFeatures)("allows %s on an active Swarm manager", (feature) => {
    expect(featureUnavailableReason({ mode: "swarm", dokployVersion: "0.30.10" }, feature))
      .toBeNull();
  });

  it.each(swarmFeatures)("requires a manager for %s on a worker", (feature) => {
    expect(featureUnavailableReason({ mode: "worker", dokployVersion: "0.30.10" }, feature))
      .toContain("this host is a Swarm worker");
  });

  it.each<HostFeature>(["compose", ...swarmFeatures])("keeps %s enabled when detection fails", (feature) => {
    expect(featureUnavailableReason({ mode: "unknown", dokployVersion: "0.30.10" }, feature))
      .toBeNull();
  });

  it.each<HostCapabilities["mode"]>(["bridge", "swarm", "worker", "unknown"])(
    "keeps Compose available in %s mode",
    (mode) => {
      expect(featureUnavailableReason({ mode, dokployVersion: null }, "compose")).toBeNull();
    },
  );

  it("does not confuse an unreadable Dokploy version with an unreadable engine", () => {
    expect(featureUnavailableReason({ mode: "swarm", dokployVersion: null }, "nativeApplication"))
      .toBeNull();
    expect(featureUnavailableReason({ mode: "bridge", dokployVersion: null }, "nativeApplication"))
      .toContain("bridge mode");
  });
});
