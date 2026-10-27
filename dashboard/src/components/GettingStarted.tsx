"use client";

import { useState, useSyncExternalStore } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import type { ProjectNode, Service } from "@/lib/dokploy";
import {
  dismissOnboarding,
  getOnboardingChecklist,
  isOnboardingDismissed,
  type OnboardingItem,
} from "@/lib/onboarding";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function GettingStarted({
  projects,
  services,
  userId,
  onNavigate,
}: {
  projects: ProjectNode[];
  services: Service[];
  userId: string | null;
  onNavigate: (item: OnboardingItem) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const storedDismissal = useSyncExternalStore(
    subscribe,
    () => isOnboardingDismissed(userId),
    () => false,
  );
  const checklist = getOnboardingChecklist(projects, services);
  if (dismissed || storedDismissal || checklist.complete) return null;

  return (
    <aside
      aria-labelledby="getting-started-title"
      className="mt-6 w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-4 shadow-lg sm:max-w-xs md:[@media(min-height:900px)]:fixed md:bottom-5 md:left-5 md:z-20"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="getting-started-title" className="text-sm font-semibold">Getting started</h2>
          <p aria-live="polite" className="mt-1 text-xs text-[var(--color-fg-muted)]">
            {checklist.completedCount} of {checklist.items.length} complete
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss getting started"
          onClick={() => {
            dismissOnboarding(userId);
            setDismissed(true);
          }}
          className="rounded-md p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-3 space-y-1">
        {checklist.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onNavigate(item)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs hover:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            >
              {item.done
                ? <CheckCircle2 className="size-4 shrink-0 text-[var(--color-brand)]" aria-hidden="true" />
                : <Circle className="size-4 shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />}
              <span className="sr-only">{item.done ? "Complete: " : "To do: "}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
