# #47 follow-up: dashboard prod audit 4 → 0 (commit 9586f70)

[9586f70](https://github.com/sbdeals/Switchyard/commit/9586f70) runs `npm audit fix --omit=dev` on top of the Next 16.4.2 bump (fdbe3bc). It changes only the lockfile: `dashboard/package.json` is untouched. Non-UI change, so the proof is a terminal before/after.

Bumps: @grpc/grpc-js 1.14.4→1.14.6, baseline-browser-mapping 2.10.43→2.11.31, nanoid 3.3.16→3.3.20, source-map-js 1.2.1→1.2.2.

- **[audit-before-after.txt](audit-before-after.txt):** prod `npm audit` goes from **4 (1 moderate, 3 high) to 0**, lockfile-only.
- **[checks.txt](checks.txt):** at 9586f70, lint, `tsc --noEmit` and `next build` (Next 16.4.2) all exit 0. There's no vitest run because main has no dashboard test files.

Not re-proven: the Playwright smoke in `../after.mp4` was recorded on fdbe3bc, before this lockfile change. These are patch/minor transitive bumps (the build passes), but the UI smoke was not re-recorded.
