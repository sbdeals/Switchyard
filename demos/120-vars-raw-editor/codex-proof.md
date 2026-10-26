# Raw variables editor — local proof

Current revision: see [Round 1 proof](round1-README.md). The original canonicalization/comment-dropping behavior below has been replaced by verbatim preservation.

Dashboard: http://127.0.0.1:3049, image `switchyard-dash:vars-raw-editor`.
Base: `main` at `1fc46d5`. Branch: `codex/vars-raw-editor`. No commits or lockfile changes.

The throwaway `vars-raw-editor-proof` application was created without deployment, edited through the dashboard, read back through Dokploy's local API, and deleted through that API. Its throwaway project/environments were also deleted. The app stayed `idle`, with zero deployments. Only fixture values appear in the artifacts.

Evidence:

- `01-draft-preview.png`: pasted dotenv, duplicate warning, added/changed/removed preview.
- `02-confirm-masked.png`: explicit confirmation with fixed masks and no raw editor.
- `03-saved-api-verified.png`: saved canonical dotenv; exact API readback in `api-readback.json`.
- `04-export-warning.png`: warning before copying/downloading secret values.
- `05-invalid-line-errors.png`: numbered errors and disabled review/export.
- `proof.mp4`: browser recording. `proof.webm` is the source recording.
- `checks.json`: passing assertions and API cleanup verification.
- `proof.mjs`: reproducible proof using the provided local login helper; no credential values stored.

Checks:

```sh
cd /workspace/wt-vars-raw-editor/dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

PASS: lint, TypeScript, 22 Vitest tests (13 parser/diff + 9 editor state).

```sh
sudo docker build -q -t switchyard-dash:vars-raw-editor dashboard && /tmp/runsy.sh sy-vars-raw-editor 3049 vars-raw-editor
BASE=http://127.0.0.1:3049 node /workspace/sy-codex-notes/fix/vars-raw-editor-proof/proof.mjs
```

PASS: production build and local browser/API proof. Copy cancellation leaves the clipboard untouched; confirmed copy/download match the API readback. Chrome strips leading dots from download names, so Download .env produces `variables.env`.

Scope/limitations: this base contains a textarea editor and no staged variable-save layer. The new row/raw editor still uses the existing per-user save actions unchanged. Runtime application environment interpretation was not tested because the fixture was deliberately never deployed. Vitest is provided in the supplied node_modules but absent from this base's manifest; test sources are excluded from production TypeScript compilation so the supplied Docker build works without dependency/lockfile edits.
# Round 1: preserve dotenv text

The editor now retains stored text verbatim through load, mode changes, review, save, and export. Row edits replace only the edited value. Other comments, blank lines, ordering, quoting, and line endings remain intact. Duplicate edits target the last effective occurrence; deleting a key removes all its assignments while retaining inline comments as standalone comments.

Files changed this round:

- `dashboard/src/components/service/VariablesTab.tsx`
- `dashboard/src/lib/dotenv-editor.ts` and `dotenv-editor.test.ts`
- `dashboard/src/lib/dotenv-raw.ts` and `dotenv-raw.test.ts`

Checks, all passed:

```sh
cd /workspace/wt-vars-raw-editor/dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

35 tests: 23 parser/line-edit tests and 12 editor-state tests. Includes unchanged byte-identical round trips, every row operation under LF/CRLF, mixed endings, comments and blank lines, duplicate keys, and multiline values.

From `/workspace/wt-vars-raw-editor`:

```sh
sudo docker build -q -t switchyard-dash:vars-raw-editor dashboard && /tmp/runsy.sh sy-vars-raw-editor 3049 vars-raw-editor
BASE=http://127.0.0.1:3049 node /workspace/sy-codex-notes/fix/vars-raw-editor-proof/round1-proof.mjs
git diff --check
```

The proof created `vars-raw-editor-r1-proof` without deploying it and seeded a CRLF dotenv document through the local API. It loaded and switched modes without changing the document, edited one value through the row editor, confirmed, and read the saved text back through the API. The exact text differs only on line 6 (the effective duplicate). All comments, blank lines, unrelated quoting, order, earlier duplicate, and CRLF remain byte-identical. The app remained idle with zero deployments. The throwaway app and project/environments were deleted through the API, and the app's absence was verified.

Artifacts:

- `round1-01-stored-verbatim.png`
- `round1-02-row-edit.png`
- `round1-03-masked-confirmation.png`
- `round1-04-saved-comments-intact.png`
- `round1-api-readback.json` — before/after text and changed line numbers
- `round1-checks.json` — proof assertions and cleanup
- `round1-proof.mp4` — browser recording
- `round1-proof.webm` — source recording
- `round1-proof.mjs` — reproducible script using the provided local login helper

Limitations: no deployed-process test was performed, as requested. Native HTML textareas render CRLF as LF, so exact line-ending preservation is checked using the API response. All artifact values are throwaway fixture data; no credentials are stored. Existing save actions remain unchanged. No commits or lockfile changes.

This round supersedes the original evidence's canonicalization and comment-dropping behavior.
