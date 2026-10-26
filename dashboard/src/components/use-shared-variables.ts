"use client";

import { useEffect, useState } from "react";
import { getSharedVariablesAction, getSharedVariableKeysAction } from "@/app/shared-variable-actions";
import type { SharedVariables, SharedVariableKeys } from "@/lib/shared-variables";

export function useSharedVariables(projectId: string, environmentId?: string, refreshKey?: unknown) {
  const [result, setResult] = useState<{
    projectId: string;
    environmentId?: string;
    variables?: SharedVariables;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    getSharedVariablesAction(projectId, environmentId).then((res) => {
      if (active) setResult({ projectId, environmentId, ...(res.ok ? { variables: res.variables } : { error: res.error }) });
    }).catch(() => {
      if (active) setResult({ projectId, environmentId, error: "Could not load shared variables. Reopen this panel to retry." });
    });
    return () => { active = false; };
  }, [projectId, environmentId, refreshKey]);

  // Never show values from the previous project/environment while loading.
  return result?.projectId === projectId && result.environmentId === environmentId ? result : null;
}

/** The service editor only needs names; shared values stay in their own panel. */
export function useSharedVariableKeys(projectId: string, environmentId?: string, refreshKey?: unknown) {
  const [result, setResult] = useState<{
    projectId: string;
    environmentId?: string;
    keys?: SharedVariableKeys;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    getSharedVariableKeysAction(projectId, environmentId).then((res) => {
      if (active) setResult({ projectId, environmentId, ...(res.ok ? { keys: res.keys } : { error: res.error }) });
    }).catch(() => {
      if (active) setResult({ projectId, environmentId, error: "Could not load shared variables. Reopen this panel to retry." });
    });
    return () => { active = false; };
  }, [projectId, environmentId, refreshKey]);

  return result?.projectId === projectId && result.environmentId === environmentId ? result : null;
}
