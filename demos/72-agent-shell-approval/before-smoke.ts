import Docker from "dockerode";
import { runTool } from "/workspace/wt-agent-session-revocation/dashboard/src/lib/agent/tools";
import { listStaged, sessionKey } from "/workspace/wt-agent-session-revocation/dashboard/src/lib/agent/store";
async function main() {
  globalThis.fetch = async () => { throw new Error("no network in this smoke"); };
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  const c = (await docker.listContainers({ filters: { name: ["sy-shell-approval-demo"] } }))[0];
  const t = docker.getContainer(c.Id);
  const marker = async () => { const e = await t.exec({ Cmd: ["sh", "-c", "cat /tmp/sy-shell-before 2>/dev/null || echo '<no file>'"], AttachStdout: true }); const s = await e.start({ hijack: true, stdin: false }); const b: Buffer[] = []; for await (const x of s) b.push(Buffer.from(x)); return Buffer.concat(b).subarray(8).toString().trim(); };
  const key = sessionKey({ dokployCookie: "sess=local-smoke-fixture", email: "smoke@example.test", iat: Date.now() } as any);
  console.log("base: 0314301 (#68)   tool: exec_in_service   (model asked to run a 'diagnostic')");
  console.log("marker before tool call:", await marker());
  const r: any = await runTool("exec_in_service", { service: "sy-shell-approval-demo", command: "echo ran-without-approval >> /tmp/sy-shell-before; cat /tmp/sy-shell-before" }, { sessionKey: key } as any);
  console.log("tool result:", JSON.stringify({ staged: !!r.staged, content: r.content }));
  console.log("staged changes waiting for approval:", listStaged(key).length);
  console.log("marker after tool call:", await marker(), " <- the command already ran, no human approval");
}
main().catch((e) => { console.error(e); process.exit(1); });
