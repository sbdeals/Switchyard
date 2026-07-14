"use client";

/**
 * Best-effort logos for service cards/nodes, Railway-style: match a service to
 * its app's logo in Dokploy's template catalog (postgres elephant, Supabase
 * bolt, n8n knot, ...). Matching is by catalog id against a few candidate
 * slugs derived from the service (name, name minus random suffix, docker image
 * basename, database engine aliases). Misses simply keep the generic icon —
 * a wrong logo is worse than no logo, so only exact id hits count.
 */

import { useEffect, useState } from "react";
import type { Service } from "@/lib/dokploy";
import { listTemplatesAction } from "@/app/actions";

// The catalog has no plain database templates (Dokploy deploys engines
// natively), so databases get official brand marks from devicon (MIT,
// jsDelivr-hosted): the postgres elephant, mysql dolphin, and friends.
const DEVICON = "https://cdn.jsdelivr.net/gh/devicons/devicon/icons";
const ENGINE_LOGOS: Record<string, string> = {
  postgres: `${DEVICON}/postgresql/postgresql-original.svg`,
  mysql: `${DEVICON}/mysql/mysql-original.svg`,
  mariadb: `${DEVICON}/mariadb/mariadb-original.svg`,
  mongo: `${DEVICON}/mongodb/mongodb-original.svg`,
  redis: `${DEVICON}/redis/redis-original.svg`,
};

/** Candidate catalog ids for a service, most specific first. */
function candidates(service: Service): string[] {
  const out: string[] = [];
  const name = service.name.toLowerCase().trim();
  out.push(name);
  // Quick-deploy names carry a random suffix ("postgres-fab6") — strip it.
  const stripped = name.replace(/-[a-z0-9]{3,6}$/, "");
  if (stripped && stripped !== name) out.push(stripped);
  if (service.dockerImage) {
    // "postgres:18" -> postgres; "traefik/whoami:latest" -> whoami.
    const base = service.dockerImage.split(":")[0].split("/").pop()?.toLowerCase();
    if (base) out.push(base);
  }
  return out;
}

export function resolveServiceLogo(
  service: Service,
  logoById: ReadonlyMap<string, string> | null
): string | null {
  if (service.kind === "database") return ENGINE_LOGOS[service.engine] ?? null;
  if (!logoById || logoById.size === 0) return null;
  for (const key of candidates(service)) {
    const hit = logoById.get(key);
    if (hit) return hit;
  }
  return null;
}

// The catalog barely changes within a session — fetch once per page load and
// share the map across canvas + grid renders.
let cachedLogos: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

async function fetchLogos(): Promise<Map<string, string>> {
  const res = await listTemplatesAction();
  const map = new Map<string, string>();
  if (res.ok) {
    for (const t of res.templates) if (t.logo) map.set(t.id.toLowerCase(), t.logo);
  }
  return map;
}

/** Template-id -> logo-URL map, loaded once per page. Null while loading. */
export function useTemplateLogos(): Map<string, string> | null {
  const [logos, setLogos] = useState<Map<string, string> | null>(cachedLogos);
  useEffect(() => {
    if (cachedLogos) return;
    inflight ??= fetchLogos().then((m) => (cachedLogos = m));
    let alive = true;
    inflight.then((m) => {
      if (alive) setLogos(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return logos;
}
