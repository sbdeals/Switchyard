# UI polish: overflow, log filter, drafts, Stopped state

Throwaway compose-5f72 (traefik/whoami) on the local test stack (:3005). Each run stops it and then starts it again.

| check | before (main-1fc46d5) | after (codex/e2e-ui-polish) |
|---|---|---|
| 390×844 header | scrollWidth 473 > 390, horizontal overflow | 390, no overflow |
| Logs filter with no match | "waiting for logs…" spinner | "No logs match …" plus **Clear filter** |
| Variables draft, Logs → Variables | draft **lost** | kept |
| Esc with unsaved draft | drawer closes and the draft is silently lost | confirm "Discard unsaved variable or Compose edits and close?" |
| Stopped compose | card shows Deploy; header says "Idle / Last deploy: Never deployed" | card shows **Start**; header says "Stopped"; buttons Start, Redeploy |

Files: before.mp4, after.mp4, before-1..5.png, after-1..5.png, before.txt, after.txt. Script: demo-tools/up.mjs `<label> <out>`.
