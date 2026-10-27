import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiagnosisCard, DiagnosisDetails } from "../components/service/DiagnosisCard";
import type { DeploymentDiagnosis, DiagnosisTab } from "./deploy-diagnosis";

function render(tab: DiagnosisTab | null, serviceKind: "application" | "compose" = "application", patch: Partial<DeploymentDiagnosis> = {}) {
  return renderToStaticMarkup(createElement(DiagnosisDetails, {
    diagnosis: {
      ruleId: "fixture",
      cause: "Build failed",
      excerpt: "Error: test failure",
      fix: "Correct the configuration and redeploy.",
      tab,
      ...patch,
    },
    serviceKind,
    onNavigate: () => {},
  }));
}

describe("Diagnosis card", () => {
  it("shows a loading state while reading the deployment log", () => {
    const html = renderToStaticMarkup(createElement(DiagnosisCard, {
      deploymentId: "failed-deployment",
      serviceKind: "application",
      onNavigate: () => {},
    }));
    expect(html).toContain("Diagnosis");
    expect(html).toContain("Reading build log");
    expect(html).not.toContain("No known pattern");
  });

  it("escapes HTML in log excerpts, causes and fixes", () => {
    const html = render("variables", "application", {
      cause: "<script>alert(1)</script>",
      excerpt: '<img src=x onerror="alert(1)"> & DATABASE_URL is not defined',
      fix: "Set <DATABASE_URL>.",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;DATABASE_URL&gt;");
  });

  it.each([
    ["settings", "Settings"],
    ["variables", "Variables"],
    ["build", "Build"],
    ["deploy", "Deploy"],
    ["domains", "Networking"],
  ] as const)("links application fixes to %s", (tab, label) => {
    expect(render(tab)).toContain(`href="#drawer-tab-${tab}"`);
    expect(render(tab)).toContain(`Open ${label}`);
  });

  it.each(["build", "editor", "settings", "deploy", "domains"] as const)("links Compose %s fixes to the YAML editor", (tab) => {
    expect(render(tab, "compose")).toContain('href="#drawer-tab-editor"');
    expect(render(tab, "compose")).toContain("Open Compose");
  });

  it("keeps Compose environment fixes in Variables", () => {
    expect(render("variables", "compose")).toContain('href="#drawer-tab-variables"');
  });

  it("does not link applications to a nonexistent Compose tab", () => {
    expect(render("editor")).toContain('href="#drawer-tab-build"');
  });

  it("labels unmatched log tails without inventing a fix", () => {
    const html = render(null, "application", { ruleId: null, cause: "No known pattern", fix: null });
    expect(html).toContain("No known pattern");
    expect(html).toContain("Last 20 build log lines:");
    expect(html).not.toContain("href=");
  });
});
