import { describe, expect, it } from "vitest";
import { nextTabIndex } from "./tab-navigation";

describe("nextTabIndex", () => {
  it("moves in either direction and wraps at the ends", () => {
    expect(nextTabIndex("ArrowRight", 1, 3)).toBe(2);
    expect(nextTabIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("jumps to the first and last tabs", () => {
    expect(nextTabIndex("Home", 2, 4)).toBe(0);
    expect(nextTabIndex("End", 1, 4)).toBe(3);
  });

  it("leaves Tab, vertical arrows, and activation keys to the browser", () => {
    for (const key of ["Tab", "ArrowUp", "ArrowDown", "Enter", " ", "Escape"]) {
      expect(nextTabIndex(key, 1, 3)).toBeNull();
    }
  });

  it("keeps a single tab selected and ignores unavailable tab lists", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(nextTabIndex(key, 0, 1)).toBe(0);
      expect(nextTabIndex(key, 0, 0)).toBeNull();
      expect(nextTabIndex(key, -1, 3)).toBeNull();
      expect(nextTabIndex(key, 3, 3)).toBeNull();
    }
  });
});
