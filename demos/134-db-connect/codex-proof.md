# Database Connect proof

Successful local run: `db-connect-mvp4qp8g` against `http://127.0.0.1:3065`.

Command (exit 0):

```sh
BASE=http://127.0.0.1:3065 node /workspace/sy-codex-notes/fix/db-connect-proof/proof.mjs
```

- `evidence.json` records assertions and API cleanup without credential values.
- `postgres-masked.png`, `redis-masked.png`: initial masked connection details.
- `postgres-uri-cli.png`, `redis-uri-cli.png`: revealed, encoded URI and CLI.
- `redis-external-configured.png`: external URI appears after a metadata-only external port setting. The setting was reset to null; no port was published.
- `db-connect.mp4`: 11.28-second recording of the successful run (H.264 MP4).

The authenticated initial HTML and real `text/x-component` RSC response contained neither raw nor URI-encoded fixture passwords before any reveal/copy and after the interactions. Raw response bodies were inspected only in memory and were not saved.

Both engines passed password reveal/hide, copy without reveal, exact URI/CLI values, and generic clipboard errors. The password action rejected a nonexistent database ID with a generic error. The final run used the native browser Clipboard API with permission granted for the local dashboard origin. Every password, internal URI, and CLI copy was checked with native `readText()` readback. A wrapper also injected a deliberate clipboard error; cleanup attempted to clear the clipboard before closing the browser.

Both `postgres:16` and `redis:7-alpine` deployment attempts failed with the local Dokploy Swarm-manager error. Docker reported Swarm `inactive`; both database statuses were `error`, with zero running fixture containers. Actual network authentication could not be proven; connection strings and UI behavior were proven. No Swarm initialization was attempted.

Dokploy v0.30.10 rejects `/` in database passwords at creation. Live fixture passwords exercised `@:?#%`; the full `@:/?#%` set is covered by the repo's pure-builder tests.

Both databases and their throwaway project were deleted through the Dokploy API in `finally`. Earlier script-debugging attempts also deleted their own database/project records via API. A subsequent read-only `project.all` API check found zero `db-connect-*` projects, covering every attempt in this session. No pre-existing app/container was changed.

Repository checks reported by the lead (all passed):

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
git diff --check
sudo docker build -q -t switchyard-dash:db-connect dashboard
/tmp/runsy.sh sy-db-connect 3065 db-connect
```

Vitest: 3 files, 66 tests passed. Container image: `sha256:78386d4188c120051692d8f78d7a5530cb07f038f5cbd902bdc502f1ad4d0f79`. Dashboard startup returned HTTP 200.

After proof capture, the session-created `sy-db-connect` dashboard container and `sy-db-connect-data` volume were removed. Screenshots, MP4, script, and evidence remain in this directory.
