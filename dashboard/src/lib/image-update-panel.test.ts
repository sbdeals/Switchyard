import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageUpdateDetails, ImageUpdatePanel } from "../components/service/ImageUpdatePanel";
import type { ImageUpdateResult } from "./image-update";

describe("image update display", () => {
  it.each([
    ["up-to-date", "Up to date"],
    ["update-available", "Update available"],
    ["unknown", "Unknown"],
  ] as const)("labels %s and shows full digests", (status, label) => {
    const result: ImageUpdateResult = {
      image: "nginx:alpine",
      runningDigest: `sha256:${"a".repeat(64)}`,
      registryDigest: `sha256:${"b".repeat(64)}`,
      status,
      reason: null,
      checkedAt: "2026-10-26T00:00:00.000Z",
    };
    const html = renderToStaticMarkup(createElement(ImageUpdateDetails, { result }));
    expect(html).toContain(label);
    expect(html).toContain("Configured image");
    expect(html).toContain(result.image);
    expect(html).toContain(result.runningDigest);
    expect(html).toContain(result.registryDigest);
    expect(html).toContain(`dateTime="${result.checkedAt}"`);
  });

  it("explains unknown and distinguishes compose container images", () => {
    const html = renderToStaticMarkup(createElement(ImageUpdateDetails, {
      compose: true,
      result: {
        image: `nginx@sha256:${"a".repeat(64)}`,
        runningDigest: null,
        registryDigest: null,
        status: "unknown",
        reason: "Image is pinned by digest.",
        checkedAt: null,
        serviceName: "web",
      },
    }));
    expect(html).toContain("Unknown");
    expect(html).toContain("Image is pinned by digest.");
    expect(html).toContain("Container image");
    expect(html).toContain("web");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Registry checked");
  });

  it.each(["application", "database"] as const)("starts %s checks with an explicit manual control", (kind) => {
    const html = renderToStaticMarkup(createElement(ImageUpdatePanel, {
      kind, id: "owned-service", image: "redis:7",
    }));
    expect(html).toContain("Check now");
    expect(html).toContain("Unknown");
    expect(html).toContain("redis:7");
    expect(html).toContain("cached for 10 minutes");
    expect(html).not.toContain("Up to date");
    expect(html).not.toContain("Registry checked");
  });
});
