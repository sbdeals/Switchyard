"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectNode, Service, ServiceEdge } from "@/lib/dokploy";
import { pollingInterval } from "@/lib/deploy-polling";

interface WorkspaceData {
  services: Service[];
  projects: ProjectNode[];
  edges: ServiceEdge[];
}

/** Keep the last successful snapshot mounted, including unsaved drawer state. */
export function useWorkspacePolling(initial: WorkspaceData, projectId: string | null): WorkspaceData {
  const [source, setSource] = useState(initial);
  const [snapshot, setSnapshot] = useState(initial);
  const reschedule = useRef<(() => void) | null>(null);
  const router = useRouter();

  // Manual refreshes and server actions still supply fresh route props.
  if (initial.services !== source.services || initial.projects !== source.projects || initial.edges !== source.edges) {
    setSource(initial);
    setSnapshot(initial);
  }

  const interval = useEffectEvent((failures: number) => pollingInterval({
    hidden: document.visibilityState === "hidden",
    services: snapshot.services,
    projectId: snapshot.projects.some((project) => project.projectId === projectId) ? projectId : null,
    failures,
  }));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let pending = false;
    let disposed = false;
    const controller = new AbortController();

    function schedule() {
      clearTimeout(timer);
      if (disposed || pending) return;
      const delay = interval(failures);
      if (delay !== null) timer = setTimeout(refresh, delay);
    }

    async function refresh() {
      clearTimeout(timer);
      if (disposed || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/workspace", { cache: "no-store", signal: controller.signal });
        if (response.redirected && new URL(response.url).pathname === "/login") {
          router.replace("/login");
          return;
        }
        if (!response.ok) throw new Error("Workspace refresh failed");
        const next = await response.json() as WorkspaceData;
        if (!disposed) {
          failures = 0;
          setSnapshot(next);
        }
      } catch {
        if (!disposed) failures = Math.min(failures + 1, 4);
      } finally {
        pending = false;
        schedule();
      }
    }

    function visibilityChanged() {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") void refresh();
    }

    reschedule.current = schedule;
    document.addEventListener("visibilitychange", visibilityChanged);
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      reschedule.current = null;
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [initial.services, initial.projects, initial.edges, router]);

  // A project switch or deployment transition can change the polling cadence.
  useEffect(() => { reschedule.current?.(); }, [snapshot.services, projectId]);

  return snapshot;
}
