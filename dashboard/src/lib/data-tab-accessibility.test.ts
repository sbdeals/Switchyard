import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "./dokploy";

const state = vi.hoisted(() => ({ mode: "browse", calls: 0, result: null as unknown }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      const index = state.calls++;
      if (index === 0) initial = state.mode;
      if (index === 1) initial = [{ key: "test-pg", name: "test-pg", db: "demo", user: "demo", image: "postgres" }];
      if (index === 7 && state.mode === "sql") initial = state.result;
      return react.useState(initial);
    },
  };
});
vi.mock("@/components/service/primitives", () => ({ inputCls: "" }));
vi.mock("@/lib/utils", () => import("./utils"));
vi.mock("@/lib/tab-navigation", () => import("./tab-navigation"));

import { DataTab } from "../components/service/DataTab";

describe("Postgres data view accessibility", () => {
  beforeEach(() => {
    state.calls = 0;
    state.result = null;
  });

  it.each(["browse", "sql"])("links %s to its panel with one tab stop", (mode) => {
    state.mode = mode;
    const html = renderToStaticMarkup(createElement(DataTab, {
      service: { appName: "test-pg" } as Service,
    }));
    expect(html).toContain('role="tablist" aria-label="Data view"');
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(([tag]) => tag);
    expect(tabs).toHaveLength(2);
    const active = mode === "browse" ? 0 : 1;
    const selectedId = tabs[active].match(/ id="([^"]+)"/)![1];
    const panelId = tabs[active].match(/ aria-controls="([^"]+)"/)![1];
    expect(tabs[active]).toContain('aria-selected="true"');
    expect(tabs[active]).toContain('tabindex="0"');
    expect(tabs[1 - active]).toContain('aria-selected="false"');
    expect(tabs[1 - active]).toContain('tabindex="-1"');
    expect(tabs[1 - active]).toContain(`aria-controls="${panelId}"`);
    expect(html).toContain(`id="${panelId}" role="tabpanel" aria-labelledby="${selectedId}" tabindex="0"`);
  });

  it("uses the contrast-tested idle token for NULL badges", () => {
    state.mode = "sql";
    state.result = { columns: ["value"], rows: [[null], [""]], rowCount: 2, ms: 1, truncated: false };
    const html = renderToStaticMarkup(createElement(DataTab, {
      service: { appName: "test-pg" } as Service,
    }));
    expect(html).toMatch(/<span class="[^"]*bg-\[var\(--color-idle-soft\)\][^"]*text-\[var\(--color-idle\)\][^"]*">NULL<\/span>/);
  });
});
