import { describe, expect, it } from "vitest";
import { imageTagOptions, nextTagIndex } from "./image-tag-picker";

const tags = [
  { name: "alpine", lastPushed: "2026-10-01T00:00:00Z" },
  { name: "1.28", lastPushed: "2026-09-01T00:00:00Z" },
];

describe("imageTagOptions", () => {
  it("shows recent tags on focus and marks the saved tag independently of edits", () => {
    expect(imageTagOptions("nginx:1.28", "nginx:alpine", tags, false)).toEqual([
      { ...tags[0], current: true }, { ...tags[1], current: false },
    ]);
  });

  it("searches the typed tag without requiring a listed tag", () => {
    expect(imageTagOptions("nginx:ALP", "nginx:alpine", tags, true)).toEqual([{ ...tags[0], current: true }]);
    expect(imageTagOptions("nginx:custom", "nginx:alpine", tags, true)).toEqual([]);
  });

  it("keeps a saved tag outside the recent page visible, including implicit latest", () => {
    const options = imageTagOptions("docker.io/library/nginx", "nginx", tags, false);
    expect(options.at(-1)).toEqual({ name: "latest", lastPushed: null, current: true });
    expect(imageTagOptions("nginx", "nginx:old", tags, false).at(-1)?.name).toBe("old");
    expect(tags).toHaveLength(2);
  });

  it("does not carry the saved tag to a different repository or registry", () => {
    for (const image of ["redis", "other/nginx", "ghcr.io/library/nginx", "invalid ref"]) {
      const options = imageTagOptions(image, "nginx:old", tags, false);
      expect(options).toHaveLength(2);
      expect(options.some((tag) => tag.current)).toBe(false);
    }
  });

  it("does not call a digest-only reference latest, but marks a tag with a digest", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(imageTagOptions("nginx", `nginx@${digest}`, tags, false).some((tag) => tag.current)).toBe(false);
    expect(imageTagOptions("nginx", `nginx:alpine@${digest}`, tags, false)[0].current).toBe(true);
  });
});

describe("nextTagIndex", () => {
  it("opens at the first or last option and stays within bounds", () => {
    expect(nextTagIndex("ArrowDown", -1, 2)).toBe(0);
    expect(nextTagIndex("ArrowDown", 0, 2)).toBe(1);
    expect(nextTagIndex("ArrowDown", 1, 2)).toBe(1);
    expect(nextTagIndex("ArrowUp", -1, 2)).toBe(1);
    expect(nextTagIndex("ArrowUp", 1, 2)).toBe(0);
    expect(nextTagIndex("ArrowUp", 0, 2)).toBe(0);
  });

  it("never activates an absent option or selects one on other keys", () => {
    expect(nextTagIndex("ArrowDown", -1, 0)).toBe(-1);
    expect(nextTagIndex("ArrowUp", 1, 0)).toBe(-1);
    expect(nextTagIndex("a", -1, 2)).toBe(-1);
  });
});
