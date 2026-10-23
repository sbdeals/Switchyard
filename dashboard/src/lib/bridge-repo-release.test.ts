import { describe, expect, it } from "vitest";
import { AUTOMATIC_PORT_FIXUP_TITLE, repoReleaseTiming } from "@/lib/bridge-repo-release";

const first = { title: "Deployment", createdAt: "2026-10-23T10:00:00Z" };
const fixup = { title: AUTOMATIC_PORT_FIXUP_TITLE, createdAt: "2026-10-23T10:01:00Z" };
const redeploy = { title: "Deployment", createdAt: "2026-10-23T10:02:00Z" };

describe("repo release timing", () => {
  it("uses the first deploy timestamp when the newest deployment is a port fix-up", () => {
    const deployments = [first, fixup];
    expect(repoReleaseTiming(deployments)).toEqual({
      timestamp: first.createdAt,
      includesPortFixup: true,
    });
    expect(deployments).toEqual([first, fixup]);
  });

  it("selects the newest user deploy from an unsorted deployment list", () => {
    expect(repoReleaseTiming([fixup, first, redeploy])).toEqual({
      timestamp: redeploy.createdAt,
      includesPortFixup: false,
    });
  });

  it.each(["automatic port fix-up", "Automatic port fix-up ", "Automatic port fix-up failed"])(
    "only excludes the exact fix-up title, not %s", (title) => {
      expect(repoReleaseTiming([first, { ...fixup, title }])).toEqual({
        timestamp: fixup.createdAt,
        includesPortFixup: false,
      });
    }
  );

  it("falls back to the newest deployment when only port fix-ups are available", () => {
    expect(repoReleaseTiming([{ ...first, title: AUTOMATIC_PORT_FIXUP_TITLE }, fixup])).toEqual({
      timestamp: fixup.createdAt,
      includesPortFixup: true,
    });
  });

  it("has no timestamp or fix-up note before the first deployment", () => {
    expect(repoReleaseTiming([])).toEqual({ timestamp: "", includesPortFixup: false });
  });
});
