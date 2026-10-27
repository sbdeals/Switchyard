"use client";

import { Monitor } from "lucide-react";

import { parseThemePreference } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <label className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] focus-within:ring-2 focus-within:ring-[var(--color-brand)]">
      <Monitor className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Theme</span>
      <select
        aria-label="Theme"
        value={preference}
        onChange={(event) => setPreference(parseThemePreference(event.target.value))}
        className="cursor-pointer bg-[var(--color-surface)] text-[var(--color-fg)] outline-none"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}
