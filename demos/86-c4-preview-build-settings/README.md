# C4 follow-up: PR previews inherit auto-detected build settings

**Before** (#84 alone, where previews don't know about #63): a preview of a parent with an auto-detected build (no Dockerfile) was rendered as a plain Dockerfile build, and the build failed:
`failed to read dockerfile: open Dockerfile: no such file or directory` (`before-preview-build.log`, from the #84 demo run).

**After** (#84 + #63 merged + fix): `parseManagedBuildPlan` recovers the parent's stored generated recipe (`buildKind`, `buildPort`, the inline Dockerfile), and `upsertPreview` renders the preview with it, still pinned to the PR head SHA. The preview's port comes from the recipe. The ownership check re-renders with the same plan, so exact-compose matching still guards deletion.

Live local proof (`after-proof.txt`, throwaway dashboard on :3006, public `heroku/node-js-getting-started`, which has no Dockerfile):
- the parent auto-detects node:3000 and returns HTTP 200;
- signed `pull_request` opened → 202, the preview inherits the recipe (`inlineRecipeMatchesParent: true`), builds, and returns HTTP 200 directly and through local Traefik;
- closed → 202, "preview deleted", and no rows or containers remain;
- everything is cleaned up through the dashboard and Dokploy APIs.

Tests: `after-vitest.txt` (preview-lifecycle and managed-compose, 128 tests). The full suite is 625/625, and lint and tsc pass.

Limits: the preview reuses the parent's recipe rather than re-detecting on the PR head, so a PR that switches language keeps the parent's builder. Only the canonical generated compose layout can be parsed; a hand-edited recipe makes the preview fail with "Managed build recipe is unavailable".
