#!/usr/bin/env node
// End-to-end proof that custom domains route through Dokploy's bundled Traefik
// on 80/443. Drives a running Dokploy's REST API (the same endpoints the
// Switchyard dashboard uses) to: register the first admin, create a project,
// deploy the `traefik/whoami` image as an application, attach a custom domain,
// and finally curl that domain through Traefik on :80 — asserting whoami answers.
//
// The domain uses sslip.io (`<label>.127.0.0.1.sslip.io` resolves to 127.0.0.1),
// so no DNS or hosts-file setup is needed: Traefik on :80 routes by Host header.
//
// Usage: node scripts/e2e-domain-check.mjs
// Env: DOKPLOY_URL (default http://localhost:3000)

import http from "node:http";

const BASE = process.env.DOKPLOY_URL ?? "http://localhost:3000";
// Fresh CI install: these register the first admin. Against an existing install
// (local), pass the real DOKPLOY_EMAIL/DOKPLOY_PASSWORD and we sign in instead.
const EMAIL = process.env.DOKPLOY_EMAIL ?? "e2e@switchyard.test";
const PASSWORD = process.env.DOKPLOY_PASSWORD ?? "E2e-Switchyard-2026!";
const HOST = process.env.E2E_HOST ?? "whoami.127.0.0.1.sslip.io";
const IMAGE = "traefik/whoami:latest";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);

/**
 * GET http://127.0.0.1:80/ with an explicit Host header, via node:http.
 *
 * NOTE: fetch()/undici CANNOT be used here. `Host` is a forbidden request
 * header in the Fetch spec, so undici silently drops an override and sends
 * `Host: 127.0.0.1` — which matches no Traefik router and always 404s. The
 * node:http client honors the Host header, so it actually exercises host-based
 * routing without needing DNS for the sslip.io name.
 */
function routeGet(host) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: 80, path: "/", method: "GET", headers: { Host: host } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: e instanceof Error ? e.message : String(e) }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ status: 0, body: "request timed out" });
    });
    req.end();
  });
}

let cookie = "";

async function api(path, body) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text.slice(0, 300)}`);
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(/,(?=[^;]+=[^;]+)/).map((c) => c.split(";")[0].trim()).join("; ");
  return text ? JSON.parse(text) : null;
}

async function waitForDokploy() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE, { redirect: "manual" });
      if (r.status >= 200 && r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(3000);
  }
  throw new Error(`Dokploy never became reachable at ${BASE}`);
}

async function main() {
  log(`waiting for Dokploy at ${BASE} ...`);
  await waitForDokploy();

  log("authenticating ...");
  // Fresh install: the first sign-up becomes the admin. Existing install: it's
  // closed, so fall back to signing in with the supplied creds.
  try {
    await api("auth/sign-up/email", { name: "E2E", email: EMAIL, password: PASSWORD });
  } catch {
    log("sign-up rejected (admin exists) — signing in instead");
  }
  if (!cookie) await api("auth/sign-in/email", { email: EMAIL, password: PASSWORD });

  log("ensuring a project exists ...");
  let tree = await api("project.all");
  let env = tree?.flatMap?.((p) => p.environments ?? [])?.[0];
  if (!env?.environmentId) {
    await api("project.create", { name: "e2e" });
    tree = await api("project.all");
    env = tree?.flatMap?.((p) => p.environments ?? [])?.[0];
  }
  if (!env?.environmentId) throw new Error("no environment found");

  // Idempotency: remove any prior "whoami" apps so re-runs don't stack a second
  // app + a duplicate Host route (which collides into a 404). Best-effort.
  const priorApps = tree.flatMap((p) => p.environments ?? []).flatMap((e) => e.applications ?? []);
  for (const a of priorApps) {
    const id = a.applicationId;
    try {
      const one = await api(`application.one?applicationId=${encodeURIComponent(id)}`);
      if (one?.name === "whoami") {
        log(`removing a prior whoami app (${id}) ...`);
        await api("application.remove", { applicationId: id });
      }
    } catch {
      /* ignore — best-effort cleanup */
    }
  }

  log(`deploying ${IMAGE} as an application ...`);
  const app = await api("application.create", { name: "whoami", environmentId: env.environmentId });
  const applicationId = app.applicationId;
  await api("application.saveDockerProvider", {
    applicationId,
    dockerImage: IMAGE,
    username: null,
    password: null,
    registryUrl: null,
  });

  log(`attaching custom domain ${HOST} (port 80, http, cert none) ...`);
  await api("domain.create", {
    applicationId,
    host: HOST,
    port: 80,
    https: false,
    certificateType: "none",
    path: "/",
  });

  log("triggering deploy ...");
  await api("application.deploy", { applicationId });

  // Poll the app until Dokploy reports it running/done (image pull + start).
  log("waiting for the app to reach running ...");
  let status = "";
  for (let i = 0; i < 80; i++) {
    const one = await api(`application.one?applicationId=${encodeURIComponent(applicationId)}`);
    status = one?.applicationStatus ?? "";
    if (status === "done" || status === "running") break;
    if (status === "error") throw new Error("Dokploy reported application status=error");
    await sleep(5000);
  }
  log(`app status: ${status || "unknown"}`);

  // Now the real assertion: hit Traefik on 127.0.0.1:80 with the custom domain
  // as the Host header. Routing is by Host header, so this needs no DNS — more
  // robust than resolving a wildcard-DNS hostname (which some networks block).
  // Poll the route until it answers. The window is generous because the app's
  // container must pull + start + converge (Swarm) and Traefik must reload its
  // file config before the Host route resolves — a 404 here just means "not
  // ready yet". ~6 min covers a cold image pull on a CI runner.
  log(`routing http://127.0.0.1:80/ with Host: ${HOST} through Traefik ...`);
  let lastErr = "";
  const attempts = 90;
  for (let i = 0; i < attempts; i++) {
    const r = await routeGet(HOST);
    // whoami echoes request info including a "Hostname:" line.
    if (r.status === 200 && /Hostname:/i.test(r.body)) {
      log("SUCCESS — custom domain routed to whoami through Traefik:");
      console.log(r.body.split("\n").slice(0, 6).join("\n"));
      return;
    }
    lastErr = `status ${r.status}, body ${JSON.stringify(r.body.slice(0, 120))}`;
    if (i % 10 === 9) log(`  still waiting for the route (${i + 1}/${attempts}) — last: ${lastErr}`);
    await sleep(4000);
  }
  throw new Error(`custom domain did not route in time. Last attempt: ${lastErr}`);
}

main().catch((e) => {
  console.error(`[e2e] FAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
