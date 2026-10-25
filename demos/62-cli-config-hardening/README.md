# #62: CLI port validation + atomic 0600 config writes (C-P2-2, C-P2-4)
PR: https://github.com/sbdeals/Switchyard/pull/62 · branch `codex/cli-config-hardening` · recorded 01:33 EDT Oct 25

The terminal transcripts compare main `1fc46d5` (`before.txt`) with this branch (`after.txt`). Both builds ran `node dist/cli.js` against a throwaway `SWITCHYARD_CONFIG` temp file, with `--no-restart`, so neither touched Docker. Reproduce with `cli-config-demo.sh <label> <dist/cli.js>`. `mode-probe.mjs` is a `--import` preload that prints the file mode at the instant before chmod (main) or before rename (branch).

| check | before | after |
|---|---|---|
| `config set dashboardPort -- 0 / -1 / 65536` | saved, exit 0 | `✗ dashboardPort must be an integer between 1 and 65535`, exit 1, nothing written |
| config dir mode under `umask 000` | 777 | 700 |
| file mode the moment it first exists (umask 022) | **644** (chmod 600 happens afterwards) | **600** (temp file, then rename) |
| hand-edited `dashboardPort: 70000`, then `config list` | prints 70000 | `✗ Invalid config file …: dashboardPort must be …` |

Also covered by unit tests, not shown here: `ensureSwitchyard` rejects bad ports before any Docker call. 63/63 tests pass.
