"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/login/actions";

/** Small sign-out control; posts the logout Server Action. */
export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => logoutAction())}
      title="Sign out"
      className="fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-30 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] disabled:opacity-60 max-lg:min-h-10"
    >
      <LogOut className="size-3.5" />
      Sign out
    </button>
  );
}
