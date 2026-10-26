# Domain status local proof

Final dashboard: http://127.0.0.1:3051 (sy-domain-status).

- `domains-ok-error.png`: configured DNS / HTTP 200 / OK alongside NXDOMAIN / Error.
- `domains-rechecked.png`: manual re-check after cache expiry.
- `domains-tls.png`: actual TLS issuer, expiry, days left, hostname mismatch and self-signed certificate.
- `domain-status.mp4`: 65-second recording of final successful run.
- `proof.txt`: assertions and API cleanup results.
- `proof.mjs`: reproducible browser/API proof using the provided demo login helper. No credentials stored here.

The VM's default DNS resolver synthesized 198.18.0.1 for both sslip.io and .invalid. The final proof therefore used a DNS service inside the newly created compose, answering only its two throwaway hostnames (VM IP and NXDOMAIN). It published no host port. Only the session-created dashboard's resolver was temporarily pointed at this fixture and then restored.

Verified live: HTTP OK, NXDOMAIN Error, real default TLS certificate details, 30-second cached result reuse, new result after expiry/manual re-check, no automatic domain requests for 32 seconds, arbitrary host override rejected with 400, unknown service rejected with 404. Warning rules, ownership failures, concurrency limit and network deadlines are covered by automated tests.

All throwaway Dokploy projects/compose stacks, their domains and DNS/whoami containers were deleted through dashboard server actions. Final Docker queries found no containers with the domain-status-dns or domain-status-web compose service labels. The review dashboard on :3051 remains running.

Checks passed:

```
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
# 5 test files, 136 tests passed
sudo docker build -q -t switchyard-dash:domain-status dashboard && /tmp/runsy.sh sy-domain-status 3051 domain-status
# final build sha256:9ed3793683458ffb93d57563eb09ea251561e4151b794de4d122928221e1dbba; login HTTP 200
BASE=http://127.0.0.1:3051 node /workspace/sy-codex-notes/fix/domain-status-proof/proof.mjs
# exit 0
git diff --check
# exit 0
```

Limits: only the first resolved IP is probed for HTTP/TLS; cache/concurrency are per server process. DNS comparison requires a known local SWITCHYARD_HOST_IP and is unavailable for remote servers. Public DNS propagation, public-CA issuance and the application UI path were not exercised live (the shared UI, application authorization and classifications have automated coverage).
# Domain status: round 1 SSRF fix proof

Local proof passed on `http://127.0.0.1:3051` on 2026-10-26. Only the new `domain-status-round1-1793009041579` project/compose and its three stored domains were checked. The local dashboard remained running on its assigned port.

- Fixture DNS `domain-status-round1-1793009041579.172.30.0.2.sslip.io` → `172.30.0.2`: DNS configured, HTTP 200, **OK**. This private VM address was permitted only because it exactly matched `SWITCHYARD_HOST_IP`.
- Fixture DNS `domain-status-round1-1793009041579-nx.invalid` → NXDOMAIN: **Error**, `dns-not-found`.
- Fixture DNS `domain-status-round1-1793009041579-internal.invalid` → `127.0.0.1`, with HTTPS enabled: DNS row retained, **Warning**, HTTP and TLS marked not checked. Exact warning: “Resolves to an internal address (127.0.0.1); reachability not checked.” API returned `reachability.blockedAddress: "127.0.0.1"`, no HTTP status/error and no TLS certificate.
- TCP sentinels listening on loopback ports 80 and 443 **inside this proof's dashboard container**, with no published ports, observed **0 HTTP connections and 0 TLS connections** throughout initial and expired-cache internal checks.
- The 30-second cache reused the original timestamp. No polling occurred over 32 seconds. Manual re-check refreshed both allowed and refused domain timestamps. Arbitrary-host query returned 400; unknown service returned 404.
- Enabling HTTPS on the allowed throwaway domain still showed HTTP 200, issuer `TRAEFIK DEFAULT CERT`, valid-to date, days left, self-signed status and hostname mismatch.

The address policy conservatively refuses nonpublic/special-use IPs, including IPv4-mapped internal IPv6 addresses and mixed public/internal DNS answers, before opening any HTTP/TLS socket. Only a valid address exactly equal to configured `SWITCHYARD_HOST_IP` bypasses the filter. Connections remain pinned to the vetted IP. IPv6 transition/special-use ranges are also refused; this may exclude some otherwise reachable destinations. The proof uses an isolated DNS fixture because this VM's resolver synthesized answers in the original proof; public DNS propagation and public-CA certificate issuance remain unproven.

Cleanup passed: compose and project were removed through dashboard actions/API, the project disappeared from the workspace, and no containers with this run's unique name remained. Both loopback sentinels acknowledged shutdown and their files were removed. The dashboard resolver was restored and verified as `nameserver 127.0.0.11`. No pre-existing apps were stopped or deleted.

Checks run by the implementation agent:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint, TypeScript and **510 Vitest tests**.

```sh
sudo docker build -q -t switchyard-dash:domain-status dashboard && /tmp/runsy.sh sy-domain-status 3051 domain-status
```

Passed. Image: `sha256:69a040ee363e41494414e0362e91c15c70f06c2a739a09ce12ae0c51323b76b8`.

```sh
BASE=http://127.0.0.1:3051 node /workspace/sy-codex-notes/fix/domain-status-proof/round1-proof.mjs
```

Passed, exit 0. Recording verified with `ffprobe`: H.264, 1440×900, 60.12 seconds.

Artifacts:

- [OK / NXDOMAIN / internal warning](round1-internal-warning.png)
- [Internal domain card](round1-internal-card.png)
- [Initial OK / Error](round1-domains-ok-error.png)
- [Manual re-check](round1-domains-rechecked.png)
- [TLS certificate details](round1-domains-tls.png)
- [MP4 recording](round1-domain-status.mp4)
- [Exact API results](round1-results.json)
- [Proof and cleanup log](round1-proof.txt)
- [Reproducible proof script](round1-proof.mjs)
