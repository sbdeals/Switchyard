# Domains: honest HTTPS default. Console: shell-less fallback

Before (`main-1fc46d5`): demo.localhost, app.127.0.0.1.sslip.io and shop.example.com all get HTTPS with Let's Encrypt. In the console, `printf x` and `/whoami --help` both exit 126 with "sh not found".
After (`codex/e2e-domain-console`): all three hosts get HTTPS off with None (HTTP), because no LE email is configured. A shell-less notice appears. `printf x` gives a readable error and exit 126. `/whoami --help` prints usage.

Files: before.mp4, after.mp4, *-domain-*.png, *-console-*.png, before.txt, after.txt. Script: demo-tools/dc.mjs on :3005, using the throwaway compose-5f72 (traefik/whoami).
