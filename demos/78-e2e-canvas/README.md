# Canvas: drag persistence and narrow viewport

Before (`main-1fc46d5`): dragging compose-5ntm and then reloading resets it to translate(0px, 624px). At 390×844, 0 of 13 nodes are visible.
After (`codex/e2e-canvas`): reloading keeps translate(564.693px, 971.503px) (`PERSISTED`). At 390×844, 13 of 13 nodes are visible.

Files: before.mp4 and after.mp4 (Playwright), before-*.png and after-*.png (dragged, reloaded, 390px), before.txt and after.txt (script output).
Script: demo-tools/cv.mjs `<label> <out>` on the local test dashboard (:3005).
