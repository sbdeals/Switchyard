# Switchyard CLI

Install and manage a local Dokploy + Switchyard platform with `switchyard up`,
then deploy a directory with `switchyard deploy`.

Read runtime logs through the dashboard API:

```sh
switchyard logs [name|id] [--service <name|id>] [--project <name|id>] [--lines N] [--follow] [--json] [--since 15m|1h|6h]
```

Selection follows deploy: current directory name, the only project, and its
production (or only) environment. `--lines` defaults to 200 and accepts 1–1000.
`--json` emits NDJSON; `--follow` polls with backoff, de-duplicates output and
exits with code 0 on Ctrl+C. The CLI uses its saved local login and never opens
the Docker socket to fetch service logs.

For stack diagnostics, `switchyard logs switchyard` and `switchyard logs dokploy`
read the last 200 lines using `docker logs` and `docker service logs`, respectively.
Add `-f` or `--follow` to stream them; dashboard authentication is not required.
The other flags above apply to service logs. Positional `switchyard` and `dokploy`
are reserved for infrastructure: select services with those names using
`--service switchyard` or `--service dokploy`. Other positional names or IDs select
service logs. A positional target and `--service` cannot be combined.

See the [CLI reference](../docs/cli.md) for all commands, limits and examples.
