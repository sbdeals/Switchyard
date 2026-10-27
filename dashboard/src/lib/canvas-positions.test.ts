import { describe, expect, it } from "vitest";
import { pruneCanvasPositions } from "./canvas-positions";

describe("pruneCanvasPositions", () => {
  it("retains positions for filtered-out projects while removing deleted services", () => {
    const positions = {
      visible: { x: 100, y: 200 },
      hiddenProject: { x: 500, y: 300 },
      deleted: { x: 0, y: 0 },
    };
    expect(pruneCanvasPositions(positions, ["visible", "hiddenProject", "newService"])).toEqual({
      visible: positions.visible,
      hiddenProject: positions.hiddenProject,
    });
    expect(positions.deleted).toEqual({ x: 0, y: 0 });
  });

  it("clears saved positions when no workspace services remain", () => {
    expect(pruneCanvasPositions({ deleted: { x: 1, y: 2 } }, [])).toEqual({});
  });
});
