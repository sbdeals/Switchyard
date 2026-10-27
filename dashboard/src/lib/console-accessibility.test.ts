import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleTab } from "../components/service/ConsoleTab";

const state = vi.hoisted(() => ({ running: false }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => react.useState(initial === false ? state.running : initial),
  };
});

afterEach(() => {
  state.running = false;
});

describe("console command accessibility", () => {
  it("names the command action before and during execution", () => {
    for (const running of [false, true]) {
      state.running = running;
      const html = renderToStaticMarkup(createElement(ConsoleTab, { appName: "test-app" }));
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*aria-label="Run command"/);
      if (running) expect(html).toContain("animate-spin");
    }
  });
});
