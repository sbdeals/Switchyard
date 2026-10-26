Drawer deep links were verified locally at http://127.0.0.1:3067 on October 26, 2026. The dashboard container is `sy-drawer-deeplinks`, built from this worktree as `switchyard-dash:drawer-deeplinks` (image SHA `6faddb000b9ea4a586120b04b3ccbb5fe7ef0693ecf01f6b4196e02f17e475a8`).

Watch [drawer-deeplinks-proof.mp4](./drawer-deeplinks-proof.mp4) (42.4 seconds). The recording combines the main browser context, a fresh authenticated context, and a fresh context performing the real login round-trip. Screenshots `01` through `12` cover the individual assertions; `results.json` records the main proof results. `creation-result.json` records the additional UI creation/refresh check, which passed twice on the final build.

Verified behavior:

- Existing `nginx-g9se` was viewed read-only. Opening/closing adds history; tab changes replace history. Back/Forward closes, reopens, and returns to the previous service and tab. These interactions caused zero page navigations or RSC requests.
- Copy link writes the exact current service/tab URL. A fresh authenticated context and a reload restore the same drawer and Logs tab. Clipboard failure shows an address-bar fallback.
- Stale service IDs close the drawer, display the brief toast, and remove service/tab parameters. Unsupported tabs fall back to Overview and are removed. Unrelated parameters and Next's history metadata survive cleanup.
- An unauthenticated link survives the real login round-trip. An external return path is rejected in favor of the local workspace.
- The UI creation callback opens the new service after refresh without incorrectly treating its ID as stale.
- Final fixtures were removed using dashboard server-action APIs. `cleanup-verified.json` confirms no `drawer-deeplinks-*` services remain. No pre-existing applications were modified or removed.

Exact checks and results:

```sh
cd dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

Passed: ESLint, TypeScript, 4 Vitest files / 99 tests.

```sh
sudo docker build -q -t switchyard-dash:drawer-deeplinks dashboard
/tmp/runsy.sh sy-drawer-deeplinks 3067 drawer-deeplinks
BASE=http://127.0.0.1:3067 node /workspace/sy-codex-notes/fix/drawer-deeplinks-proof/proof.mjs
BASE=http://127.0.0.1:3067 node /workspace/sy-codex-notes/fix/drawer-deeplinks-proof/creation.mjs
BASE=http://127.0.0.1:3067 node /workspace/sy-codex-notes/fix/drawer-deeplinks-proof/verify-cleanup.mjs
git diff --check
```

Passed: production image build, local dashboard startup, browser assertions, UI creation/refresh assertions, cleanup verification, and whitespace check. Public client action references were used for fixture creation/deletion; authentication used the authorized demo-tools helper. Browser requests were restricted to the assigned local dashboard origin. No lockfiles or dependency declarations changed, and no commit was created.

Repository files touched:

- `dashboard/.dockerignore`
- `dashboard/vitest.config.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/app/login/page.tsx`
- `dashboard/src/app/login/LoginForm.tsx`
- `dashboard/src/app/login/actions.ts`
- `dashboard/src/proxy.ts`
- `dashboard/src/components/Workspace.tsx`
- `dashboard/src/components/use-service-deeplink.ts`
- `dashboard/src/components/service/ServiceDrawer.tsx`
- `dashboard/src/components/service/CopyLinkButton.tsx`
- `dashboard/src/lib/deeplink.ts`
- `dashboard/src/lib/deeplink.test.ts`
- `dashboard/src/lib/auth-redirect.test.ts`
- `dashboard/src/lib/service-deeplink.test.ts`
- `dashboard/src/lib/copy-link.test.ts`

Limitations: redirects originating inside the existing backend session validation for expired/invalid cookies still lose the deep link; missing-cookie login is preserved and proven. This base has Vitest available in its supplied node_modules but does not declare it in package.json, so tests/config are excluded from the production Docker context. The local app deployment did not reach a running container; this proof validates drawer/navigation behavior, not app runtime deployment. An earlier fixture disappeared during an initial run and one creation attempt timed out; the recorded final full run and two subsequent creation checks passed. All remaining session fixtures were cleaned up through the API and their absence verified.
