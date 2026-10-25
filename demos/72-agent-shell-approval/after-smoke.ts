import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import Docker from "dockerode";
import { runTool } from "/workspace/wt-agent-shell-approval/dashboard/src/lib/agent/tools";
import { sessionKey, listStaged } from "/workspace/wt-agent-shell-approval/dashboard/src/lib/agent/store";
import { SESSION_COOKIE, sealSession } from "/workspace/wt-agent-shell-approval/dashboard/src/lib/session";
import { GET, POST } from "/workspace/wt-agent-shell-approval/dashboard/src/app/api/agent/changes/route";
import { demuxDockerFrames } from "/workspace/wt-agent-shell-approval/dashboard/src/lib/docker";

async function main() {
  process.env.SWITCHYARD_SESSION_SECRET = randomBytes(32).toString("hex");
  globalThis.fetch = async () => { throw new Error("Network access forbidden in this tool-layer smoke test"); };
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  const demoName = "sy-shell-approval-demo";
  const containers = await docker.listContainers({ filters: { name: [demoName] } });
  assert.equal(containers.length, 1);
  assert.equal(containers[0].Names[0], `/${demoName}`);
  const target = docker.getContainer(containers[0].Id);
  async function probe(argv: string[]) {
    const exec = await target.exec({ Cmd: argv, AttachStdout: true, AttachStderr: true, Tty: false });
    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return { output: demuxDockerFrames(Buffer.concat(chunks)), exitCode: (await exec.inspect()).ExitCode };
  }
  const session = { dokployCookie: "sess=local-smoke-fixture", email: "smoke@example.test", iat: Date.now() };
  const key = sessionKey(session);
  const cookie = `${SESSION_COOKIE}=${sealSession(session)}`;
  function request(body?: unknown) {
    return new Request("http://127.0.0.1:3006/api/agent/changes", {
      method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const command = "printf '%s\\n' approved >> /tmp/sy-shell-proof; cat /tmp/sy-shell-proof";
  assert.equal((await probe(["test", "!", "-e", "/tmp/sy-shell-proof"])).exitCode, 0);
  const staged = await runTool("exec_in_service", { service: demoName, command, workingDir: "/tmp" }, { sessionKey: key });
  assert.ok(staged.staged);
  assert.equal(staged.isError, undefined);
  assert.equal((await probe(["test", "!", "-e", "/tmp/sy-shell-proof"])).exitCode, 0);
  const review = await (await GET(request())).json();
  assert.equal(review.changes[0].shell.command, command);
  assert.equal(review.changes[0].shell.containerId, containers[0].Id);
  assert.equal(review.changes[0].shell.workingDir, "/tmp");
  console.log(JSON.stringify({ step: "staged", executed: false, review: review.changes[0] }));

  const id = staged.staged.id;
  const tampered = await POST(request({ action: "apply", ids: [id], command: "echo swapped" }));
  assert.equal(tampered.status, 400);
  assert.equal((await probe(["test", "!", "-e", "/tmp/sy-shell-proof"])).exitCode, 0);
  console.log(JSON.stringify({ step: "tampered approval refused", status: tampered.status }));

  const [approved, concurrent] = await Promise.all([
    POST(request({ action: "apply", ids: [id] })),
    POST(request({ action: "apply", ids: [id] })),
  ]);
  assert.equal(approved.status, 200);
  assert.equal(concurrent.status, 409);
  const result = await approved.json();
  assert.equal(result.results[0].ok, true);
  assert.match(result.results[0].output, /stdout:\napproved\n/);
  assert.match(result.results[0].output, /exit code: 0/);
  assert.equal((await probe(["cat", "/tmp/sy-shell-proof"])).output, "approved\n");
  assert.equal(listStaged(key).length, 0);
  console.log(JSON.stringify({ step: "approved and executed exactly once", result, concurrentReplay: concurrent.status }));

  const replay = await POST(request({ action: "apply", ids: [id] }));
  assert.equal(replay.status, 409);
  const rejected = await runTool("exec_in_service", { service: demoName, command: "printf rejected >> /tmp/sy-shell-proof" }, { sessionKey: key });
  assert.ok(rejected.staged);
  await POST(request({ action: "discard", ids: [rejected.staged.id] }));
  assert.equal((await POST(request({ action: "apply", ids: [rejected.staged.id] }))).status, 409);
  assert.equal((await probe(["cat", "/tmp/sy-shell-proof"])).output, "approved\n");
  console.log(JSON.stringify({ step: "replay and rejection verified", replayStatus: replay.status, marker: "approved (one line)" }));
  console.log("PASS: real local Docker execution; fixture Dokploy identity/workspace; no provider credentials or calls");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
