"use client";

import { useEffect, useId, useState } from "react";
import { domainHttpsDefaults } from "@/lib/domain-https";
import { domainHttpsConfiguredAction } from "@/app/actions";

/** Recompute the default for each host without overwriting an explicit choice. */
export function useDomainHttps(host: string) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [choice, setChoice] = useState<{ host: string; https: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    domainHttpsConfiguredAction().then(
      (value) => { if (active) setConfigured(value); },
      () => { if (active) setConfigured(null); },
    );
    return () => { active = false; };
  }, []);
  const defaults = domainHttpsDefaults(host, configured);
  return {
    https: choice?.host === host ? choice.https : defaults.https,
    hint: defaults.hint,
    onChange: (https: boolean) => setChoice({ host, https }),
  };
}

export function DomainHttpsToggle({ https, hint, onChange }: ReturnType<typeof useDomainHttps>) {
  const hintId = useId();
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
        <input type="checkbox" checked={https} onChange={(e) => onChange(e.target.checked)} aria-describedby={hintId} />
        HTTPS
      </label>
      <p id={hintId} className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</p>
    </div>
  );
}
