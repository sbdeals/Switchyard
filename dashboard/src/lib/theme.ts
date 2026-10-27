export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "switchyard-theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "dark";
}

export function resolveTheme(value: unknown, prefersDark: boolean): Theme {
  const preference = parseThemePreference(value);
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}

// Runs in <head> before paint. Keep this dependency-free; tests check parity with
// the resolution helpers, including browsers that deny access to localStorage.
export const THEME_INIT_SCRIPT = `(function(){var p="dark";try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system")p="dark";var t=p;if(p==="system")t=window.matchMedia(${JSON.stringify(THEME_MEDIA_QUERY)}).matches?"dark":"light";document.documentElement.dataset.themePreference=p;document.documentElement.dataset.theme=t})()`;
