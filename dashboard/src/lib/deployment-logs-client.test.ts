import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeploymentLogs } from "../components/service/DeploymentLogs";
import type { Service } from "./dokploy";

// Deliberately do not mock server-only or Dokploy: this client component's
// imports must never pull in the authorized, server-only diagnosis log reader.
describe("deployment logs client boundary", () => {
  it("renders the requested older deployment without importing server credentials", () => {
    const service = {
      id: "app", kind: "application",
      deployments: [
        { deploymentId: "newer", title: "Newer deployment", status: "done" },
        { deploymentId: "requested", title: "Requested deployment", status: "error" },
      ],
    } as Service;
    const html = renderToStaticMarkup(createElement(DeploymentLogs, {
      service, deploymentId: "requested", onRuntimeLogs: () => {},
    }));
    expect(html).toContain("Requested deployment");
    expect(html).not.toContain("Newer deployment");
    expect(html).toContain("Runtime logs");
    expect(html).toContain("Loading deployment logs");
  });
});
