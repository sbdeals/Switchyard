# Swarm and HTTPS verification

Tested 2026-10-25, approximately 05:48–06:01 UTC, from base
`6b6d5d6` (`codex/fixup-pinned-image`).

**Result:** HTTPS issuance and routing pass against Pebble using Dokploy's actual
generated application config. Swarm execution is blocked by this VM's kernel.
One Switchyard bug is fixed: Docker-image application auto-URLs used port 3000
regardless of the image's listening port.

## Scope and environment

The supplied premise that local Dokploy is a Swarm manager was false:

```text
sudo -n docker info --format 'Swarm={{.Swarm.LocalNodeState}} Manager={{.Swarm.ControlAvailable}}'
Swarm=inactive Manager=false

sudo -n docker network ls --format '{{.Name}} {{.Driver}} {{.Scope}}'
dokploy-network bridge local
```

Dokploy `:3000`, dashboard `:3001`, their ingress, and all pre-existing apps were
left unchanged. No existing credentials were used. All mutations below used a
new account and project in a disposable Dokploy instance, with its Docker socket
pointing exclusively at a disposable DinD daemon.

| Component | Fixture |
| --- | --- |
| Dokploy | `dokploy/dokploy:v0.30.10`, loopback `:3300` |
| Swarm manager | `docker:27.5.1-dind`, dedicated data volume/socket, overlay `dokploy-network` |
| Control-plane dependencies | Disposable `postgres:16` and `redis:7` |
| Application/database | `traefik/whoami:latest` and `postgres:18`, created by dashboard quick-deploy actions |
| TLS ingress | `traefik:v3.5.3`, isolated bridge, loopback HTTP `:38081` / HTTPS `:38444` |
| ACME/DNS | `ghcr.io/letsencrypt/pebble` + `pebble-challtestsrv`, isolated bridge |

The requested Docker Hub `letsencrypt/pebble` image was unavailable. The
[upstream compose fixture](https://github.com/letsencrypt/pebble/blob/main/docker-compose.yml)
uses GHCR. Images tested:

```text
pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199
pebble-challtestsrv@sha256:12ce21884def456bcf9786542113949e1f19dc7738d2c70e156c2d0c38a1405b
```

A temporary Vitest harness imported the real `src/app/actions.ts`,
`lib/dokploy.ts`, `lib/docker.ts`, API route handlers, and `DomainRow` component.
Only Next request-cookie/cache context and `server-only` were stubbed; API
requests and Docker calls were real. The cookie came from signing into the new
fixture account. This was an action/API/component-render test, not a browser
click-through or a test of the existing `:3001` build. Temporary harness files
were removed after testing.

## Swarm observations

DinD successfully became `Swarm=active Manager=true`, and automatic
`deployTarget()` detection returned `swarm` without forcing the target.
Both application and database services were created, but neither could start:

```text
network sandbox join failed: subnet sandbox join failed for "10.0.1.0/24":
error creating vxlan interface: operation not supported
```

A separate whoami service on the same overlay failed identically. DinD shares
the VM kernel; it cannot supply the missing VXLAN support.

| Operation | Evidence/result |
| --- | --- |
| Image deploy | `quickDeployImageAction` returned an application ID; Swarm service existed at `0/1`. Dokploy recorded deployment `done`, despite rejected tasks. |
| Database deploy | `quickDeployDatabaseAction("postgres")` created a database and `0/1` service, then returned `postgres.deploy timed out after 30000ms`. The record remains after the failure. |
| Variables | Application and Postgres save/read round trips passed. Application values included spaces, quotes, and embedded `=`. Values inside running containers remain unproven. |
| Generate URL | `generateDomainAction(..., 80)` with host-IP unset persisted `swarm-https-verify-5yzz.localhost`, HTTP/port 80. Its copied route returned 200 through fixture Traefik. |
| Stop | Both dashboard actions returned success. Desired replicas changed from 1 to 0 for both services. |
| Start | Both actions returned their 30-second timeout; desired replicas were 1, with no running tasks. |
| Redeploy | Application action succeeded and created a second `done` deployment. Database deploy timed out again. Neither acquired a running task. |
| Runtime status | `listRuntimeStates()` reported the VXLAN task error for both services. The runtime model can distinguish failed scheduling from Dokploy's `done` status. |
| Rollback | Both application deployments had `rollbackId: null`; `DeploymentHistory` only offers rollback for non-null snapshots. No usable rollback target existed. Successful rollback is unproven. |

Tabs and limits:

- **Networking / Variables:** real actions and persistence passed. Domain-row
  rendering used the returned HTTPS domain, with the correct `https://` href.
- **Logs:** the actual route returned HTTP 200/SSE with “container is not
  running”; recent application/database logs were empty. Runtime log streaming
  cannot be verified without a task.
- **Metrics / Console / Postgres Data:** helpers returned `null`, `null`, and
  an empty container list, respectively, consistent with missing tasks.
- **Deploys:** the VM's Node `20.19.2` lacks the global WebSocket used by the
  handler, which emitted its explicit Node 22+ requirement. Using the same
  authenticated WebSocket construction in the fixture's Node `24.22.1` opened
  the deployment-log connection and received 283 bytes. Full tab streaming
  under the intended dashboard runtime was not exercised.
- **Compose editor / local image-snapshot history:** compose-specific paths;
  application-kind services use the application Build/Deploy/Networking tabs
  and Dokploy rollback snapshots. No application tab was found accidentally
  routed through a bridge-only action.
- Build strategies, schedules, volume writes, backups, scaling, and multi-node
  behavior were not tested.

## HTTPS proof

The real dashboard action persisted:

```ts
createDomainAction(applicationId, {
  host: "swarm-https-verify.test", port: 80, path: "/",
  https: true, certificateType: "letsencrypt",
})
```

Dokploy generated these relevant fields in
`/etc/dokploy/traefik/dynamic/app-transmit-wireless-port-hvzacx.yml`:

```yaml
# Excerpts; router/service names are those generated by Dokploy.
http:
  routers:
    app-transmit-wireless-port-hvzacx-router-websecure-3:
      rule: Host(`swarm-https-verify.test`)
      service: app-transmit-wireless-port-hvzacx-service-3
      middlewares: []
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
  services:
    app-transmit-wireless-port-hvzacx-service-3:
      loadBalancer:
        servers:
          - url: http://app-transmit-wireless-port-hvzacx:80
        passHostHeader: true
```

The entire application YAML and generated `middlewares.yml` were copied,
unchanged, into the fixture Traefik file-provider directory. Since the Swarm
task cannot start, a disposable bridge whoami container used the exact backend
DNS alias `app-transmit-wireless-port-hvzacx`. This proves the generated config
and ACME integration, not the Swarm overlay data path.

Fixture static settings retained Dokploy's `web`/`websecure` entry points,
`letsencrypt` resolver name, HTTP challenge, and default websecure TLS resolver.
Only the fixture used these CA settings:

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: swarm-https@switchyard.test
      storage: /acme/acme.json
      caServer: https://pebble:14000/dir
      caServerName: localhost
      caCertificates: [/pebble.minica.pem]
      httpChallenge:
        entryPoint: web
```

These are documented [Traefik ACME settings](https://doc.traefik.io/traefik/v3.5/reference/install-configuration/tls/certificate-resolvers/acme/).
Pebble used `httpPort: 80`, `tlsPort: 443`, and
`-dnsserver challtestsrv:8053`. Challtestsrv returned the fixture Traefik IP for
A queries, with IPv6 disabled and its own challenge listeners disabled.
`PEBBLE_VA_NOSLEEP=1` removed validation delays; validation itself was enabled.
The CA URL never pointed to a public ACME service. No live Traefik settings or
ACME storage were read or modified.

At 05:54:55 UTC, Pebble logged three HTTP-01 validations for
`swarm-https-verify.test`, a valid authorization, and issuance. Verification:

```sh
curl --noproxy '*' --cacert pebble-root.pem \
  --resolve swarm-https-verify.test:38444:127.0.0.1 \
  -w 'HTTP %{http_code} TLS verify %{ssl_verify_result}\n' \
  https://swarm-https-verify.test:38444/
# HTTP 200 TLS verify 0; body contains the fixture whoami hostname.

openssl s_client -connect 127.0.0.1:38444 \
  -servername swarm-https-verify.test -CAfile pebble-root.pem \
  -verify_hostname swarm-https-verify.test -verify_return_error </dev/null
# Root, intermediate and leaf: verify return:1
```

No `-k` or skipped certificate checks were used. The leaf SAN was
`DNS:swarm-https-verify.test`, issuer `Pebble Intermediate CA 0d8561`, serial
`2F8B0FD41E504C05`. HTTP returned 301 to
`https://swarm-https-verify.test/`. Rendering the actual `DomainRow` returned
`href="https://swarm-https-verify.test"`.

## Focused fix and recommendations

Before the fix, `ensureAutoDomain()` generated
`http://app-transmit-wireless-port-hvzacx:3000` for whoami, which exposes port 80.
The unchanged config returned **502**, with TLS verification passing, against
the fixture backend. After deleting only that fixture auto-domain and invoking
the corrected helper, the new domain targeted **80** and returned **200** with
TLS verification passing. The final copied application YAML SHA-256 was
`7d9a76ec719e92fbec96e28a77bf055db0299ce88f0687ba3bf052880a94f680`.

The fix reuses the bridge image-port resolver for new Docker-source application
auto-URLs: valid `PORT`, exposed TCP port, known image default, then 3000.
Metadata inspection may pull a missing image, using the existing bounded
helper. Existing domains retain their selected ports; repository builds retain
their previous fallback. Existing broken auto-domains require editing their
port or regenerating them. Nine regression cases cover these behaviors; five
failed before the fix and all nine passed afterward.

Recommendations outside this change:

1. Repeat the full Swarm lifecycle, runtime logs, database readiness, and rollback
   tests on a disposable host with VXLAN support. A successful API response or
   deployment row is insufficient evidence of a running service.
2. Consider earlier actionable detection of overlay join failures and failed
   quick-deploy records. Do not silently classify this overlay host as healthy.
3. Test registry-backed rollback separately. The bridge local-snapshot mechanism
   does not provide application-kind rollback in this test.
4. Revisit generated-host/certificate assumptions: this Dokploy version returned
   `*.sslip.io` from `domain.generateDomain`, despite the helper's traefik.me
   naming. `certificateType: none` still inherited the static entry point's
   ACME resolver in this fixture. Public trust, real DNS/firewall reachability,
   renewal, and production Let's Encrypt issuance remain unproven.

## Checks and cleanup

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: lint, TypeScript, and **441 tests in 13 files**. Also:

- `cd dashboard && npx vitest run src/lib/swarm-domains.test.ts` before the fix:
  five failures reproducing the port bug, four passes.
- `cd dashboard && npx vitest run src/lib/swarm-domains.test.ts src/lib/bridge-domains.test.ts`
  after the fix: 51 passes.
- `git diff --check`: passed.

The temporary live harness's initial database-deploy assertion failed because
the real action timed out. Later observation stages passed while recording the
start/redeploy failures above; their passing status does not certify Swarm
runtime health. HTTPS curl/OpenSSL results are independent of mocked unit tests.

All session-owned resources are listed here; cleanup is verified separately
from unrelated resources created concurrently by other workers:

- Fixture Dokploy project `swarm-https-verify` (`8PIDrL_49PrbKiFxGznDa`), environment
  `vFtADsGeRqbO8HFL04RMU`, application `0z6LRZ9yseladxH3sEQFz`, database
  `wB4nI6lagvjZ3nj12E5Kr`, their domains/deployments, and the fixture account.
- Inner Swarm services: `app-transmit-wireless-port-hvzacx`,
  `postgres-back-up-open-source-sensor-x3kl8g`, and
  `swarm-https-verify-network-probe`. The inner daemon's overlay networks
  `dokploy-network` and `ingress`, default networks, image cache, and Swarm state
  are discarded with its data volume. No inner database volume was created.
- Outer containers: `swarm-https-verify-{dind,dokploy,postgres,redis,traefik,pebble,challtestsrv,whoami}`;
  transient source-reader container `swarm-https-verify-source` used `--rm`.
- Outer network: `swarm-https-verify`.
- Named volumes: `swarm-https-verify-dind-data`, `swarm-https-verify-postgres`,
  `swarm-https-verify-acme`; Redis anonymous volume
  `cbdef0ad98eba19a12896460dbb5483365df62e1693ab5125ca5d2bab2d31f03`.
- Temporary harness/config files and `.swarm-https-fixture/` (including copied
  routing config, test CA certificates, socket directory, and fixture data).

Cleanup completed. Application, database, and project removal actions all
returned success. Before destroying the fixture control plane, SQL counts for
projects/applications/Postgres services/domains were all zero; inner Docker had
no services, containers, or volumes. Explicitly named outer fixture containers,
network, and volumes were removed, including the Redis anonymous volume. The
three newly downloaded DinD/Pebble image tags and temporary files were removed.
No fixture resource remains.

The final baseline comparison retained 15 of 16 original container IDs, all 12
original networks, and 8 of 9 original volumes. Pre-existing `sy-s3`
(`741930b031a7`) and `sy-s3-data` disappeared during the run; no mutation in this
session targeted either resource. No attempt was made to recreate or modify
them. All session cleanup used explicit fixture names, with no global prune.
The original daemon still reported Swarm inactive; original Dokploy `:3000`
returned 200 and dashboard `:3001` returned its login redirect (307).
