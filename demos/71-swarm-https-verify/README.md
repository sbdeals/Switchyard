# #71: Swarm auto-URL port fix + Swarm/HTTPS test report

Terminal demo (non-UI).
- `before.txt`: the new `swarm-domains.test.ts` run against base `6b6d5d6` (#61) with the fix stashed. 5 of 9 fail: Docker-image auto-URLs get `port: 3000` instead of 80 or 8080.
- `after.txt`: with the fix, 9/9 pass, plus the bridge domain suite (51 total) and the full suite (441/441).
- `report.md`: the live fixture evidence, copied from `docs/testing/swarm-https.md`.
  - Pebble-issued cert, `curl --cacert` returning HTTP 200 / TLS verify 0.
  - Old port 3000 returning 502, then the fixed port returning 200.
  - Swarm tasks blocked on this VM (no VXLAN); see the Swarm observations section.
