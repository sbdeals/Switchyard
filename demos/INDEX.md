# Demo index

All demos were recorded against a live bridge-mode Dokploy + Switchyard dashboard stack on the Codex VM (Oct 23 2026, ET). Published on branch `codex/demo-artifacts`.

| PR | Branch | What changed | Demo | Type |
|---|---|---|---|---|
| [#34](https://github.com/sbdeals/Switchyard/pull/34) | codex/preserve-build-settings | Env save no longer wipes build args/secrets/env-file | [34-preserve-build-settings](34-preserve-build-settings/) | Playwright mp4 + screenshots + Dokploy state |
| [#35](https://github.com/sbdeals/Switchyard/pull/35) | codex/mcp-unambiguous-targets | MCP errors on ambiguous names instead of hitting prod | [35-mcp-unambiguous-targets](35-mcp-unambiguous-targets/) | asciinema + transcript |
| [#36](https://github.com/sbdeals/Switchyard/pull/36) | codex/docker-target-identity | Logs/Console/Data attach only to the app's own container | [36-docker-target-identity](36-docker-target-identity/) | Playwright mp4 + screenshots |
| [#37](https://github.com/sbdeals/Switchyard/pull/37) | codex/accurate-reset-docs | Docs stop promising factory-reset survival | [37-accurate-reset-docs](37-accurate-reset-docs/) | text diff + link check |
| [#38](https://github.com/sbdeals/Switchyard/pull/38) | codex/encode-database-uris | Connection strings URI-encode credentials | [38-encode-database-uris](38-encode-database-uris/) | asciinema vs live postgres:16 |
| [#39](https://github.com/sbdeals/Switchyard/pull/39) | codex/login-session-recovery | Expired Dokploy session → clean re-login instead of redirect loop | [39-login-session-recovery](39-login-session-recovery/) | Playwright mp4 + screenshots + nav chain |
| [#40](https://github.com/sbdeals/Switchyard/pull/40) | codex/postgres-readonly | Data-tab read-only SQL enforced by Postgres (SELECT INTO etc. rejected) | [40-postgres-readonly](40-postgres-readonly/) | Playwright mp4 + screenshots + harness |
| [#41](https://github.com/sbdeals/Switchyard/pull/41) | codex/mcp-application-delete | MCP remove_service deletes applications via the correct Dokploy route | [41-mcp-application-delete](41-mcp-application-delete/) | before/after terminal output |
| [#42](https://github.com/sbdeals/Switchyard/pull/42) | codex/config-secret-redaction | CLI config output redacts secrets | [42-config-secret-redaction](42-config-secret-redaction/) | before/after terminal output |
| [#43](https://github.com/sbdeals/Switchyard/pull/43) | codex/preserve-registry-credentials | Saving image settings keeps registry credentials | [43-preserve-registry-credentials](43-preserve-registry-credentials/) | Playwright mp4 + screenshots + Dokploy state |
| [#44](https://github.com/sbdeals/Switchyard/pull/44) | codex/auto-domain-port | Auto public URL targets the app's real port | [44-auto-domain-port](44-auto-domain-port/) | Playwright mp4s + screenshots + domain records |
| [#45](https://github.com/sbdeals/Switchyard/pull/45) | codex/sse-text-decoding | Runtime logs: UTF-8-safe streaming, EOF flush, no duplicate replay on reconnect | [45-sse-text-decoding](45-sse-text-decoding/) | Playwright mp4 + screenshots + harness |
| [#46](https://github.com/sbdeals/Switchyard/pull/46) | codex/bridge-public-urls (stacked on #32) | Bridge-mode quick deploys get an automatic Traefik public URL with inferred port | [46-bridge-public-urls](46-bridge-public-urls/) | Playwright mp4 + screenshots + label/curl output |
| [#47](https://github.com/sbdeals/Switchyard/pull/47) | codex/next-security-upgrade | Next.js 16.2.9 → 16.4.2 (Server Actions DoS); audit 7→4, 0 critical | [47-next-security-upgrade](47-next-security-upgrade/) | Playwright mp4 smoke before/after + audit transcript |
