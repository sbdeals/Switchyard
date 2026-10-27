"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import {
  parseThemePreference,
  resolveTheme,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
} from "@/lib/theme";

const THEME_CHANGE_EVENT = "switchyard-theme-change";

function applyTheme(preference: ThemePreference, prefersDark: boolean) {
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

function getSnapshot() {
  const { themePreference, theme } = document.documentElement.dataset;
  return `${parseThemePreference(themePreference)}:${theme === "light" ? "light" : "dark"}`;
}

function getServerSnapshot() {
  return "dark:dark";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(THEME_MEDIA_QUERY);
  const update = () => {
    applyTheme(parseThemePreference(document.documentElement.dataset.themePreference), media.matches);
    onChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      applyTheme(parseThemePreference(event.newValue), media.matches);
      onChange();
    }
  };
  media.addEventListener("change", update);
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, update);
  update();
  return () => {
    media.removeEventListener("change", update);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, update);
  };
}

function setPreference(preference: ThemePreference) {
  applyTheme(preference, window.matchMedia(THEME_MEDIA_QUERY).matches);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The current tab still works when browser storage is disabled.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

const ThemeContext = createContext<{
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}>({ theme: "dark", preference: "dark", setPreference: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [preference, theme] = snapshot.split(":") as [ThemePreference, Theme];
  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
