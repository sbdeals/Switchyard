# #92 Config-as-code preview

Codex session proof on a local throwaway `cac-config-proof` service (since removed):
- `public-config-preview.png`: a real public template (`railwayapp-templates/fastapi`, read as a raw `railway.json` file from GitHub, unauthenticated) resolves builder=NIXPACKS and the start command "From railway.json", overriding the dashboard value.
- `missing-config-preview.png`: a missing config gives a readable status.
- `invalid-config-preview.png`: an invalid builder gives an error and no partial overrides.
- `deployment-history.png`, `service-overview.png`, `deployment-result.log`: the Nixpacks build succeeded, then the launch got 503 "not a swarm manager" (a known limit of this host).

Before: main has no Config as code panel. The panel is preview only and does not apply the config at deploy time.
Local test stack only. No Railway API, CLI or site was used, and no production systems were touched.
