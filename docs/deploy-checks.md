# Healthchecks and pre-deploy commands

Service Settings exposes an HTTP healthcheck path, timeout, and pre-deploy
command. Saving these settings configures the next deployment; it does not run
the check or command. The healthcheck sends a GET to the selected container's
local HTTP port and accepts only a 2xx response. The image must contain `curl`
and `/bin/sh`. Each individual HTTP request has a fixed one-second timeout.
Curl configuration files, proxies, and URL globbing are disabled for this probe.

Paths must start with `/` (not `//`), contain only printable ASCII without
spaces, fragments, or backslashes, and be at most 2,048 characters. Query
strings are allowed. The timeout must be an integer from 5 to 600 seconds;
the container port must be an integer from 1 to 65,535. Commands are trimmed,
limited to 4,096 characters, and cannot contain a NUL character. Empty path
and command fields disable their respective checks.

## Dokploy v0.30.10 mapping

This mapping was checked against the upstream **v0.30.10** tag, rather than
assuming similarly named fields are deployment hooks.

| Service | Healthcheck | Pre-deploy command |
| --- | --- | --- |
| Native application on a locally observable Swarm manager | Dokploy `application.update.healthCheckSwarm`, applied to the next Swarm service deployment | Not supported by Dokploy v0.30.10 |
| Native application on a non-manager host, or an unobservable remote host | Not supported on this host | Not supported |
| Supported raw Docker Compose service | Container `healthcheck`, plus a deployment command that waits for health | A separate one-shot service required to complete successfully before the application starts |
| Git-sourced Compose, Docker Stack, or an existing custom Compose command | Not managed by these settings | Not managed by these settings |

Native application `healthCheckSwarm` is copied into Docker's
`TaskTemplate.ContainerSpec.HealthCheck`. Its duration fields use nanoseconds.
Switchyard sets a one-second interval and request timeout, with the configured
timeout used as the number of consecutive failures before Docker reports
unhealthy. This is a retry budget, not a deployment deadline: requests that each
take a full second can make it approximately twice the configured duration.
Dokploy does not wait for this healthcheck before marking deployment complete.
Application `command` becomes `ContainerSpec.Command`; it changes the running
container's command and is **not** a migration or pre-deploy hook. Neither the
application nor Compose schema provides a `preDeploy` field. See the tagged
[application schema](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/db/schema/application.ts),
[Compose schema](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/db/schema/compose.ts),
[healthcheck mapping](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/docker/utils.ts#L626-L649),
and [application service creation](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/builders/index.ts#L81-L197).

This base does not provide an application-to-Compose bridge. Switchyard does not
silently convert applications or enable Swarm to make these fields work.

## Compose behavior

The managed mapping requires a local `docker-compose` deployment with raw YAML
containing exactly one application service with an `image` or `build`. Existing
custom healthchecks, dependencies, deployment commands, `profiles`, `extends`,
`network_mode`, and top-level `include` are refused. After configuration, Switchyard also recognizes
its own generated `sy-predeploy` service.

The `x-switchyard-deploy-checks` extension stores versioned settings and the
original deployment command. Clearing both fields removes the generated check,
dependency, helper service, and metadata, and restores the original command.
Changes made outside Settings to generated configuration must be restored
before these fields can be edited again. Saving serializes the YAML, so comments
and original formatting are not preserved.

The HTTP check runs inside the application container. Docker retries it at
one-second intervals, and the generated deployment command adds a readiness
wait bounded by the configured timeout. A redirect is not a passing healthcheck.

A pre-deploy command runs through `/bin/sh -c` in a separate container using the
application's image reference or build configuration and inherited environment,
mounts, networks, user, and working directory. It replaces the image's
entrypoint. With a build configuration and no explicit image, Compose builds a
separate image for each service; identical image digests are not guaranteed.
Its shell must exit successfully before the application service can start.
The generated dependency uses
`condition: service_completed_successfully`, and the one-shot service has no
restart policy that would retry a failed migration. Commands should be safe to
run again on every deployment. **The timeout does not kill a pre-deploy
command.** Compose v5.6.1 applies the configured timeout to the dependency wait
as well as the later readiness wait. If the dependency wait expires, deployment
fails but the migration container can keep running. Image builds are not
bounded by this timeout, and it is not one total deadline for the entire deploy.
See Compose's [dependency timeout handling](https://github.com/docker/compose/blob/v5.6.1/pkg/compose/service_containers.go#L162-L196).

Dokploy's `compose.command` is a Docker CLI suffix, so it starts with `compose`,
not `docker compose`. Switchyard generates the equivalent of:

```sh
compose -p APP_NAME -f docker-compose.yml up -d --build --remove-orphans --force-recreate --wait --wait-timeout SECONDS
```

`--force-recreate` recreates the one-shot container on each deploy. `--wait`
waits for the application's configured healthcheck, while accepting a successful
exit from the required one-shot dependency. A failed command, unhealthy
container, or expired readiness timeout returns a failing exit status. Dokploy
then records deployment and service status as `error` rather than `done`.
These behaviors follow the tagged
[Compose command builder](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/utils/builders/compose.ts#L20-L153)
and [deployment result handling](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/compose.ts#L301-L342),
Docker's [`up --wait` documentation](https://docs.docker.com/reference/cli/docker/compose/up/),
and the [`service_completed_successfully` specification](https://docs.docker.com/reference/compose-file/services/#depends_on).
The local Dokploy CLI used for verification reports Docker Compose v5.6.1.

## What the state proves

Deploys shows live check state only when the local Docker engine exposes evidence
for the relevant container. A configured check, a saved command, or a Dokploy
deployment marked `done` is not itself evidence that a healthcheck passed.
An absent check or unavailable container observation must remain unverified.
Observations require containers created after the latest recorded deployment,
with a matching generated healthcheck or pre-deploy command. Current container
health and a one-shot container's exit status do not establish step outcomes for
historical deploys. Changing settings without deploying does not turn old
container observations into proof that the new settings ran.

This distinction also matters on Swarm: Dokploy v0.30.10 marks an application
deployment `done` after creating or updating its service, without waiting for
health convergence. See
[application deployment completion](https://github.com/Dokploy/dokploy/blob/v0.30.10/packages/server/src/services/application.ts#L225-L236).

## Limits

- Compose waits before reporting deployment success, but does not provide an
  atomic traffic switch or automatic rollback. It can stop and replace the old
  application container before the new container passes its check.
- A failed pre-deploy command prevents the new application from starting. It
  does not guarantee that the previous application is still running, and it
  cannot undo database changes already made by the command.
- A failed healthcheck can leave the new container running and unhealthy.
  Readiness failure is not an instruction to remove containers or volumes.
- The request checks the container's local HTTP endpoint, not public DNS, TLS,
  or proxy routing. No credential-bearing external probe is used.
- Only the selected service is managed. Existing unsupported Compose layouts,
  commands, or healthchecks require explicit manual configuration.
- The local non-Swarm test host cannot prove native application healthcheck
  execution. Native application pre-deploy commands remain unsupported.
