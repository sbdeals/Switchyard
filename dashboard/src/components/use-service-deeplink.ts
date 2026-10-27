"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Service } from "@/lib/dokploy";
import { parseDeeplink, serializeDeeplink, type TabId } from "@/lib/deeplink";
import { decideDeeplinkNavigation } from "@/lib/dirty-guard";
import { useGuardedNavigation } from "@/components/DirtyGuard";

export function useServiceDeeplink(services: Service[]) {
  const query = useSearchParams().toString();
  const router = useRouter();
  const { navigate: guard, getState, activateScope, session } = useGuardedNavigation();
  const [refreshing, startRefresh] = useTransition();
  const [deployedId, setDeployedId] = useState<string | null>(null);
  const { serviceId, tab, invalidService, invalidTab } = parseDeeplink(query, services);
  const scope = serviceId ? JSON.stringify([serviceId, tab, session]) : null;
  const currentUrl = useRef<string | null>(null);
  const currentState = useRef<unknown>(null);
  const latestServices = useRef(services);
  const missing = invalidService ? query : null;
  const [lastMissing, setLastMissing] = useState(missing);
  const [notice, setNotice] = useState(missing);

  // Keep the message visible briefly after the invalid URL has been repaired.
  if (missing !== lastMissing) {
    setLastMissing(missing);
    if (missing !== null) setNotice(missing);
  }

  useLayoutEffect(() => {
    latestServices.current = services;
    currentUrl.current = window.location.href;
    currentState.current = window.history.state;
    activateScope(scope);
  }, [services, query, scope, activateScope]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const navigateUrl = useCallback((url: URL, replace = false, pop?: PopStateEvent) => {
    const previous = currentUrl.current ?? window.location.href;
    const targetState = window.history.state;
    const { labels, pending } = getState(scope);
    const result = decideDeeplinkNavigation(
      new URL(previous).search, url.search, latestServices.current, labels, pending, !!pop,
    );
    const apply = () => {
      // Revalidate after confirmation: refresh may have removed the target.
      const current = parseDeeplink(new URL(previous).search, latestServices.current);
      const target = parseDeeplink(url.search, latestServices.current);
      const repair = target.invalidService || target.invalidTab;
      if (repair) {
        if (target.invalidService) setNotice(url.search);
        url.search = serializeDeeplink(url.search, target.serviceId);
      }
      // Repairing an invalid tab to the panel already shown must preserve its
      // dirty registrations (and any pending navigation away from that panel).
      if (current.serviceId !== target.serviceId || current.tab !== target.tab) activateScope(null);
      currentUrl.current = url.href;
      window.history[replace || pop || repair ? "replaceState" : "pushState"](
        pop ? targetState : null, "", url.pathname + url.search + url.hash,
      );
      currentState.current = window.history.state;
      // Restore Next's popped route tree as well as its URL. Our listener sees
      // the accepted target as current on replay, so it cannot prompt again.
      if (pop) window.dispatchEvent(new PopStateEvent("popstate", { state: targetState }));
    };
    if (result.decision === "repair") {
      pop?.stopImmediatePropagation();
      apply();
      return;
    }
    if (result.restore) {
      // Capture before Next handles popstate. pushState restores the open panel
      // without another popstate; repeated Back/Keep replaces the forward entry,
      // so history does not grow. This also covers invalid targets: only Discard
      // applies their repaired destination; a pending prompt keeps its target.
      pop?.stopImmediatePropagation();
      const restore = new URL(previous);
      window.history.pushState(currentState.current, "", restore.pathname + restore.search + restore.hash);
    }
    if (result.decision === "confirm") guard(apply);
    else if (result.decision === "proceed") {
      if (pop) {
        activateScope(null);
        currentUrl.current = url.href;
        currentState.current = targetState;
      } else apply();
    } else if (pop && !result.restore) {
      currentUrl.current = url.href;
      currentState.current = targetState;
    }
  }, [getState, scope, activateScope, guard]);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => navigateUrl(new URL(window.location.href), true, event);
    window.addEventListener("popstate", onPop, true);
    return () => window.removeEventListener("popstate", onPop, true);
  }, [navigateUrl]);

  useEffect(() => {
    if (!invalidService && !invalidTab) return;
    const url = new URL(window.location.href);
    if (url.searchParams.toString() !== query) return;
    navigateUrl(url, true);
  }, [query, invalidService, invalidTab, navigateUrl]);

  const navigate = useCallback((id: string | null, nextTab?: TabId, replace = false) => {
    const url = new URL(window.location.href);
    url.search = serializeDeeplink(url.searchParams, id, nextTab);
    navigateUrl(url, replace);
  }, [navigateUrl]);

  useEffect(() => {
    if (refreshing || deployedId === null) return;
    // Consume this request once when the external router refresh completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeployedId(null);
    // A creation result is not authority to display a service: wait for it to
    // arrive in the signed-in workspace before asking to abandon the old form.
    if (services.some((service) => service.id === deployedId)) navigate(deployedId, "overview");
    else setNotice(deployedId);
  }, [refreshing, deployedId, services, navigate]);

  return {
    service: services.find((service) => service.id === serviceId) ?? null,
    tab,
    scope,
    notFound: notice !== null,
    open: (id: string) => navigate(id, "overview"),
    close: () => navigate(null),
    selectTab: (nextTab: TabId) => navigate(serviceId, nextTab, true),
    onDeployed: (id: string) => {
      startRefresh(() => {
        setDeployedId(id);
        router.refresh();
      });
    },
  };
}
