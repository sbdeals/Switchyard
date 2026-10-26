# A r2: Connected Git repo (private providers + SSH) with no-Dockerfile builds

Branch `codex/bridge-private-repos` (base `codex/bridge-autodetect-builds`, #63).

What changed: the New service menu's "From GitHub" (GitHub App only) is now **Connected Git repo**. You can choose any
Git provider connected in Dokploy (GitHub, GitLab, Bitbucket, Gitea) or a Dokploy SSH key with a credential-free
`git@host:owner/repo.git` URL. Dokploy keeps the credentials and does the clone. Switchyard then reads only the
manifests (package.json, requirements.txt, go.mod and so on) in a networkless, read-only `alpine/git` helper with
CapDrop ALL and a 128 MiB tmpfs, and builds Node/Python/Go/static repos without a Dockerfile. App port is optional
(auto-detect) or can be overridden. The Overview shows the provider and "auto-detected after Dokploy clone".

| File | Shows |
|---|---|
| before.mp4 / before-*.png / before.txt | image `a-after` (#63): the menu says "From GitHub" and the modal only supports GitHub App installations |
| after.mp4 / after-*.png / after.txt | this branch: "Connected Git repo"; the empty state points to the Git provider or SSH key |
| after-form.mp4 / after-3-form-invalid.png / after-4-form-ready.png / after-form.txt | a throwaway SSH key added to the local Dokploy: an https URL with an SSH key keeps Deploy disabled; an SSH URL plus port 8080 enables it. The key was deleted afterwards |
| after-vitest.txt | 102 tests in the 4 private-repo test files (437 in the full suite; lint and tsc are clean) |

Live clone and deploy proof: Codex ran it against a local SSH git fixture container and throwaway resources on this VM, then
removed them (see docs/bridge-private-repos.md). It touched no external hosts or production credentials.
