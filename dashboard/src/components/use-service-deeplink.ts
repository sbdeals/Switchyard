"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Service } from "@/lib/dokploy";
import { parseDeeplink, serializeDeeplink, type TabId } from "@/lib/deeplink";

export function useServiceDeeplink(services: Service[]) {
  const query = useSearchParams().toString();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const { serviceId, tab, invalidService, invalidTab } = parseDeeplink(query, services);
  const missing = invalidService && !refreshing ? query : null;
  const [lastMissing, setLastMissing] = useState(missing);
  const [notice, setNotice] = useState(missing);

  // Keep the message visible briefly after the invalid URL has been repaired.
  if (missing !== lastMissing) {
    setLastMissing(missing);
    if (missing !== null) setNotice(missing);
  }

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    // A newly created service may not be in props until router.refresh finishes.
    if (refreshing || (!invalidService && !invalidTab)) return;
    const url = new URL(window.location.href);
    if (url.searchParams.toString() !== query) return;
    url.search = serializeDeeplink(query, serviceId);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [query, serviceId, invalidService, invalidTab, refreshing]);

  function navigate(id: string | null, nextTab?: TabId, replace = false) {
    const url = new URL(window.location.href);
    const before = url.href;
    url.search = serializeDeeplink(url.searchParams, id, nextTab);
    if (url.href === before) return;
    // Next integrates native history with useSearchParams without a server fetch.
    window.history[replace ? "replaceState" : "pushState"](
      null, "", url.pathname + url.search + url.hash,
    );
  }

  return {
    service: services.find((service) => service.id === serviceId) ?? null,
    tab,
    notFound: notice !== null,
    open: (id: string) => navigate(id, "overview"),
    close: () => navigate(null),
    selectTab: (nextTab: TabId) => navigate(serviceId, nextTab, true),
    onDeployed: (id: string) => {
      startRefresh(() => {
        navigate(id, "overview");
        router.refresh();
      });
    },
  };
}
