# #72: agent shell commands need single-use approval (S-P1-6)

Terminal demo. Both runs execute inside a throwaway dashboard container (`sy-shell-approval-proof`), with the **real local Docker** socket, against the throwaway nginx `sy-shell-approval-demo`. The Dokploy identity and workspace come from `dokploy-fixture.cjs`. No model or provider calls are made.

- `before.txt` (base `0314301`, #68, from `before-smoke.ts`): the agent tool `exec_in_service` **runs the command immediately**. The marker file is written and nothing is staged.
- `after.txt` (`6730d81`, from `after-smoke.ts`):
  - the tool only stages; the review shows the exact command, pinned container id and working dir;
  - an approval that tries to override the command gets 400;
  - approve runs it once, and a concurrent approve gets 409;
  - a replay gets 409;
  - the marker has exactly one line.
- `ui-review-harness.tsx`: the real `ChangesBar` component driven in Chrome. It checks the exact review details, explicit Approve, the frozen selection (a later command is not included) and Reject. Its result is PASS (see `codex-CHECKS.md`). There's no video, because the agent panel needs a configured model key, which this VM doesn't have.
