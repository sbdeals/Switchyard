"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/components/use-focus-trap";
import { createDirtyRegistry, decideDirtyNavigation, discardMessage } from "@/lib/dirty-guard";

type GuardContext = {
  register: (key: string, label: string, dirty: boolean) => void;
  unregister: (key: string) => void;
  navigate: (action: () => void, sameTarget?: boolean) => void;
};

const DirtyContext = createContext<GuardContext | null>(null);

function useGuardContext() {
  const context = useContext(DirtyContext);
  if (!context) throw new Error("DirtyGuardProvider is required");
  return context;
}

/** Each mounted form owns its registration, even when several share a label. */
export function useDirtyGuard(id: string, dirty: boolean) {
  const key = useId();
  const { register, unregister } = useGuardContext();
  useLayoutEffect(() => {
    register(key, id, dirty);
    return () => unregister(key);
  }, [key, id, dirty, register, unregister]);
}

export function useGuardedNavigation() {
  return useGuardContext().navigate;
}

type PendingNavigation = { action: () => void; labels: string[]; focus: HTMLElement | null };

export function DirtyGuardProvider({ children }: { children: React.ReactNode }) {
  const [registry] = useState(createDirtyRegistry);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const lastField = useRef<HTMLElement | null>(null);

  const register = useCallback((key: string, label: string, changed: boolean) => {
    registry.set(key, label, changed);
    setDirty(registry.labels().length > 0);
  }, [registry]);
  const unregister = useCallback((key: string) => {
    registry.remove(key);
    setDirty(registry.labels().length > 0);
  }, [registry]);

  const navigate = useCallback((action: () => void, sameTarget = false) => {
    const labels = registry.labels();
    const decision = decideDirtyNavigation(labels, pendingRef.current !== null, sameTarget);
    if (decision === "ignore") return;
    if (decision === "proceed") {
      action();
      return;
    }
    const focus = lastField.current?.isConnected
      ? lastField.current
      : document.querySelector<HTMLElement>('[role="tabpanel"]');
    const request = { action, labels, focus };
    pendingRef.current = request;
    setPending(request);
  }, [registry]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const resolve = (discard: boolean) => {
    const request = pendingRef.current;
    if (!request) return;
    pendingRef.current = null;
    setPending(null);
    if (discard) {
      registry.clear();
      setDirty(false);
      request.action();
    } else {
      // Let the dialog's focus-trap cleanup finish before returning to the field.
      requestAnimationFrame(() => {
        if (request.focus?.isConnected) request.focus.focus();
      });
    }
  };

  const context = useMemo(() => ({ register, unregister, navigate }), [register, unregister, navigate]);
  return (
    <DirtyContext.Provider value={context}>
      <div className="contents" onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable=true], [role="switch"]')) {
          lastField.current = event.target;
        }
      }}>
        {children}
        {pending && <DiscardDialog labels={pending.labels} onKeep={() => resolve(false)} onDiscard={() => resolve(true)} />}
      </div>
    </DirtyContext.Provider>
  );
}

function DiscardDialog({ labels, onKeep, onDiscard }: { labels: string[]; onKeep: () => void; onDiscard: () => void }) {
  const titleId = useId();
  const ref = useDialogFocus<HTMLDivElement>(onKeep);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onKeep} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-sm rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-sm font-semibold">{discardMessage(labels)}</h2>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" data-autofocus onClick={onKeep} className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-surface-hover)]">
            Keep editing
          </button>
          <button type="button" onClick={onDiscard} className="rounded-lg bg-[var(--color-danger)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90">
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
