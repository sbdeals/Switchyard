import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { parseThemePreference, resolveTheme, THEME_INIT_SCRIPT, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from "./theme";

describe("theme preferences", () => {
  it.each(["light", "dark", "system"] as const)("accepts the saved %s preference", (preference) => {
    expect(parseThemePreference(preference)).toBe(preference);
  });

  it.each([null, undefined, "", "invalid", "LIGHT", false, {}])("defaults invalid preference %j to dark", (value) => {
    expect(parseThemePreference(value)).toBe("dark");
    expect(resolveTheme(value, false)).toBe("dark");
    expect(resolveTheme(value, true)).toBe("dark");
  });

  it.each([false, true])("honors explicit themes regardless of system dark=%s", (prefersDark) => {
    expect(resolveTheme("light", prefersDark)).toBe("light");
    expect(resolveTheme("dark", prefersDark)).toBe("dark");
  });

  it("follows the current system preference only in System mode", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });
});

describe("theme prepaint script", () => {
  it.each(["light", "dark", "system", null, "invalid", "LIGHT", ""])(
    "matches runtime resolution for stored %j before either system theme paints",
    (stored) => {
      for (const prefersDark of [false, true]) {
        const dataset: Record<string, string> = {};
        runInNewContext(THEME_INIT_SCRIPT, {
          localStorage: {
            getItem: (key: string) => {
              expect(key).toBe(THEME_STORAGE_KEY);
              return stored;
            },
          },
          window: {
            matchMedia: (query: string) => {
              expect(query).toBe(THEME_MEDIA_QUERY);
              return { matches: prefersDark };
            },
          },
          document: { documentElement: { dataset } },
        });
        expect(dataset.themePreference).toBe(parseThemePreference(stored));
        expect(dataset.theme).toBe(resolveTheme(stored, prefersDark));
      }
    },
  );

  it("keeps the dark default when localStorage is blocked", () => {
    const dataset: Record<string, string> = {};
    runInNewContext(THEME_INIT_SCRIPT, {
      get localStorage() { throw new Error("Storage disabled"); },
      document: { documentElement: { dataset } },
    });
    expect(dataset).toEqual({ themePreference: "dark", theme: "dark" });
  });
});
