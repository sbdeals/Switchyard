"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/login/actions";
import { ThemeToggle } from "./ThemeToggle";

/** Small sign-out control; posts the logout Server Action. */
export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
      <ThemeToggle />
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => logoutAction())}
        title="Sign out"
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-60"
      >
        <LogOut className="size-3.5" />
        Sign out
      </button>
    </div>
  );
}
